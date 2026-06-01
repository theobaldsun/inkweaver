import * as SQLite from 'expo-sqlite';
import type { Document, SyncUpdate } from '@inkweaver/shared';
import type { LocalDB } from '..';

/**
 * 基于 expo-sqlite 的 React Native 本地存储实现
 */
export class NativeLocalDB implements LocalDB {
  private db: SQLite.SQLiteDatabase;

  constructor() {
    this.db = SQLite.openDatabaseSync('InkWeaverDB.db');
    // 初始化数据库，不等待完成
    this.initDatabase().catch((error) => {
      console.error('Failed to initialize database:', error);
    });
  }

  private async initDatabase(): Promise<void> {
    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        userId TEXT,
        createdAt TEXT,
        updatedAt TEXT,
        yjsSnapshot BLOB
      );
      
      CREATE TABLE IF NOT EXISTS syncUpdates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        docId TEXT,
        update BLOB,
        clientId TEXT,
        timestamp INTEGER,
        pending INTEGER DEFAULT 1
      );
      
      CREATE INDEX IF NOT EXISTS idx_syncUpdates_docId ON syncUpdates(docId);
      CREATE INDEX IF NOT EXISTS idx_syncUpdates_timestamp ON syncUpdates(timestamp);
    `);
  }

  async saveDoc(doc: Document): Promise<void> {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO documents (id, title, content, userId, createdAt, updatedAt, yjsSnapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, doc.title, doc.content, doc.userId, doc.createdAt, doc.updatedAt, doc.yjsSnapshot || null]
    );
  }

  async getDoc(id: string): Promise<Document> {
    const result = await this.db.getFirstAsync<Document>(
      'SELECT * FROM documents WHERE id = ?',
      [id]
    );
    if (!result) {
      throw new Error(`Document ${id} not found`);
    }
    return result;
  }

  async saveUpdate(update: SyncUpdate): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO syncUpdates (docId, update, clientId, timestamp, pending)
       VALUES (?, ?, ?, ?, ?)`,
      [update.docId, update.update, update.clientId, update.timestamp, 1]
    );
  }

  async getUpdatesSince(docId: string, since: number): Promise<SyncUpdate[]> {
    return this.db.getAllAsync<SyncUpdate>(
      'SELECT * FROM syncUpdates WHERE docId = ? AND timestamp > ?',
      [docId, since]
    );
  }

  async getPendingUpdates(docId: string): Promise<SyncUpdate[]> {
    return this.db.getAllAsync<SyncUpdate>(
      'SELECT * FROM syncUpdates WHERE docId = ? AND pending = 1',
      [docId]
    );
  }

  async clearPending(docId: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE syncUpdates SET pending = 0 WHERE docId = ? AND pending = 1',
      [docId]
    );
  }
}

/**
 * 创建 Native 本地存储实例
 */
export function createNativeLocalDB(): LocalDB {
  return new NativeLocalDB();
}
