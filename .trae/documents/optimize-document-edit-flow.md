# DocumentEditPage 编辑流程优化方案

## 背景与目标

### 问题起源

修复"InkWeaverEditor 标题输入第一个字失焦"问题时，引入了多层防御：

1. `InkWeaverEditor` 内部新增 `title` 局部 state + `prevTitlePropRef` + `handleTitleInputChange`（组件级缓冲）
2. `apps/web` 与 `apps/h5` 的 `handleTitleChange` 用 `yDoc.transact(..., 'local-title')` 打标
3. `yMap.observe` 回调用 `event.transaction?.origin === 'local-title'` 过滤本地写入
4. `setDocument` 回调多处加 `prev.title === title` / `prev.content === content` 等值短路
5. `key` 改用 `id || 'new'` 绕开 tempId 重写导致的重挂载

最终起作用的只有第 5 条（key 稳定）。前 4 条是**冗余防御**，增加了逻辑复杂度但并非必要。

### 深层问题

调研发现 `DocumentEditPage`（web 与 h5 两端）存在 3 个结构性问题：

1. **tempId 生成散落 5 处**：`handleTitleChange` / `handleContentChange` / `saveDocument` / 自动保存 `useEffect` 各自用 `document.id || \`temp-...\`` 兜底生成，逻辑重复且易错。
2. **`document.id` 被反复写回**：`saveDocument` 在无路由 id 时主动 `setDocument({ id: tempId })`，导致 `document.id` 在编辑过程中从 `''` → `'temp-xxx'` 跳变。这是历史上 `key={document.id}` 失焦的根源，目前用 `key={id || 'new'}` 绕开但根因未除。
3. **H5 端 `initTempDocument` 缺少 disposer**：与 Web 端不对称，`yDoc.off('update', handleUpdate)` 未实现，卸载时存在监听泄漏。

### 目标

- 消除 tempId 生成散落，集中到一处稳定持有
- 不再在编辑过程中写回 `document.id`
- 删除冗余的 `local-title` origin 过滤层（保留等值短路作为通用优化）
- 保留 `InkWeaverEditor` 内部 title 缓冲作为组件级防御（简单且通用）
- 顺带修复 H5 端 disposer 缺失
- `key` 语义化为"编辑会话"标识

---

## 当前状态分析

### `document.id` 写回与 tempId 生成点（5 处散落）

#### apps/web/src/pages/DocumentEditPage.tsx

| 行号 | 位置 | 代码模式 |
|------|------|---------|
| 382-383 | `saveDocument` | `const tempId = document.id || \`temp-...\`; if (!document.id) { setDocument({...document, id: tempId}) }` |
| 452 | `handleTitleChange` else 分支 | `const tempId = document.id || \`temp-...\`` |
| 493 | `handleContentChange` else 分支 | `const tempId = document.id || \`temp-...\`` |
| 507 | 自动保存 useEffect | `const tempId = document.id || \`temp-...\`` |

#### apps/h5/src/pages/DocumentEditPage.tsx

| 行号 | 位置 | 代码模式 |
|------|------|---------|
| 282-283 | `saveDocument` | 同 Web |
| 359 | `handleTitleChange` else 分支 | 同 Web |
| 382 | `handleContentChange` else 分支 | 同 Web |
| 399 | 自动保存 useEffect | 同 Web |

### 冗余防御层（本次要删的）

| 文件 | 行号 | 内容 | 删除理由 |
|------|------|------|---------|
| `apps/web/.../DocumentEditPage.tsx` | 317-326 | `handleMapUpdate` 的 `event.transaction?.origin === 'local-title'` 过滤 | 等值短路已足够；origin 打标依赖所有写入路径配合，脆弱 |
| `apps/web/.../DocumentEditPage.tsx` | 443-445, 455-457 | `handleTitleChange` 的 `yDoc.transact(..., 'local-title')` | 配套删除 |
| `apps/h5/.../DocumentEditPage.tsx` | 244-253 | `handleMapUpdate` 的 origin 过滤 | 同 Web |
| `apps/h5/.../DocumentEditPage.tsx` | 351-353, 362-364 | `handleTitleChange` 的 `yDoc.transact(..., 'local-title')` | 同 Web |

### 保留的内容

| 文件 | 行号 | 内容 | 保留理由 |
|------|------|------|---------|
| `apps/web/.../DocumentEditPage.tsx` | 308-311 | `handleUpdate` 的 `prev.content === content` 等值短路 | 通用优化，避免无谓 rerender |
| `apps/web/.../DocumentEditPage.tsx` | 320-322 | `handleMapUpdate` 的 `prev.title === newTitle` 等值短路 | 同上 |
| `apps/h5/.../DocumentEditPage.tsx` | 237-240, 247-249 | 同上 | 同上 |
| `packages/editor-web/.../InkWeaverEditor.tsx` | 68-74, 142-153 | `title` 局部 state + `prevTitlePropRef` + `handleTitleInputChange` | 组件级防御，简单且通用，防止未来父组件 key 不稳定 |

### H5 disposer 缺失

`apps/h5/.../DocumentEditPage.tsx:54-76` 的 `initTempDocument`：
- Web 版有 `tempUpdateDisposers.current.set(tempId, () => yDoc.off('update', handleUpdate))` 并在 cleanup 中调用
- H5 版**没有** `tempUpdateDisposers`，也**没有** `yDoc.off`，卸载时监听泄漏

---

## 改动方案

### 执行规范

所有改动需遵循以下代码质量规则：

1. **整洁可读**
   - 每个函数职责单一，命名表意清晰
   - 删除无用 import、注释代码、调试日志
   - 避免过深嵌套，优先早返回

2. **合理的代码块**
   - 相关逻辑用空行分组，不相关的逻辑之间也用空行分隔
   - 单个函数体过长时按逻辑段落拆分（注释分隔）
   - JSX 块按语义分组，避免单行堆叠多个属性

3. **代码注释**
   - 对非自明的业务逻辑、Yjs 协同流程、tempId 生命周期等添加中文注释
   - 注释说明"为什么"而非"做什么"，避免重复代码含义
   - 复杂的 setDocument 回调、useEffect 依赖、cleanup 流程必须有注释

4. **TypeScript 类型**
   - 保持类型推断，避免不必要的显式类型标注
   - 事件回调参数使用精确类型（如 `React.ChangeEvent<HTMLInputElement>`）
   - 删除决策中废弃的 `Y.YMapEvent<unknown>` 等类型参数

5. **diff 最小化**
   - 只改动方案中列出的部分，不重构无关代码
   - 保留原有代码风格（如 Web 端用普通函数、H5 端用 `useCallback`）

### 改动 1：引入 `tempIdRef` + `ensureTempId`（两端）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`
- `apps/h5/src/pages/DocumentEditPage.tsx`

**目的**：集中 tempId 生成，稳定持有，不再写回 `document.id`。

**实现**：

在 `initTempDocument` 下方新增：

```ts
const tempIdRef = useRef<string | null>(null);

const ensureTempId = useCallback((): string => {
  if (tempIdRef.current) return tempIdRef.current;
  const newId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  tempIdRef.current = newId;
  const yDoc = getYDoc(newId);
  initTempDocument(newId, yDoc);
  return newId;
}, [initTempDocument]);
```

**关键属性**：
- `tempIdRef.current` 首次调用时生成，之后稳定返回同一值
- `initTempDocument` 内部用 `initializedTempDocs` Set 去重，重复调用安全
- `document.id` 不再被写回 tempId，只在 `saveDocument` 成功后写回正式 id

### 改动 2：`handleTitleChange` 改用 `ensureTempId`（两端）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 440-465 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 348-372 行）

**改造前**（Web 当前）：
```ts
const handleTitleChange = (title: string) => {
  if (id) {
    const yDoc = getYDoc(id);
    yDoc.transact(() => {
      yDoc.getMap('metadata').set('title', title);
    }, 'local-title');
    setDocument(prev => {
      if (prev.title === title) return prev;
      scheduleMetadataProjection(id, title, prev.content);
      return { ...prev, title, updatedAt: new Date().toISOString() };
    });
  } else {
    const tempId = document.id || `temp-${Date.now()}-${Math.random()...}`;
    const yDoc = getYDoc(tempId);
    initTempDocument(tempId, yDoc);
    yDoc.transact(() => {
      yDoc.getMap('metadata').set('title', title);
    }, 'local-title');
    setDocument(prev => {
      const updated = { ...prev, id: tempId, title, updatedAt: new Date().toISOString() };
      if (prev.id === updated.id && prev.title === title) return prev;
      localDB.saveDoc(updated).catch(console.error);
      return updated;
    });
  }
};
```

**改造后**（Web）：
```ts
const handleTitleChange = (title: string) => {
  const docId = id || ensureTempId();
  const yDoc = getYDoc(docId);
  yDoc.getMap('metadata').set('title', title);
  setDocument(prev => {
    if (prev.title === title) return prev;
    if (id) scheduleMetadataProjection(id, title, prev.content);
    else localDB.saveDoc({ ...prev, id: docId, title, updatedAt: new Date().toISOString() }).catch(console.error);
    return { ...prev, title, updatedAt: new Date().toISOString() };
  });
};
```

**变化要点**：
- 删除 `yDoc.transact(..., 'local-title')` 打标（冗余）
- else 分支用 `ensureTempId()` 替代 `document.id || generate`
- **不再 `setDocument` 写回 `id: tempId`**（`document.id` 保持 `''`，直到 saveDocument 成功）
- `localDB.saveDoc` 时用局部 `docId` 变量，不污染 state
- 保留 `prev.title === title` 等值短路

**H5 版同理**，注意 H5 没有 `scheduleMetadataProjection`，else 分支只做 `localDB.saveDoc`。

### 改动 3：`handleContentChange` 改用 `ensureTempId`（两端）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 467-492 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 374-398 行）

**改造前**（Web 当前 else 分支）：
```ts
} else {
  const tempId = document.id || `temp-${Date.now()}-${Math.random()...}`;
  const yDoc = getYDoc(tempId);
  initTempDocument(tempId, yDoc);
  syncToYDoc(tempId);
  setDocument(prev => {
    const updated = { ...prev, id: tempId, content: event.content, updatedAt: new Date().toISOString() };
    localDB.saveDoc(updated).catch(console.error);
    return updated;
  });
}
```

**改造后**（Web）：
```ts
} else {
  const tempId = ensureTempId();
  syncToYDoc(tempId);
  setDocument(prev => {
    if (prev.content === event.content) return prev;
    localDB.saveDoc({ ...prev, id: tempId, content: event.content, updatedAt: new Date().toISOString() }).catch(console.error);
    return { ...prev, content: event.content, updatedAt: new Date().toISOString() };
  });
}
```

**变化要点**：
- 用 `ensureTempId()` 替代 `document.id || generate`
- `initTempDocument` 已在 `ensureTempId` 内部调用，删除冗余调用
- **不再 `setDocument` 写回 `id: tempId`**
- `localDB.saveDoc` 时用局部 `tempId`，不污染 state
- 保留等值短路

**H5 版同理**。

### 改动 4：`saveDocument` 改用 `ensureTempId`（两端）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 375-427 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 275-330 行）

**改造前**（Web 当前开头）：
```ts
let currentId = id;
let currentDoc = document;

if (!currentId) {
  const tempId = document.id || `temp-${Date.now()}-${Math.random()...}`;
  if (!document.id) {
    currentDoc = { ...document, id: tempId };
    setDocument(currentDoc);
  }
  currentId = tempId;
}
```

**改造后**（Web 开头）：
```ts
let currentId = id;
let currentDoc = document;

if (!currentId) {
  currentId = ensureTempId();
}
```

**变化要点**：
- 用 `ensureTempId()` 替代 `document.id || generate`
- **删除 `setDocument(currentDoc)` 写回 tempId**（不再污染 state）
- `currentDoc` 仍为当前 state 快照，`localDB.saveDoc` 时用 `currentId`

**saveDocument 后续 temp 分支保持不变**：
- `getYDoc(currentId)` 读取最新内容
- `documentApi.createDocument` 创建正式文档
- `cleanupTempDocument(currentId)` 清理 temp 缓存
- `setDocument({ ...currentDoc, id: response.id, ... })` 写回正式 id（**这是 `document.id` 唯一被写回的地方，保留**）
- `tempIdRef.current = null`（重置，避免后续误用已清理的 tempId）
- `navigate('/documents/' + response.id)`

**新增**：在 `cleanupTempDocument` 调用后立即 `tempIdRef.current = null`。

### 改动 5：自动保存 `useEffect` 改用 `ensureTempId`（两端）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 505-511 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 393-399 行附近）

**改造前**（Web 当前）：
```ts
useEffect(() => {
  if (!id && (document.title || document.content)) {
    const tempId = document.id || `temp-${Date.now()}-${Math.random()...}`;
    const tempDoc = { ...document, id: tempId, updatedAt: new Date().toISOString() };
    localDB.saveDoc(tempDoc).catch(console.error);
  }
}, [document.title, document.content, id]);
```

**改造后**（Web）：
```ts
useEffect(() => {
  if (!id && (document.title || document.content)) {
    const tempId = ensureTempId();
    const tempDoc = { ...document, id: tempId, updatedAt: new Date().toISOString() };
    localDB.saveDoc(tempDoc).catch(console.error);
  }
}, [document.title, document.content, id, ensureTempId]);
```

**变化要点**：
- 用 `ensureTempId()` 替代 `document.id || generate`
- `tempDoc.id` 用局部 `tempId`，不写回 state
- 依赖数组加 `ensureTempId`（`useCallback` 稳定引用）

### 改动 6：删除 `handleMapUpdate` 的 origin 过滤（两端）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 317-326 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 244-253 行）

**改造前**（Web 当前）：
```ts
const handleMapUpdate = (event: Y.YMapEvent<unknown>) => {
  const newTitle = yMap.get('title') as string || '';
  if (event.transaction?.origin === 'local-title') return;
  setDocument(prev => {
    if (prev.title === newTitle) return prev;
    const updated = { ...prev, title: newTitle, updatedAt: new Date().toISOString() };
    localDB.saveDoc(updated).catch(console.error);
    return updated;
  });
};
```

**改造后**（Web）：
```ts
const handleMapUpdate = () => {
  const newTitle = yMap.get('title') as string || '';
  setDocument(prev => {
    if (prev.title === newTitle) return prev;
    const updated = { ...prev, title: newTitle, updatedAt: new Date().toISOString() };
    localDB.saveDoc(updated).catch(console.error);
    return updated;
  });
};
```

**变化要点**：
- 删除 `event: Y.YMapEvent<unknown>` 参数与 origin 过滤
- 保留 `prev.title === newTitle` 等值短路（这是真正的去重保障）
- 本地输入时：`handleTitleChange` 已 `setDocument({ title })` → yMap.observe 回调读到相同 title → 等值短路返回 `prev` → 不触发 rerender

### 改动 7：`handleUpdate` 保留等值短路（两端，无新改动）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 298-314 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 228-241 行）

**说明**：上一轮加的 `prev.content === content` 等值短路保留，无需改动。这是通用优化，不属于冗余防御。

### 改动 8：H5 端 `initTempDocument` 补全 disposer

**文件**：`apps/h5/src/pages/DocumentEditPage.tsx`（当前 54-76 行）

**目的**：与 Web 端对齐，修复卸载时监听泄漏。

**改造前**（H5 当前）：
```ts
const initTempDocument = useCallback((tempId: string, yDoc: Y.Doc, skipWebSocket = false) => {
  if (initializedTempDocs.current.has(tempId)) return;
  initializedTempDocs.current.add(tempId);

  const handleUpdate = (update: Uint8Array) => {
    localDB.saveUpdate({ docId: tempId, update, clientId: CLIENT_ID, timestamp: Date.now(), pending: false }).catch(console.error);
  };
  yDoc.on('update', handleUpdate);
}, []);
```

**改造后**（H5，对齐 Web）：
```ts
const tempUpdateDisposers = useRef<Map<string, () => void>>(new Map());

const initTempDocument = useCallback((tempId: string, yDoc: Y.Doc) => {
  if (initializedTempDocs.current.has(tempId)) return;
  initializedTempDocs.current.add(tempId);

  const handleUpdate = (update: Uint8Array) => {
    localDB.saveUpdate({ docId: tempId, update, clientId: CLIENT_ID, timestamp: Date.now(), pending: false }).catch(console.error);
  };
  yDoc.on('update', handleUpdate);
  tempUpdateDisposers.current.set(tempId, () => {
    yDoc.off('update', handleUpdate);
    tempUpdateDisposers.current.delete(tempId);
  });
}, []);
```

**配套**：在 `loadDocument` 的 cleanup 中（当前 H5 文件缺少对应位置，需参照 Web 第 357-359 行新增）：
```ts
return () => {
  disposed = true;
  if (id?.startsWith('temp-')) {
    tempUpdateDisposers.current.get(id)?.();
  }
  cleanupListeners?.();
  cleanupListeners = undefined;
};
```

**变化要点**：
- 删除未使用的 `skipWebSocket` 参数（注释整段已禁用）
- 新增 `tempUpdateDisposers` ref
- 注册 disposer
- cleanup 中调用 disposer

### 改动 9：`key` 语义化（两端，可选）

**文件**：
- `apps/web/src/pages/DocumentEditPage.tsx`（当前 705 行）
- `apps/h5/src/pages/DocumentEditPage.tsx`（当前 493 行）

**当前**：
- Web：`key={`${id || 'new'}-${editorSyncKey}`}`
- H5：`key={id || 'new'}`

**说明**：当前已足够稳定，不改。`id || 'new'` 语义清晰（路由 id 或新建会话），`editorSyncKey` 用于远端同步冲突时强制重挂载。

---

## 假设与决策

### 决策 1：保留 `InkWeaverEditor` 内部 title 缓冲层

**理由**：
- 组件级防御，简单（约 10 行代码）
- 防止未来父组件误用 `key={document.id}` 类似模式时失焦
- 不影响父端逻辑，自治性好

**替代方案（已否决）**：删除组件缓冲层，回到 `value={title} onChange={(e) => onTitleChange?.(e.target.value)}`。虽然 key 稳定后受控 input 不会失焦，但防御性弱。

### 决策 2：删除 `local-title` origin 过滤，保留等值短路

**理由**：
- origin 过滤依赖所有写入路径都正确打标，脆弱
- 等值短路（`prev.title === newTitle`）是通用优化，无侵入，且能覆盖所有重复 setDocument 场景
- 本地输入时 `handleTitleChange` 已先 `setDocument`，yMap.observe 回调读到相同值会被等值短路

### 决策 3：不写回 `document.id` 为 tempId

**理由**：
- `document.id` 应该只表达"已持久化的正式文档 id"，不应承载临时会话标识
- tempId 通过 `tempIdRef` 持有，局部使用，不污染 state
- `document.id` 只在 `saveDocument` 成功后写回 `response.id`，语义清晰

### 决策 4：`saveDocument` 期间不禁用输入

**理由**：
- `saveDocument` 是异步操作，期间用户继续输入会触发 `handleTitleChange` → `ensureTempId` 返回同一 tempId → 操作同一 Y.Doc（仍存在，未清理）
- `cleanupTempDocument` 在 `createDocument` 成功后调用，此时 Y.Doc 被销毁，但之后立即 `setDocument({ id: response.id })` + `navigate`
- 竞态窗口极小（createDocument 响应到 navigate 之间），且用户输入会落入已销毁的 Y.Doc 但不影响 createDocument 已读取的内容
- 风险可接受，不过度设计

### 假设

1. `getYDoc(tempId)` 对 temp- 开头的 id 无特殊处理（已验证：[packages/sync-engine/src/syncEngine.ts:129-142](file:///d:/Codex_Workspaces/software-development/projects/SyncBox-AI/packages/sync-engine/src/syncEngine.ts#L129-L142)）
2. `initTempDocument` 内部 `initializedTempDocs` Set 去重，重复调用安全（已验证）
3. `localDB.saveDoc` 接受任意 id（包括 temp-），不依赖 `document.id` state（已验证）
4. `InkWeaverEditor` 的 `title` prop 变化不会导致 input 失焦（只要 key 不变，受控 input 的 value 更新不重挂载）

---

## 验证步骤

### 1. 类型检查

```bash
pnpm --filter @inkweaver/editor-web build
pnpm --filter @inkweaver/web typecheck
pnpm --filter @inkweaver/h5 typecheck
```

### 2. 功能验证（手动）

**场景 A：新建文档，输入标题**
1. 进入 `/documents/new`（或 h5 对应路由）
2. 标题输入框输入"测试标题"
3. 验证：输入第一个字后焦点保持，能连续输入
4. 验证：`document.id` 仍为 `''`（React DevTools 检查）
5. 验证：`tempIdRef.current` 已生成（控制台日志或调试器）
6. 验证：localDB 中有 temp- 开头的文档记录

**场景 B：新建文档，输入内容**
1. 进入新建文档页
2. 编辑器输入内容
3. 验证：内容正常显示，无重挂载
4. 验证：`document.id` 仍为 `''`

**场景 C：保存新建文档**
1. 输入标题与内容
2. 点击保存
3. 验证：`documentApi.createDocument` 被调用
4. 验证：`cleanupTempDocument` 被调用，temp 缓存清理
5. 验证：`tempIdRef.current = null`
6. 验证：`navigate('/documents/{response.id}')` 跳转
7. 验证：跳转后 `document.id` 为正式 id

**场景 D：编辑已有文档**
1. 进入 `/documents/{id}`
2. 修改标题与内容
3. 验证：`ensureTempId` 不被调用（`id` 存在，走 if 分支）
4. 验证：`document.id` 始终为路由 id，不变
5. 验证：yMap.observe 回调的等值短路生效，无重复 setDocument

**场景 E：远端同步标题更新**
1. 用户 A 在编辑文档标题
2. 用户 B 同步修改同一文档标题
3. 验证：用户 A 的 yMap.observe 回调触发，`newTitle` 与 `prev.title` 不同 → setDocument 更新
4. 验证：InkWeaverEditor 的 title prop 变化 → 内部 state 同步 → input 显示新标题（焦点不丢失，因为 key 不变）

**场景 F：H5 端 disposer 验证**
1. h5 端进入临时文档编辑页
2. 输入内容触发 update 监听
3. 离开页面（返回）
4. 验证：`tempUpdateDisposers.current.get(tempId)` 被调用，`yDoc.off('update', handleUpdate)` 执行
5. 验证：无内存泄漏（Chrome DevTools Memory 面板）

### 3. 回归验证

- 重新验证场景 A-F 在 web 与 h5 两端均通过
- 验证 `apps/web/src/components/accessibility.test.ts` 仍通过（涉及 InkWeaverEditor）：
  ```bash
  pnpm --filter @inkweaver/web test
  ```

---

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `apps/web/src/pages/DocumentEditPage.tsx` | 编辑 | 改动 1-6（tempId 集中 + 删 origin 过滤） |
| `apps/h5/src/pages/DocumentEditPage.tsx` | 编辑 | 改动 1-6 + 8（tempId 集中 + 删 origin 过滤 + H5 disposer） |
| `packages/editor-web/src/components/InkWeaverEditor.tsx` | 不改 | 保留现有 title 缓冲层 |

**不改动**：
- `packages/sync-engine/`（getYDoc 无需改动）
- `packages/db-adapter/`（localDB 接口无需改动）
- `packages/editor-web/`（InkWeaverEditor 保留现状）

---

## 风险与回滚

### 风险

1. **`document.id` 不再写回 tempId 后，依赖 `document.id` 的其他 UI 可能受影响**
   - 调研结论：仅 5 处使用 `document.id`，全部是 `document.id || generate` 兜底模式，改造后均用 `ensureTempId()`，无其他 UI 依赖
   - 风险低

2. **删除 origin 过滤后，本地输入可能触发 yMap.observe 二次 setDocument**
   - 已通过等值短路覆盖：`handleTitleChange` 先 setDocument → yMap.observe 读到相同 title → `prev.title === newTitle` 返回 prev
   - 风险低

3. **H5 disposer 修复可能影响现有卸载流程**
   - H5 当前无 disposer，新增 disposer 是纯增量
   - cleanup 中调用 disposer 与 Web 端对齐
   - 风险低

### 回滚

若验证失败，可按改动顺序逐项回滚：
1. 回滚改动 6（恢复 origin 过滤）
2. 回滚改动 2-5（恢复 `document.id || generate` 模式）
3. 回滚改动 1（删除 `tempIdRef` + `ensureTempId`）
4. 回滚改动 8（H5 disposer，独立可回滚）

每一步回滚后重新验证对应场景。
