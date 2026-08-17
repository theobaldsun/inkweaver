# SyncBox-AI（InkWeaver）Agent 指南

本文件是仓库自带的工程指南，适用于处理 InkWeaver 代码和项目文档。权限、能力状态和外部操作由当前 Codex 治理上下文决定，本文件不扩大授权。

## 标准工作流

1. 明确目标、影响范围和验证标准。
2. 在 `apps/`、`packages/`、`deploy/` 或 `docs/` 中定位真实入口。
3. 遵循现有 workspace 依赖，实施最小且可逆的改动。
4. 根据改动范围运行相关 `typecheck`、`lint`、构建或定向测试。
5. 只有行为、架构、部署方式或已验证排障结论发生变化时，才更新对应文档。

## Monorepo 结构

| 层级 | 内容 |
|------|------|
| `apps/` | `server`、`web`、`h5`、`mobile`、`admin` |
| 基础包 | `shared`、`assets`、`adapters` |
| 数据与业务包 | `api`、`services`、`db-adapter`、`sync-engine` |
| 编辑器与界面包 | `editor-core`、`editor-web`、`editor-mobile`、`ui` |

## 依赖边界

- 应用可以依赖共享包，但应用之间不得相互引用。
- `shared` 和 `assets` 不依赖其他 workspace 包。
- `editor-web`、`editor-mobile` 依赖 `editor-core`，`editor-core` 依赖 `shared`。
- `sync-engine` 只依赖 `db-adapter` 与 `shared`。
- `services` 依赖 `api` 与 `shared`；`ui` 当前依赖 `services` 与 `shared`。
- `apps/server` 负责 Nest 服务端模块；`packages/api` 和 `packages/services` 面向可复用客户端访问与业务流程。

## 文档入口

| 文档 | 用途 |
|------|------|
| [docs/README.md](docs/README.md) | 文档中心与项目结构总览 |
| [架构.md](docs/架构.md) | 模块职责、依赖边界与同步链路 |
| [UI规范.md](docs/UI规范.md) | 设计令牌、组件与跨端 UI 约束 |
| [运维.md](docs/运维.md) | 环境、部署、迁移、监控与排障 |
| [Issue.md](docs/Issue.md) | 已验证的问题根因与修复记录 |
| [技术笔记.md](docs/技术笔记.md) | 结合项目代码理解技术原理的深度笔记 |

## 常用命令

```bash
pnpm install
pnpm dev:server
pnpm dev:web
pnpm typecheck
pnpm lint
```

启动 Docker、本地服务、生产部署或迁移前，应先确认当前任务授权与环境文件已准备好。

## CodeGraph

- CodeGraph 是项目级条件能力，仅用于直接检查不足以完成的跨包依赖、调用链、架构或影响分析。
- 已知文件修改、文档任务、常规命令和常规测试不得调用。
- 项目配置只开放 `codegraph_explore`；不得自动初始化或扩大 MCP 工具范围。
- 初始化、重建或同步索引必须符合侧车能力状态，并获得当前任务明确授权。

## 项目内规则

- `AGENTS.md`：项目工程规范和 Agent 指令入口。
- 排障结论经验证后应记录到 `docs/Issue.md`，格式包含日期、模块、现象、根因、修复和验证标准，避免重复排障。
- **技术原理笔记**：当在修复 bug 或重构过程中，通过阅读项目代码深入理解了某项技术原理（如框架生命周期、依赖注入机制、并发模型等），应将分析过程、时序图、关键概念和教训记录到 `docs/技术笔记.md`。每条笔记需关联具体项目文件和行号，便于后续查阅。

## 代码注释规范

### 必须添加注释的场景

1. **文件级注释**（每个 Service/Controller/Entity 文件顶部）
   - 说明文件用途和核心职责
   - 列出数据来源或依赖的表/模块
   - 描述关键策略（如缓存策略、限流策略等）

2. **接口/类型字段注释**（Interface 每个字段）
   - 用 `/** */` 标注字段含义和单位（字节、百分比等）
   - 标注可选字段的语义（如 `recalculated`、`stale`）

3. **类属性注释**（私有属性）
   - 说明 Map/Set 的用途（如防抖定时器、告警用户集合）

4. **方法级 JSDoc**（所有 public 方法）
   - 描述方法功能和业务背景
   - 列出关键步骤或策略流程（如 4 步缓存判断）
   - 注明参数含义和特殊约束
   - 对复杂计算说明性能考量（如"使用原生 SQL 避免 Node.js Buffer 性能问题"）

5. **行内注释**（关键逻辑分支）
   - 缓存判断、降级逻辑、配额阈值等关键分支处添加中文注释
   - 说明"为什么这样做"而非"做了什么"

### 注释示例

```typescript
/**
 * 存储用量统计结果（面向客户端的响应结构）。
 */
export interface ServerStorageUsage {
  /** 已使用字节数（文档 + 同步数据） */
  usedBytes: number;
  /** 使用率百分比（0-100，保留两位小数） */
  usagePercent: number;
  /** 缓存是否已过期（重算失败降级时为 true） */
  stale?: boolean;
}

@Injectable()
export class StorageUsageService {
  /** 防抖定时器：userId → setTimeout 句柄。用于合并同一用户的多次重算请求 */
  private readonly pendingRecalc = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * 获取用户存储用量。
   *
   * 策略：
   * 1. 缓存有效 → 直接返回缓存（recalculated=false）
   * 2. 缓存过期或 force=true → 触发全量重算
   * 3. 重算失败 → 降级返回缓存（stale=true）
   * 4. 无缓存且重算失败 → 抛出异常
   *
   * @param userId 用户 ID
   * @param options.recalculate 是否强制重算（忽略缓存）
   */
  async getUserStorageUsage(
    userId: string,
    options?: { recalculate?: boolean },
  ): Promise<ServerStorageUsage> {
    // 缓存有效，直接返回
    if (!options?.recalculate && calculatedAt > 0 && !cacheExpired) {
      return this.buildCachedResponse(userId, user, cachedUsed, quotaBytes);
    }
    // ...
  }
}
```

### 注释原则

- 使用中文注释，保持简洁明了
- 优先解释 **Why**（为什么）而非 **What**（做了什么）
- 对业务特有概念补充背景（如"Yjs 快照用于加速客户端同步"）
- 不要添加显而易见的注释（如 `// 增加 1`）

不得引用或依赖仓库外的个人 Skill、个人资料目录或未注册项目。
