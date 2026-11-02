# Agent 模块知识问答

> 按知识点组织的「为什么」级沉淀库，分类严格对齐 [`AI-Agent前端-面试准备总览.md`](../../AI-Agent前端-面试准备总览.md) 的知识域（NestJS / Node.js / 数据库 / 并发 / 设计模式 / TypeScript / 网络协议），服务于求职备战与源码深读。
> 文件定位（代码地图）与阅读路线见 [`Agent阅读指南.md`](./Agent阅读指南.md)；本文件只回答"为什么这样设计"。

---

> **代码地图（按四层定位每个文件该看什么、盯什么）已并入 [`Agent阅读指南.md`](./Agent阅读指南.md) 的「第三遍代码地图」章节。** 本文件专注"为什么这样设计"的知识点问答。

---

# 第三遍知识笔记（按知识点）

> **定位**：第三遍是「逐行读懂 + 追根溯源」的一遍，穿插复习/学习底层知识——Node、Nest、数据库、设计模式、TypeScript、并发一致性等。本部分**按知识点**沉淀，分类严格对齐 [`AI-Agent前端-面试准备总览.md`](../../AI-Agent前端-面试准备总览.md) 的知识域（NestJS / Node.js / 数据库 / 并发 / 设计模式 / TypeScript / 网络协议），服务于求职备战。
>
> **写法约定**：每个知识点直接贴真实代码 + 解析（讲清"为什么"，配硬理由），不靠行号代替、不写冗余的面试话术。
>
> **延伸处理**：对某个知识点产生的延伸追问，真正解答后作为**独立知识点**归入对应分类，不挂在原条目下，避免相似问题冗余。
>
> **配套文档**：阅读路线与代码地图 → [`Agent阅读指南.md`](./Agent阅读指南.md)；面试总框架 → [`AI-Agent前端-面试准备总览.md`](../../AI-Agent前端-面试准备总览.md)。

---

## 问答索引（按问题定位答案）

> 本文件每条都是「问题 → 答案（贴真实代码 + 讲清为什么）」。先按下表找到所属知识域，再在该分类章节内找对应小节。

| 知识域 | 常见问题 |
| --- | --- |
| **NestJS · DI 容器** | 为什么 `module` 和 `controller` 都要 `import` 同一个类？`@Injectable()` 到底做了什么？装饰器元数据 `design:paramtypes` 从哪来？为什么无状态 Helper 用 `manager` 构造而不注册 provider？什么依赖该注入、什么不该？ |
| **NestJS · 模块边界** | 模块之间怎么划边界？哪些东西不该跨模块？ |
| **NestJS · Provider 生命周期** | `onModuleInit` 与构造函数有何区别？为什么轮询放 `onModuleInit`？`await pending` 为何不销毁连接池？单例作用域是什么？`.unref()` 与优雅关闭如何配合？ |
| **NestJS · 异常过滤器** | `ArgumentsHost` 是什么？`host.switchToHttp()` 做什么？为什么 `INVALID_*` 归 400、其余归 409？SSE 已发首字节后为何只能 `end()`？ |
| **TypeScript** | `import` 与 `import type` 在注入场景有何差异？索引访问、字面量联合、`ReturnType<typeof setTimeout>`、`Number.isSafeInteger` 怎么用？ |
| **数据库 · ORM/事务/锁** | `DataSource` 与 `EntityManager` 是什么关系？为什么迁移就绪检查不该放每个请求？事务隔离、行锁、咨询锁、乐观锁 CAS 各解决什么问题？ |
| **并发与一致性** | 租约与心跳怎么防崩溃后无人收尾？幂等靠什么实现？状态机与终态守卫怎么写？SSE 每用户并发配额怎么控？ |
| **设计模式** | 依赖注入的边界在哪？策略模式（`VectorStore` 双实现）怎么落地？为什么 Store/Writer 要分层不合并？ |
| **网络协议** | SSE 断线续传（`Last-Event-ID`/`after`）怎么工作？`MessageEvent` 与 heartbeat 结构？HTTP 400 vs 409 语义？REST 路径段语义？ |
| **RxJS / 异步流** | RxJS 在本项目哪里用、怎么用？ |
| **前端层** | SSE 为什么用 XHR adapter？粘包怎么处理？`citedText` 为何不用 `dangerouslySetInnerHTML`？两阶段保存前端怎么交互？ |

---

## 分类索引（对齐面试总览知识域）

| 知识域（总览章节）           | 子主题                                                        | 已沉淀知识点                                                                                   |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **NestJS（§1.3.6）**  | DI 容器                                                      | 双重引用 / Provider 托管本质 / 装饰器反射与 `design:paramtypes` / 无状态 Helper 用 manager 构造而非注册 provider / **DI 的边界：五种依赖三条路与三步自检** |
| **NestJS（§1.3.6）**  | 模块边界                                                       | 待补                                                                                       |
| **NestJS（§1.3.6）**  | Provider 生命周期                                              | `@Injectable()` 与五个生命周期钩子及调用顺序 / 轮询放 `onModuleInit` 不放构造器 / `await pending` 但不销毁连接池 / 单例作用域 / Node 定时器 `.unref()` 与优雅关闭双保险 / `implements` 可写多个 |
| **TypeScript**      | 类型导入 / 装饰器                                                 | `import` vs `import type` / 类型技巧（索引访问、字面量联合、`ReturnType<typeof setTimeout>`、`Number.isSafeInteger`） |
| **Node.js（§1.3.1）** | 事件循环 / Stream / 定时器 / Cluster                              | 定时器 `.unref()`/`.ref()` 与 ref 状态如何影响进程退出（见 §1.3，Node `Timeout` 对象非 ES 标准 API、`ReturnType<typeof setTimeout>` 兜底 Node/DOM 差异）；其余待补 |
| **数据库（§1.3.3）**     | 类型ORM：DataSource 与 EntityManager / 事务隔离 / 行锁·咨询锁 / 乐观锁 CAS | DataSource 与 EntityManager（manager 是什么、如何映射表、DI 不负责表映射）/ 迁移就绪检查为何不该放每请求（已移除的反例） |
| **并发与一致性**          | 租约·心跳 / 幂等 / 状态机 / 终态守卫                                    | SSE 每用户并发配额（Map + acquire/release 配对）/ 游标硬校验 / 最长存活 deadline；租约与幂等待补 |
| **设计模式**            | 依赖注入 / 状态机 / 策略 / 观察者 / 工厂                                 | DI 的边界（何时不该注入，§1.1 小结）/ 策略模式（`VectorStore` 双实现 Pg↔Qdrant）/ 无状态 Helper 以 manager 构造；其余待补 |
| **网络协议**            | HTTP / SSE / REST / 断线续传                                   | SSE 轮询封装与 `Last-Event-ID` 续传 / `MessageEvent` 结构与 heartbeat / HTTP 状态码 400 vs 409 / REST 路径段语义（见 §四） |

---

## 一、NestJS（§1.3.6：DI 容器 / 模块边界 / Provider 生命周期）

### 1.1 DI 容器

#### 双重引用：module 与 controller 都要 import 同一类

**代码**

`agent.module.ts` 把 `AgentService` 放进 `providers`（注册）：

```typescript
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
// ...
@Module({
  controllers: [AgentController],
  providers: [AgentModelClient, AgentKnowledgeService, AgentService],
})
export class AgentModule {}
```

`agent.controller.ts` 又 import 一次，并在构造器用它的类型（声明依赖）：

```typescript
import { AgentService } from './agent.service';
// ...
export class AgentController {
  constructor(private readonly agent: AgentService) {
    this.reader = new AgentRunReader(agent.dataSource.manager);
  }
}
```

**解析**

两处 import 干的是完全不同的事，不是重复：

- **module 处 = 注册 Provider（生产方声明）**。只有写进 `providers`，容器才知道"本模块能提供 `AgentService` 实例"。`providers` 数组需要类的运行时引用本身，所以必须 import。
- **controller 处 = 声明依赖类型（消费方声明）**，两个作用：
  - 类型注解——构造器参数 `agent: AgentService` 里的 `AgentService` 是类型，TS 不 import 会报 `Cannot find name 'AgentService'`。
  - 供反射 DI 用——编译后 TS emit `design:paramtypes` 记录"构造器第 1 个参数想要的类型是 `AgentService`"，容器启动时读它按类型匹配并注入。这个元数据正是因为 controller 文件里 import 了 `AgentService` 才 emit 出来；不 import 会退化成 `Object`/`undefined`，启动抛 `Nest can't resolve dependencies`。

类比：module 处 = 自动贩卖机"上架了 AgentService"；controller 处 = 你手里的杯子贴着"AgentService"标签去接。两者在不同文件、不同编译单元，各自都得引用这个符号，谁也替代不了谁。

#### Provider 托管本质：必须声明 providers、不能手动 new

**代码**

`AgentService` 构造器要 4 个依赖，并实现 `OnModuleInit` 生命周期钩子：

```typescript
@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  readonly catalog = new ToolCatalog();
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private pending?: Promise<void>;
  private runner?: AgentGraphRunner;

  constructor(
    readonly dataSource: DataSource,
    readonly model: AgentModelClient,
    private readonly knowledge: AgentKnowledgeService,
    private readonly index: DocumentIndexService,
  ) {
    assembleV1Tools(this.catalog, dataSource.manager);
  }

  onModuleInit(): void {
    const loop = () => {
      if (this.stopping) return;
      this.pending = this.tick().catch(() => {
        this.logger.warn('AGENT_DISPATCH_UNAVAILABLE');
      }).finally(() => {
        if (!this.stopping) { this.timer = setTimeout(loop, 2000); this.timer.unref(); }
      });
    };
    this.timer = setTimeout(loop, 2000);
    this.timer.unref();
  }
}
```

`agent.module.ts` 把它放进 `providers` 才被容器托管：

```typescript
providers: [AgentModelClient, AgentKnowledgeService, AgentService],
```

**解析**

`providers` 不是"为了让 controller 能 import"——import 是 TS 符号引入，与 providers 无关。`providers` 是告诉容器"这个类由我来托管"。托管意味着容器替你做三件手动做不到/做不对的事：

- **递归解析构造依赖**。上面构造器要 `dataSource / model / knowledge / index`，它们本身也是 `@Injectable()`，有的还有自己的依赖（如 `AgentKnowledgeService` 依赖 `SearchService`）。容器沿依赖图自动递归 new 并注入。手动 `new AgentService()` → TS 直接报"缺少 4 个参数"；硬塞也得自己织整张依赖图，且每个都得拿对"那个被全局共享的"实例（如 `DataSource` 是 TypeORM 配好的连接池，你 new 一个是新建一套连接，跟全应用其他 Repository 断开）。
- **调用生命周期钩子（最致命）**。`AgentService` 实现 `OnModuleInit`，容器在模块启动后自动调 `onModuleInit()`，里面启动每 2 秒一次的 `tick()` 调度循环。手动 `new` → `onModuleInit` 是普通方法没人调它 → `tick` 轮询永远不启动 → 整个 Agent 后台调度（派发 Run、回收过期租约、取消结算）全死。
- **单例共享 + 框架能力**。容器保证模块内是同一个实例——controller 注入的、`onModuleInit` 里 `this.tick()` 用的、其他 provider 要的，全是这一个；其内部状态（`timer`/`stopping`/`pending`/`runner`/`catalog`）才有意义。手写 `new` 出来的是孤立实例：状态隔离、`tick` 没启动。DI 还顺带给拦截器、守卫、`useFactory/useValue`、测试 `overrideProvider` 等能力——手动 new 全无。

一句话：`providers` 是"让容器接管类的实例化、依赖解析、生命周期、单例共享"的开关。不声明它，`AgentService` 只是个普通类——能 import 符号，但 new 它要么编不过（缺参），要么跑不起来（onModuleInit/tick 不触发），要么跑出岔（多实例、状态隔离）。

#### 装饰器反射与 `design:paramtypes`：DI 元数据从哪来

**代码**（同一文件里两种 import 并存）

```typescript
import { AgentService } from './agent.service';          // 普通 import：要被注入
import type { CreateAgentRequest } from './agent-conversation.store';   // import type：仅类型
import type { PrepareAgentDocumentSave } from './agent-document-save.store';
import type { MessageEvent } from '@nestjs/common';
import type { Request, Response } from 'express';
```

**解析**

NestJS 的依赖注入靠 `reflect-metadata` 库 + TypeScript 的 `design:paramtypes` 元数据实现：

- 编译后，TS 给每个有装饰器的类的构造器 emit 一段元数据 `design:paramtypes`，记录"构造器第 N 个参数想要的类型"。容器启动时读这段元数据，去容器里按类型匹配并注入实例。
- 这段元数据是 TS 因为你在文件里 import 了那个类才 emit 出来的。若构造器参数类型只靠 `import type` 引入，在 `verbatimModuleSyntax` / `isolatedModules` 下，类型引用会在 emit 时被剥掉，paramtype 退化成 `Object`，NestJS 就无法知道该注入谁，启动抛 `Nest can't resolve dependencies`。

所以同一个文件里"普通 import"和"import type"混用是有意为之：被 `@Injectable()` 注入的类必须普通 import（DI 需要具体类引用）；只在方法签名/返回类型当类型用、不参与 DI 的符号（如 `CreateAgentRequest` / `Request` / `Response`）可安全写成 `import type`（编译后整行抹掉、零运行时开销）。

#### 无状态 Helper 由调用方以 manager 构造，不注册为 provider

**代码**

`AgentRunReader` / `AgentRunWriter` 的构造器只吃一个 `EntityManager`：

```typescript
// agent-run.reader.ts
export class AgentRunReader {
  constructor(private readonly manager: EntityManager) {}
}

// agent-run.writer.ts
export class AgentRunWriter {
  constructor(private readonly manager: EntityManager) {}
}
```


`AgentRunWriter.transition` 在事务内部用事务 manager 现造低层 `AgentRunStore`（它吃 `Repository`）：

```typescript
async transition(userId: string, runId: string, expected, event): Promise<AgentRun> {
  return this.manager.transaction('READ COMMITTED', async (manager) => {
    await lockAgentOwner(manager, userId);
    const run = await new AgentRunStore(manager.getRepository(AgentRun)).transition(userId, runId, previous, { type: cause });
    await appendAgentEvent(manager, run, { /* schemaVersion:1, type:'RUN_STATUS_CHANGED', payload:{...} */ });
    return run;
  });
}
```

**解析**

这类 Store / Writer / Reader / Runner 不是每个都注册成 NestJS provider，而是由调用方 `new X(manager)` 现造。原因正是**事务组合**：

- 它们是无状态的数据访问 Helper，本身不持有连接，只持有"这一次要用哪个 manager"。
- 调用方决定事务边界：读场景（controller 的快照查询）传 `agent.dataSource.manager`（默认 manager，无事务，每条语句自动提交）；写场景（`AgentRunWriter.transition`）先 `manager.transaction(...)` 开事务，把**事务作用域内的 manager** 往下传，低层 `AgentRunStore`、`appendAgentEvent` 都用这同一个 manager 操作——于是"用户锁 → 状态 CAS → 写事件"要么全提交、要么全回滚。
- 若把它们注册成 provider（单例、固定持有默认 manager），就拿不到调用方事务里的 manager，无法参与外层事务的组合。所以"传 manager 构造"是故意的：让 Helper 既能被事务复用，又保持无状态、可任意组合。这与前面"Provider 托管本质"互补——**只有需要被 DI 托管生命周期/单例/注入的才注册 provider；只在某次调用内参与事务的轻量 Helper，用 manager 现造更合适**。

#### 小结：DI 的边界——它不是可以毫无限制用的

把本节几条结论收拢成一张判据表。**同一个项目里五种依赖，走了三条不同的路**，这就是"DI 有边界"最直接的证据：

| 依赖形态 | 本项目实例 | 走哪条路 | 判据 |
|---|---|---|---|
| 跨模块协作者，容器建立、需共享、持有资源 | `DataSource`、`AgentModelClient` | **DI 注入** | 连接池/客户端要有人统一建、统一关；多处共享同一实例 |
| 需要按环境切换实现 | `PgVectorStore` / `QdrantVectorStore`（`VectorStore`） | **DI 注入 + 改模块配置** | 换实现不动调用方 |
| 只在某次调用内参与事务组合 | `AgentRunReader` / `AgentRunStore` / `AgentSaveService` / `ToolAuthorization` | **调用方 `new` 并传 manager** | 必须拿到调用方事务里的 manager |
| 异步构造 + 懒加载 + 唯一消费者 | `AgentGraphRunner`（`agent.service.ts:180`） | **调用方 `new`，字段缓存** | 依赖 `await createAgentCheckpointer(pool)` 且可能抛；DI 的 `useFactory` 会把"建连+自检"提前到启动期，破坏"模型关闭永不建 Graph"的降级语义 |
| 无参、自洽、只有一个消费者的内部零件 | `catalog = new ToolCatalog()` | **字段初始化器自建** | 零外部信息，注入了没换来共享只换来耦合 |
| 单步操作用到的最小依赖 | `assembleV1Tools(catalog, manager)` | **显式函数参数** | 签名即依赖声明，参数越窄越难误用 |

**为什么不能"毫无限制地用"——四条硬理由：**

1. **DI 不减少依赖，只改变接线方式。** 四个构造参数该多少还是多少；注入只是把"索取"集中到一处、可审查。把内部零件也塞进 `providers`，依赖一条没少，模块文件却变成了布线文件。
2. **DI 只管"谁提供"，不管"怎么用"。** 生命周期钩子、事务边界、并发配额、租约回收——这些全得自己写。今天重构的 `AgentStreamRegistry`（每用户 4 条配额）、`agent_tool_attempts.leaseExpiresAt`（崩溃恢复）都是 DI 边界之外的手写逻辑。别以为注入了就安全了。
3. **每个 provider 都有成本。** 启动时多一次反射解析、模块里多一行登记；`Scope.REQUEST` 还有每请求开销。全项目 11 个 provider 左右，登记得过来；一个类内部有几个零件就登记几个，登记表会先烂掉。
4. **模块边界是硬墙。** 注入了就在模块作用域内，别的模块用要走 `exports`。把内部零件注册成 provider，等于把私有实现意外变成对外接口（`ToolCatalog` 若注册，别的模块想用得先求 `exports`）。

**三步自检（看到一段代码时问自己）**：

```
① 除了我还有别人用它吗？       只有我    → 别注入了，就地造
② 造它需要环境信息/资源吗？     需要      → 交给 DI（或 useFactory）
③ 将来可能要换实现吗？         可能要换  → 先定义接口 + 注册 provider
三个都答"否" → 它就该是个普通 new 或字段初始化器。
```

一句话：**DI 的价值是解耦"需要什么"和"具体给哪一个"；当只有一个实现、一个消费者时，这个解耦没有买家，你却要付布线和模块边界的成本。** 这与删 `ensureReady` 是同一条工程判断——**有能力做 ≠ 有理由做**。

### 1.2 模块边界

> 待补：跨模块依赖（`exports` / `imports`）、模块内 Provider 如何被限定在模块作用域、为什么同模块内引用不需 `exports`。

### 1.3 Provider 生命周期

#### `@Injectable()` 与生命周期钩子：AgentService 为什么实现 OnModuleInit / OnModuleDestroy

**代码**

```typescript
@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  /** 单进程轮询句柄，不承担持久化职责。 */
  private timer?: ReturnType<typeof setTimeout>;
  /** 停止接收新轮次。 */
  private stopping = false;
  /** 本进程已开始的轮询，用于退出时等待连接归还。 */
  private pending?: Promise<void>;

  /** 启动无重入维护循环；关闭模型时不执行 Graph，也不触发知识检索。 */
  onModuleInit(): void {
    const loop = () => {
      if (this.stopping) return;
      this.pending = this.tick().catch(() => { this.logger.warn('AGENT_DISPATCH_UNAVAILABLE'); }).finally(() => {
        if (!this.stopping) { this.timer = setTimeout(loop, 2000); this.timer.unref(); }
      });
    };
    this.timer = setTimeout(loop, 2000);
    this.timer.unref();
  }

  /** 等待当前短事务/模型超时收尾；不销毁 TypeORM 所持连接池。 */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pending;
  }
```

**解析：`@Injectable()` 是"让 DI 容器接管这个类"的声明**

它本身**没有任何运行时行为**——不创建实例、不注册任何东西。它唯一的作用是给 TS 编译器发射一个**设计时元数据**标记（`design:paramtypes`），让 Nest 在 `providers` 数组里看到这个 token 时知道"这个类的构造函数参数可以被反射、可以按类型注入"。所以它和 `providers: [AgentService]` 是**一对**：`providers` 说"我要这个单例"，`@Injectable()` 说"我的依赖可以被容器解析"。

- **不带 `@Injectable()` 的类放进 `providers` → 启动即报错**（`Nest can't resolve dependencies`）。反过来说：如果一个类只被 `new`（像 Store/Reader 那些无状态 Helper），不需要 `@Injectable()`。
- 它是**类装饰器**，不是方法装饰器；写在类定义的上一行。
- 换别的 DI 框架（Angular 的 `@Injectable()`）是同一思路——差别只在 Nest 是**按类型 token**解析，Angular 还要 `providedIn`。

**生命周期钩子：Nest 提供的全套**（接口只是可选契约，Nest 靠**鸭子类型**检测方法名，不强制 implements）

| 接口 | 方法 | 触发时机 | 本项目对应 |
| --- | --- | --- | --- |
| `OnModuleInit` | `onModuleInit()` | 所有模块的 provider 实例化完、依赖注入完成后，**逐个模块**调用 | `AgentService` 启动轮询循环 |
| `OnApplicationBootstrap` | `onApplicationBootstrap()` | 全部模块初始化完、应用（含监听端口）就绪后 | 未用 |
| `OnModuleDestroy` | `onModuleDestroy()` | 收到终止信号（SIGTERM/SIGINT）、开始关闭时 | `AgentService` 等轮次收尾 |
| `BeforeApplicationShutdown` | `beforeApplicationShutdown(signal?)` | 关闭的最早阶段，可拿到信号名 | 未用 |
| `OnApplicationShutdown` | `onApplicationShutdown(signal?)` | 所有模块销毁完、进程退出前 | 未用 |

**调用顺序**（同步全部实例化 → 回调逐个来，这是 Nest 的一句原话）：

```
启动：实例化全部 provider → onModuleInit（模块 A → B → C）→ onApplicationBootstrap（A → B → C）→ listen 端口
关闭：beforeApplicationShutdown → onModuleDestroy（A → B → C）→ onApplicationShutdown
```

`AgentService` 只实现 `OnModuleInit` + `OnModuleDestroy`，即**两头都要、中间不要**：初始化时序关系少（起个 2 秒定时器不依赖别人），退出必须收尾（见下）。

**为什么 `onModuleInit` 里起轮询而不是构造器里起**

构造器只该做"把依赖接上线"（这里只做 `assembleV1Tools`）。定时器是**副作用**，如果在构造器里起：
- `onModuleInit` 失败/抛错时定时器已经在跑，可能出现半初始化状态；
- 容器可能因依赖解析顺序先构造后注入某些属性，构造期间读到的是"没装配完"的状态；
- 测试里 `new AgentService(...)` 会**连带启动轮询**，不可控。

`onModuleInit` 的语义恰好是"依赖已就位、可以启动后台任务了"。

**为什么 `onModuleDestroy` 要 `await this.pending` 但不销毁连接池**

```typescript
this.stopping = true;                     // 阻止排下一轮
if (this.timer) clearTimeout(this.timer); // 取消还没触发的下一轮
await this.pending;                        // 等已在跑的这一轮落地
```

- `stopping` 是**协作式取消的标志位**，`.finally()` 里 `if (!this.stopping)` 靠它把自持链断掉——和 SSE 那段的 `stopped` 是同一个模式（见 §追问 C/D）。
- `clearTimeout` 只能取消**还没触发**的定时器；`await this.pending` 是等**已经发出去**的这一轮（一个短事务 + 至多一次模型调用）跑完，避免半截事务。
- **不调 `dataSource.destroy()`**：连接池是 `TypeOrmModule.forRoot` 建的、由 Nest 统一管理生命周期。Provider 只管自己那部分资源，去销毁别模块/更上层持有的连接是越界。
- `this.timer.unref()`：标记这个定时器"不算留住进程的待办"。（是否必要见本节末的追问结论——在本项目当前形态下它其实够不着，属于低价值保险；不要把它说成"必须"。）

**单例作用域**

Nest provider 默认 `DEFAULT` scope = **单例**，容器起来时构造一次、全程共享。这解释了为什么 `AgentService` 能用实例字段（`catalog` / `timer` / `pending`）承载"进程级唯一"的状态：对象级 state 在这里就等于进程级 state。若哪天有人写成 `@Injectable({ scope: Scope.REQUEST })`，这些字段语义全变（每个请求一个新实例、`timer` 每人一个）。

（其他 scope 还有 `TRANSIENT`——每次注入新建、不共享；本项目未用。三类里只有 `DEFAULT` 和 `TRANSIENT` 对所有 provider 通用，`REQUEST` 仅对Controller/GraphQL/某些 provider 生效且有性能代价。）

#### Node 定时器与 `.unref()`：它从哪来、为什么这里必须调（知识域：Node.js §1.3.1）

**代码**

```typescript
this.timer = setTimeout(loop, 2000);
this.timer.unref();
// loop 内部自续时同样两句
this.timer = setTimeout(loop, 2000);
this.timer.unref();
```

**① `.unref()` 不是 ECMAScript 的 API，是 Node 私有的。** 浏览器里 `setTimeout` 返回 `number`，没有这个方法；Node 返回一个 **`Timeout` 对象**，上面有 `unref()` / `ref()` 一对方法（`unref()` 返回 Timeout 本身，可链式）。本机实测：

```
typeof t        → 'object'
t.constructor   → Timeout
typeof t.unref  → 'function'   typeof t.ref → 'function'
```

TS 里能直接 `this.timer.unref()` 不报错，是因为项目 `lib: ["ES2022"]` + 装了 `@types/node`——Node 的全局声明把 `setTimeout` 覆盖成返回 `NodeJS.Timeout` 的重载。这也解释了项目里定时器字段为什么一律写成 `ReturnType<typeof setTimeout>`（`agent.service.ts:49`、`agent-run-stream.poller.ts:48`、`tool-executor.ts:121`、`storage-usage.service.ts:61`）：**这个写法在 Node（`Timeout`）和 DOM（`number`）下都能编译**，换环境不用改字段类型。

**② 它做什么：把定时器从"留住进程"的集合里摘掉。** Node 进程只要还有 **ref 状态的待办**（活跃的 TCP 连接、未决的定时器、未关闭的 server handle）就会继续活着；`unref()` 标记这个定时器"不算数"——如果事件循环里只剩它，Node 允许自然退出，不会为了等这 2 秒而挂着。

**③ 这里为什么必须调：调度循环是附属任务，不该成为进程不退出的理由。** 这个 `loop` 是无限自续的（每轮 `.finally()` 里再排一个 2 秒后的自己）。如果不 `unref`，一旦主逻辑收尾（HTTP server 关了、没有别的活儿）而 Nest 的 `onModuleDestroy` 因某种原因没清掉它，进程就会永远挂在"等下一轮轮询"上——表现为容器怎么都退不掉、只能 `docker stop` 超时后强杀。

**④ 但 `unref` 不是"退出保证"，只是"不妨碍退出"。** 服务正常运行期间 HTTP server 在监听（有 ref 状态的活儿），unref 过的定时器**照样每 2 秒触发**。所以它不改变正常运行时的行为，只在"没有别的活儿"时松口。

**⑤ 和 `onModuleDestroy` 是双保险，职责不同**：

| | 处理什么 | 手段 |
| --- | --- | --- |
| `unref()` | 自然退出时不被定时器卡住 | 摘掉 ref 状态 |
| `onModuleDestroy()` | 被 SIGTERM/SIGINT 杀掉时干净收尾 | `stopping=true` + `clearTimeout` + `await this.pending` |

少了 `onModuleDestroy`：进程被杀时 timer 立刻消失，但**在途的那一轮 `tick()`（一个短事务 + 可能一次模型调用）会跟着进程一起死**，留下半截状态。`await this.pending` 等的就是它。两者一个管"退得掉"、一个管"退得干净"。

**⑥ 一个容易看漏的细节**：`this.pending` 在 `tick()` 刚返回 Promise 时就已赋值（而不是等它 settle）。所以即使 `onModuleDestroy` 在轮询**正在跑**的时候被调用，`await this.pending` 也一定能拿到那个 Promise 并等它落地——不会出现"pending 还是 undefined、await 直接跳过"的竞态。

#### 追问：`onModuleDestroy` 明明会清 timer，`unref` 为什么还"必须"

**先纠正一个隐含前提：两者覆盖的不是同一条退出路径，所以不构成重复防御。**

| 退出路径 | 谁处理 | 不处理会怎样 |
| --- | --- | --- |
| 事件循环**自然枯竭**（没有信号、没有别的 ref 待办） | **只有 `unref` 能处理** | 进程永远挂在"等下一轮 2 秒"，`onModuleDestroy` 压根不会被调用 |
| 收到 SIGTERM/SIGINT，且 Nest 已启用关闭钩子 | `onModuleDestroy` 处理 | 在途 `tick()` 被硬杀，可能留半截事务 |

**而且第二条路径在当前项目里实际上是空的。** 全仓 grep 无 `enableShutdownHooks()`（`main.ts` 只 `app.listen(port)`）。Nest 默认**不注册进程信号处理器**，所以：

```
docker stop → SIGTERM → /sbin/tini 转发 → node 默认处置 → 进程立即终止
             （onModuleDestroy 不会执行）
```

（启动链：`Dockerfile` `ENTRYPOINT ["/sbin/tini", "--", "/docker-entrypoint.sh"]` + `CMD ["node", "dist/main.js"]`，entrypoint `exec "$@"` 让 node 直接收信号。）

**这是本项目一个真实的风险点，值得单独记住**：`AgentService.onModuleDestroy` 在当前部署形态下不会因 `docker stop` 触发，在途的 `tick()`（一个短事务 + 至多一次模型调用）会被硬杀。要让第二条路径真正生效，`main.ts` 里 bootstrap 之后需要加一句 `app.enableShutdownHooks()`。

**那 `unref` 的值不值得写？值，而且理由很硬：**

1. **它是唯一不依赖任何调用方的退出保障。** `onModuleDestroy` 依赖一整条链：信号被捕获 → Nest 遍历模块 → 调到本类 → 本类执行成功（中间任何一环断，清理就没了）；`unref` 只是一行标记，没有任何前置条件。用一行不可能失败的代码兜住一类退出路径，是划算的。
2. **它有独立且真实的适用场景**：测试脚本或任何 `new AgentService(...)` 后手动 `onModuleInit()` 而不起 HTTP server 的场合——不 `unref`，测试进程会被这个无限自续的 loop 永久挂住（`node:test` 卡住不退就是这么来的）。HTTP server 的监听是 ref 状态，会掩盖这个问题；但没有 server 的场合它立刻显形。
3. **它是"最后一道"而非"替代品"**：将来启用 shutdown hooks 后，即使 destroy 有遗漏或抛错，最坏结果只是"退得不干净"，不会是"退不掉"。

**准确的职责划分**：`unref` 负责"**没有人在管这个进程时，它也能自己走出去**"；`onModuleDestroy` 负责"**有人在管的时候，退得干净**"。前者不依赖任何人，后者依赖一整条链——所以前者不是后者的冗余，是后者的兜底。

#### 追问：`async tick(): Promise<void>` 里为什么看不到 `new Promise` 的写法

**因为 `async` 关键字就是"自动包装 Promise"的机器**，样板被它吃掉了：

| body 里写 | async 包裹后的实际行为 |
| --- | --- |
| `return;` / `return x` | `resolve(undefined)` / `resolve(x)` |
| `throw e` | `reject(e)` |
| `await ...` | 让出线程，之后从同一处续跑 |

`Promise<void>` 只是这个自动壳子的**类型标注**——"它解决出来的是 undefined"。等价的手写版本：

```typescript
// async 版（现在的写法）
async tick(): Promise<void> {
  if (this.model.isConfigured()) await this.dispatchIndexing();
  await new ToolExecutionMaintenance(...).runOnce();
  // ... 结尾没有 return
}

// 手写等价物（理解用）
tick(): Promise<void> {
  return new Promise<void>((resolve) => {
    void (async () => {
      if (this.model.isConfigured()) await this.dispatchIndexing();
      await new ToolExecutionMaintenance(...).runOnce();
    })().then(() => resolve());
  });
}
```

所以 `async tick(): Promise<void>` 的 `Promise<void>` 不是"号称有 Promise 却没有 Promise 写法"，而是**`async` 替你写了壳，`Promise<void>` 是这个壳的类型**。

**关键推论：调用 async 函数是同步返回 Promise 对象的。** `const p = this.tick()` 这一行立即拿到 Promise，body 却在背后继续跑——这就是 `this.pending = this.tick()` 不构成竞态的原因：赋值发生在 body 第一行执行**之前**的同步阶段。（`this.tick().catch(...).finally(...)` 三个调用都同步返回各自的新 Promise，`pending` 拿到的是最后那个 `finally` 的 Promise。）

#### 追问：那 `.unref()` 在这个项目里到底必不必要——结论：不可达保险

**先把事实钉死**（读了 Nest 11.1.18 源码，`nest-application-context.js:197` `listenToShutdownSignals`）：

```js
await this.callDestroyHook();          // ① onModuleDestroy → AgentService 的 await this.pending
await this.callBeforeShutdownHook(signal);
await this.dispose();                  // ② 关闭 HTTP server
await this.callShutdownHook(signal);
signals.forEach(sig => process.removeListener(sig, cleanup));
if (options.useProcessExit) { process.exit(0); }      // ③ 默认不走这支
else { process.kill(process.pid, signal); }           // ③ 默认：自行重发信号自杀（监听器已移除 → 默认处置 → 立即终止）
```

于是有**两种世界**，两种世界里定时器都阻挡不了退出：

| 世界 | SIGTERM 后发生什么 | 定时器能阻挡退出吗 |
| --- | --- | --- |
| 补 `enableShutdownHooks()` **之前**（改前的本项目） | 信号没被监听 → node 默认处置 → **进程立即死** | 不能，进程直接没了 |
| 补 `enableShutdownHooks()` **之后** | ① destroy 钩子（`await this.pending`）→ ② 关 HTTP server → ③ `process.kill(self, signal)` 自杀 | 不能，第 ③ 步与事件循环里还有没有待办无关 |

`unref` 唯一能起作用的路径是**"全程没有信号、事件循环自然枯竭"**。而这个服务常驻 HTTP server（ref 句柄）+ TypeORM 连接池（ref socket），事件循环永远不空——所以这条路在本项目的运行形态下**不可达**。

**所以：判断它是冗余保险，这个结论是对的**（我上一轮扯"必须"是过度了）。但要跟 `ensureReady` 区分清楚成本：

| | `unref` ×2 行 | `ensureReady`（已删） |
| --- | --- | --- |
| 成本 | 两个无分支、无失败模式的方法调用 | 每请求一次 `information_schema` 查询 + 11 处调用点 + 与 entrypoint 迁移闸门语义重复 |
| 删除收益 | 视觉上少两行 | 去掉真实的每请求开销与重复语义 |

它唯一残存的价值是**语义自明**：写下 `unref()` 等于声明"这个循环是附属任务，不许成为进程不退出的原因"——一行不可能的代码换一个不会失效的意图标记。**要不要删，取决于你更认"零成本意图标记"还是"不写够不着的代码"**，两种立场都站得住。我倾向前者：删它的收益（两行）远小于删 `ensureReady` 的收益（每请求一次查询），而且 Node 里自续定时器的惯用写法就带 `unref`，去掉反而要让 reviewer 问"为什么没有"。

**真正该修、也已经修掉的是另一件事**：`main.ts` 补 `app.enableShutdownHooks()`（4 行，含注释）。这才是"有风险没保障"的那个缺口——在它之前，`AgentService.onModuleDestroy` 在本项目里从来不会因 `docker stop` 而执行。

#### 构造器里装配工具：为什么不等用到再装、也不放 onModuleInit

**代码**

```typescript
constructor(readonly dataSource: DataSource, readonly model: AgentModelClient, private readonly knowledge: AgentKnowledgeService, private readonly index: DocumentIndexService) {
  assembleV1Tools(this.catalog, dataSource.manager);
}
```

**"立即用不到"不是推迟的理由，"需要等待某事就绪"才是。** 装配既不用等、也几乎不会失败，所以最早做完最安全。逐条给硬理由：

**1）装配零成本、零外部依赖。** `assembleV1Tools` 只做两件事：`registerReadDocumentTool(catalog, manager)` 和 `registerCreateDocumentTool(catalog)`——往 `ToolCatalog` 内部的 Map 里塞工具定义（名字、版本、参数 schema、执行器引用）。不查库、不断网、不初始化连接池。`dataSource.manager` 在这里**只是一个对象引用**：读文档工具把它存起来备用，SQL 要到真正 `findOne` 时才发生。所以"连接还没就绪"这个顾虑不成立——`DataSource` 实例本身是 `forRootAsync` 建好连接后由容器持有的对象，`.manager` 是它的默认 `EntityManager` 属性。

**2）fail-fast：装配失败必须让进程起不来。** `assembleV1Tools` 末尾是一次装配后复核：

```typescript
if (catalog.list().some((tool) => tool.origin.kind !== 'builtin')) throw new Error('AGENT_TOOL_ORIGIN_UNSUPPORTED');
```

在构造器里 `throw` → Nest 容器启动失败 → 进程起不来。这正是想要的结果：一个工具有非内置来源混进来的 Agent 服务，**根本不该活到接收请求**。放 `onModuleInit` 理论上也能 fail-fast，但构造器更早、语义更硬（"这个对象造不出来"而非"这个模块初始化失败"）。

**3）构造器返回即完整可用的对象。** `readonly catalog` 是 public 字段，`agent.service.ts:110/127/154/168` 会把它传给 `AgentSaveService` / `ToolAuthorization` / `ToolExecutionMaintenance` / `AgentGraphRunner`（runner 再交给 graph 端口，`catalog.list()`、`selectAgentModelTools(...)` 在运行时被调）。虽然本项目没有别的 provider 在启动窗口期读它，但"任何拿到 `AgentService` 的代码都不必判断 catalog 装没装"是不该破的契约——一旦有人把装配挪到 `onModuleInit`，这个契约就悄悄失效了，而且不会有任何编译错误。

**4）TS 执行顺序保证这在构造器里安全**（这点容易想反，值得单独记）。项目 `tsconfig.base.json` 是 `target: ES2022` + `useDefineForClassFields: true`，编译后大致是：

```js
class AgentService {
  timer; stopping; pending; runner; logger;
  catalog = new ToolCatalog();                       // ← 字段初始化器
  constructor(dataSource, model, knowledge, index) {
    this.dataSource = dataSource;                    // ← 参数属性在最前面赋值
    this.model = model; this.knowledge = knowledge; this.index = index;
    assembleV1Tools(this.catalog, dataSource.manager);   // ← 构造体最后执行
  }
}
```

原生 class field 语义下**字段初始化器先于构造体**，所以 `this.catalog` 已存在；参数属性在构造体最前面赋值，所以 `this.dataSource.manager` 可用。（本机用项目同款配置验证过，输出 `catalog: true, dep: true`。）

**5）和同一类里的"延迟创建"对照，才看得出判据。**

```typescript
/** Graph 延迟创建，未迁移环境不影响其他现有模块启动。 */
private runner?: AgentGraphRunner;
```

runner 是**刻意的 lazy**：创建时要建 checkpointer、编译 LangGraph 图，有实际启动代价，而且在"库还没迁移"的环境会失败——拖累整个模块起不来。工具装配没有这两个问题（纯内存、零失败面），所以 eager。**同一个构造器里既 eager 又 lazy，分野就是"启动代价 × 失败影响面"**：代价接近零就立刻做，有代价/会因环境失败就等真正需要时再做。

**6）那 `onModuleInit` 里那个 `setTimeout` 为什么就不提前？** 因为它符合上面判据的另一半：起轮询是持续副作用（每 2 秒一次 `tick()`，要查库、可能要调模型），且必须等所有依赖就位。构造器里起定时器会让测试里 `new AgentService(...)` 无法控制、装配中途出错时定时器已经在跑。分工因此是：**构造器做"纯内存装配"（确定性、无副作用），`onModuleInit` 做"依赖就绪后的启动动作"**。

#### 为什么四个依赖都写成构造器参数属性，而 `assembleV1Tools` 又只收两个参数

这是一体两面的事：**构造器参数 = 这个对象整个生命周期要用的全部依赖（宽进）；单个函数的参数 = 这一步真正要用的最小依赖（窄收）。**

**A. 依赖只能从构造器进来**

DI 唯一的注入通道是反射构造器参数类型（`design:paramtypes`）。在类上声明字段没有任何机制会填值：

```typescript
private readonly knowledge: AgentKnowledgeService;                 // ← 永远 undefined
constructor(dataSource: DataSource, knowledge: AgentKnowledgeService) {
  this.knowledge = knowledge;                                     // ← 参数属性替你做这一行
}
```

写成 `private readonly knowledge: AgentKnowledgeService`（参数位置）是**声明 + 赋值 + 访问修饰符 + `readonly` 四合一**，一行抵三行。而且只有参数属性能顺手给你 `readonly`：四个依赖全是只读，构造后不可重新赋值，测试里想换 mock 只能重新构造对象，而不是事后偷改字段——后者会让"这个对象到底依赖什么"变得不可追踪。

**"第一条语句用不到"不是不声明的理由。** 构造器的职责是接收**整个生命周期**的依赖，不是用掉参数列表。`AgentService` 里 `this.dataSource` 出现 20+ 次（`:84/101/110/127/135/154/163/173/178/187/200/207…`）、`this.model` 6 次（`:86/98/119/153/158/168`）、`this.knowledge` 1 次（`:168` 传给 AgentGraphRunner）、`this.index` 1 次（`:192` `scheduleReindex`）。全部列在构造器，依赖清单才能一眼扫完。

**B. 修饰符的差异是刻意的访问控制**

```typescript
constructor(readonly dataSource: DataSource, readonly model: AgentModelClient, private readonly knowledge: ..., private readonly index: ...)
```

`dataSource` / `model` 无修饰符 = **public**，`knowledge` / `index` = private。dataSource public 有硬证据：controller 有 4 处直接读 `agent.dataSource.manager` 来构造 Store/Reader（`agent.controller.ts:58/77/142/172`——`new AgentRunReader(agent.dataSource.manager)`、`new AgentEventReader(...)`）。knowledge/index 只在本类内用，所以收紧。

（挑剔一句：`model` 目前也只有本类在读，按最小权限本该收成 private；现在 public 留了点余量，无害但不必要。）

**C. `assembleV1Tools(catalog, manager)` 只收两个参数，正是同一原则的反方向**

**函数签名即依赖声明**——它只需要这两个，签名就写两个。

- 传整个 `this` 进去 → 它隐式获得读写 service 全部字段的能力，改动面不可控；要单测它得先造出一个完整 `AgentService`（连带 DataSource、model、knowledge……）。
- 传 `manager` 而不是 `dataSource` → 它连"`.manager` 是 DataSource 的属性"都不用知道，只关心"一个 EntityManager 句柄"。**参数越窄，能被误用的方式越少**。
- 它是 module 级自由函数（不是类方法），天然没有 `this` 可依赖，所以必须显式收参数——这也让它可以在别的装配场景复用。

**一句话**：宽进是为了让依赖清单集中在一处可审；窄收是为了让每一步都改不动别的东西。两头都是"依赖只在签名单点声明"。

#### `readonly catalog = new ToolCatalog()`：为什么留在字段初始化器而不是构造体

先纠正一个方向：**这里跟"安全考虑"没关系。** `ToolCatalog` 是个**没有任何构造参数**的类（`tool-catalog.ts:81`，内部只有一个 `private readonly tools = new Map<string, AssembledTool>()`），不接凭据、不读外部输入、不碰 IO——`new` 它没有任何安全含义。

安全语义在别处：`tool-catalog.ts` 文件头"仅接受可信适配器，不加载插件、不调用工具"、`ToolAdapterContext` 上"执行时由可信服务端构造，不能从工具参数中提取身份"，以及 `AgentService` 构造器里那次 `AGENT_TOOL_ORIGIN_UNSUPPORTED` 复核——约束的都是**装配与执行**这两个动作，不是 `new ToolCatalog()`。

**真正的判据：这个对象需不需要外部信息。**

```typescript
constructor(readonly dataSource: DataSource, readonly model: AgentModelClient, private readonly knowledge: ..., private readonly index: ...)
readonly catalog = new ToolCatalog();
```

| 依赖 | 来源 | 为什么 |
| --- | --- | --- |
| `dataSource` / `model` / `knowledge` / `index` | 构造器参数（DI 注入） | 跨模块协作者，值必须从外面来，且要能被 mock 替换 |
| `catalog` | 字段初始化器（自建） | 无参、自洽、只服务本类，外部信息为零 |

这不是安全问题，是**依赖方向**：外部依赖 → 注入；内部细节 → 自建。

**技术上确实能挪进构造体，但会一次性失去三样东西：**

```typescript
// 挪进构造体的样子
readonly catalog: ToolCatalog;                       // 声明
constructor(...) {
  this.catalog = new ToolCatalog();                  // 初始化
  assembleV1Tools(this.catalog, dataSource.manager); // 使用
}
```

1. **声明与初始化分离成两处**，中间隔着一串参数属性赋值，读者要跳两处才能确认它存在。字段初始化器把三者压在一行。
2. **时序保证从"位置"退化成形序**。项目是 `useDefineForClassFields: true`，原生 class field 语义下字段初始化器**先于构造体任何语句**执行——`catalog` 的存在性由语言保证。挪进构造体后，`assembleV1Tools(this.catalog, ...)` 的可用性变成依赖"我刚好把赋值写在前一行"：现在没错，但哪天有人把装配包进 `try/catch`、或在中间插代码，顺序就成了没人写下来的隐式契约。
3. **`readonly` 的约束面变窄**。字段初始化器里 `readonly catalog = new ToolCatalog()` 是声明即终值；构造体赋值则允许"先声明、后某处赋值"的写法扩散，静态分析能帮你的地方变少。

**一句话记忆法**：**字段初始化器 = "我出生时就有的东西"；构造器参数 = "我必须从别人那里拿的东西"。** catalog 出生就有，所以它不该出现在"索取清单"里。

#### 那 `catalog` 为什么不干脆注册成 provider 由 DI 注入

**技术上完全可行**：在 `agent.module.ts` 的 `providers` 里加一个 `ToolCatalog`，`AgentService` 构造器就能改成 `constructor(readonly catalog: ToolCatalog, ...)`，Nest 会反射 `design:paramtypes` 把它造好塞进来，`new ToolCatalog()` 那行直接删掉。

但**可行不等于该做**。DI 不是"所有依赖都该走的路"，它有明确的适用条件，`ToolCatalog` 一条都不占：

| DI 的真实适用条件 | `ToolCatalog` 的情况 |
| --- | --- |
| **多个 provider 共享同一实例**（否则各自 new 会状态分叉） | ❌ 全项目只有 `AgentService` 一个消费者 |
| **实例化需要环境信息**（ConfigService / DataSource / 外部客户端） | ❌ 无构造参数，零外部依赖 |
| **需要按环境切换实现**（pgvector ↔ Qdrant、真 ↔ mock） | ❌ 只有一个实现，且不需要替换 |
| **生命周期要对齐容器**（关闭时释放连接/句柄） | ❌ 纯内存 Map，无资源可释放 |

**注入了反而多出三个具体代价：**

1. **装配动作还是没有着落。** DI 递过来的只是一个**空 catalog**，`assembleV1Tools(catalog, dataSource.manager)` 仍然要有人调。而 `assembleV1Tools` 是 `agent.service.ts` 里的模块级私有函数（没 `export`），要用 `useFactory` 把装配也搬进模块，就得先把它 export 出去——让模块配置文件反向依赖 service 内部函数，方向很难看。

2. **测试面变大。** 现在任何调用方 `new AgentService(dataSource, model, knowledge, index)` 就能跑，catalog 自备；注册成 provider 后，想构造 AgentService 就得先有 `ToolCatalog` 实例（或起一个 TestingModule）。

3. **模块边界被无谓扩大。** 一旦进了 `providers`，别的模块想用得走 `exports`；`ToolCatalog` 本来只是 agent 模块的一个内部零件，现在成了对外接口。

**对照——什么才是"该注入"的**（都是本项目的现成例子）：

- `DataSource`：**必须**注入。连接池由容器建立、有生命周期、所有模块共享。它就是 DI 存在的理由。
- `VectorStore` 的 `PgVectorStore` / `QdrantVectorStore`：**该**注入。将来从 pgvector 迁到 Qdrant 只改模块配置，调用方零改动——这是策略模式的标准收益。
- `catalog`：单消费者 + 无参可造 + 无需替换。注入只是把 `new` 从类内搬到模块文件里，**没换来共享，只换来耦合**。

**一句话判据**：**"我一个人用、我自己能造" → 就在原地造；"很多人要用 / 造它需要环境 / 将来要换" → 才交给 DI。** 这跟删 `ensureReady` 那次是同一条：有能力做 ≠ 有理由做。

#### `implements` 后能写几个？除生命周期还 implements 什么

**语法上：想写几个写几个。** TS 的 `implements` 子句接受逗号分隔的接口列表（对比 `extends` 只能跟一个基类）：

```typescript
export class AgentService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  onModuleInit(): void {}
  onApplicationBootstrap(): void {}
  onModuleDestroy(): void {}
  onApplicationShutdown(signal?: string): {}   // 注意这两个签名带可选参数
}
```

**但 `implements` 对 Nest 钩子是纯编译期契约，可省。** Nest 检测钩子靠**鸭子类型**——扫实例上有没有 `onModuleInit` 这个方法名，有没有 `implements` 无所谓。所以省掉 `implements` 运行时完全一样；写它的唯一价值是**让编译器替你校验签名**：方法名拼成 `onModuleinit`、漏掉 `signal?: string` 参数、返回类型不对，写 `implements` 会直接编译报错，不写则静默失效（钩子不触发且不报错，最难查的那种 bug）。

钩子多到影响观感时，可以先用接口继承把它们打包，再实现一个：

```typescript
/** 把四个钩子合成一个语义组，类声明只留一个名字。 */
interface AgentLifecycle extends OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {}
export class AgentService implements AgentLifecycle {}
```

项目里没这么用（`AgentService` 只需要首尾两个，直接写两个更直白）；但当钩子超过三四个、或一类 controller 都要求同一组钩子时，这个打包模式比四个并列更可读。

**除生命周期外，`implements` 在本项目覆盖三类契约**（`grep implements apps/server/src` 的实际结果）：

| 类别 | 接口 | 本项目实例 | 语义 |
| --- | --- | --- | --- |
| Nest 框架契约 | `ExceptionFilter` | `AgentApiErrorFilter`（`agent.controller.ts`）、`GlobalHttpExceptionFilter`（`global-http-exception.filter.ts`） | "我会被框架按这个签名回调" |
| Nest 框架契约 | `CanActivate` | `AuthGuard`（`guard/auth.guard.ts`） | 守卫契约 |
| Nest 框架契约 | `OnGatewayConnection` 等 | `SyncGateway`（`sync/sync.gateway.ts:67`） | WS 网关生命周期 |
| TypeORM 契约 | `MigrationInterface` | `migrations/*.ts` 全部 32 个（`up`/`down`） | "我是迁移链条中的一环" |
| **自建领域接口** | `VectorStore` | `PgVectorStore`（`pg-vector.store.ts:30`）、`QdrantVectorStore`（`vector-store.ts:56`） | 一个接口两个实现，**策略模式**：接口注释写明"便于后期从 pgvector 迁移到 Qdrant"，调用方只依赖 `VectorStore`，换实现不动调用方 |
| 自建领域接口 | `ToolCallLifecycle` | `entity/agent-tool-call.entity.ts` | 实体挂状态机契约 |

**判据（什么时候该写 implements）**：这个类会被**某个框架或别人的代码按固定契约调用**，就写；只是自己 `new` 自己用（`AgentRunStore` / `AgentEventReader` / `AgentToolCatalog` 这些无状态 Helper），不写。前者"实现别人的接口"，后者"提供自己的方法"，`implements` 的有无本身就是这个区别的显式标记。

---

### 1.4 全局异常过滤器与 ArgumentsHost

#### 全局异常过滤器与 ArgumentsHost：host.switchToHttp() 做什么

**代码**（`agent.controller.ts` 顶部的 `AgentApiErrorFilter`）

```typescript
@Catch()
export class AgentApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) { response.end(); return; }
    if (error instanceof HttpException) { response.status(error.getStatus()).json(error.getResponse()); return; }
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.message) ? error.message : 'AGENT_REQUEST_FAILED';
    response.status(code.startsWith('INVALID_') ? 400 : 409).json({ message: code });
  }
}
```

**解析**

- **`ArgumentsHost` 是什么**：它是 NestJS 对"一次调用收到的所有参数"的**抽象包装**，目的是让同一段逻辑能跨传输协议复用。Nest 的请求可能来自 HTTP、RPC（微服务）、WebSocket、GraphQL，不同协议传给处理器的参数形状不同，`ArgumentsHost` 把它们统一成一个接口。它提供 `getArgs()`（原始参数数组）、`getArgByIndex(i)`、`getContext()`，以及按协议切换的 `switchToHttp()` / `switchToRpc()` / `switchToWs()`。
- **`host.switchToHttp()` 做什么**：把抽象参数窄化到 **HTTP 上下文**，返回 `HttpArgumentsHost`，从而拿到 `getRequest()` / `getResponse()` / `getNext()`。过滤器要往 HTTP 响应写状态码和 JSON，必须先切到 HTTP 上下文取出 `response` 对象——这就是 `host.switchToHttp().getResponse<Response>()` 的由来。
- **为什么用 host 而不是直接拿 req/res**：`ExceptionFilter` 是**传输无关**的接口（同一个过滤器可同时用于 HTTP 控制器和 WebSocket 网关）。用 `ArgumentsHost` 包装后，你既能写"只处理 HTTP"的过滤器（像这里用 `switchToHttp`），也能在过滤器里先判断协议再分别处理。`@Catch()` 不传参数 = 捕获所有异常，是全局兜底过滤器。
- **与 `ExecutionContext` 的关系**：在守卫/拦截器里你见到的是 `ExecutionContext`，它**继承**了 `ArgumentsHost`，并额外提供 `getClass()` / `getHandler()`（知道当前是哪个类哪个方法）。异常过滤器拿到的就是 `ArgumentsHost`（或其超集），`switchToHttp()` 等方法都可用。

一句话：`host` 是"这次调用的参数容器"，`switchToHttp()` 是从这个容器里切到 HTTP 视角、取出 response 来写错误响应——抽象掉协议差异，让过滤器能在不绑定具体传输方式的前提下操作 HTTP 响应。

#### HTTP 状态码语义：过滤器为何把 INVALID\_* 归 400、其余归 409

**解析**

HTTP 状态码是 3 位数字，首位表示类别：2xx 成功、3xx 重定向、4xx 客户端错误、5xx 服务端错误。本过滤器只对客户端可感知的"业务失败"做收敛，落到两个码，刻意把"输入错"与"状态冲突"分开，便于前端决定是"改参数"还是"重发"：

- **400 Bad Request（客户端输入非法）**：用于 `INVALID_*` 前缀的稳定码——语义是"你传的参数/格式不对"。前端拿到 400 应引导用户改输入，而不是盲目重发。
- **409 Conflict（状态/冲突不一致）**：用于其余稳定码（如 `AGENT_REQUEST_KEY_CONFLICT`、`AGENT_ARTIFACT_VERSION_CONFLICT`）——语义是"请求本身合法，但当前资源状态不允许（版本冲突、幂等键重复、已被取消等）"。前端拿到 409 通常是"换幂等键重发 / 先刷新状态 / 提示当前不可操作"，而不是改参数。

**常见状态码与场景**（本项目相关 + 通用）

| 码         | 含义                    | 典型场景                                     |
| --------- | --------------------- | ---------------------------------------- |
| 200       | OK                    | 常规成功响应                                   |
| 201       | Created               | 资源创建成功（如 `createThread`）                 |
| 400       | Bad Request           | 参数校验失败（`INVALID_*`）                      |
| 401       | Unauthorized          | 未登录/鉴权失败（`AuthGuard` 抛）                  |
| 403       | Forbidden             | 已登录但无权限（如越权订阅他人 Run）                     |
| 404       | Not Found             | 资源不存在（`HttpException` 透传）                |
| 409       | Conflict              | 状态冲突 / 版本冲突 / 幂等键重复                      |
| 422       | Unprocessable Entity  | 语义校验失败（格式对但不满足业务约束）                      |
| 429       | Too Many Requests     | 限流（如 SSE 每用户 4 条超额 `AGENT_STREAM_LIMIT`） |
| 500       | Internal Server Error | 未预期服务端异常                                 |
| 502 / 503 | 网关 / 服务不可用            | 上游（模型/检索）挂了                              |

**延伸（SSE 场景）**：流式响应一旦 `response.headersSent`（首字节已发），就不能再写状态码/JSON，只能 `response.end()` 中断连接——这是过滤器 `if (response.headersSent) { response.end(); return; }` 的由来。

---

### 1.6 控制器路由方法知识点（占位，读到再扩）

> 以下来自 `agent.controller.ts` 各路由方法，先占位。读到对应写法仍不懂时按条目扩展（贴代码 + 解析）。

- **方法级参数注入 `@Req()/@Body()/@Param()/@Query()`**：类级 `@UseXxx` 是切面绑定，方法参数的 `@Xxx()` 是取值，职责不同。
- **`@Param('id', new ParseUUIDPipe())` —— Pipe 内联 `new` 实例化**：轻量无状态校验器，装饰器里直接 `new` 即用，不需 DI 托管；对比 `@UseFilters(AgentApiErrorFilter)` 是把类当 token 绑定。
- **`@Body()` 两种形态**：内联字面量类型 vs 导入接口类型（`PrepareAgentDocumentSave` / `CreateAgentRequest`，后者 `import type` 零运行时）。
- **多段路径 `@Param`**：`runs/:id/confirmations/:confirmationId` 多段，每段独立 `@Param('xxx')` 取。
- **`@Sse()` + 返回 `Observable<MessageEvent>`**：Nest 对 SSE 的原生支持（细节见「四、网络协议」）。
- **方法级 vs 类级装饰器作用域**：`@Get/@Post/@Sse` 单路由，`@UseGuards/@UseFilters` 类级全控制器。
- **`{ accepted: true }` 约定**：`resume/cancel` 返回它，表达"已受理、异步生效，去读事件/快照确认"，非立即终态。

#### `POST threads/:id/messages`：消息提交接口逐层解析

**path-tree**

```
agent.controller.ts:85  @Post('threads/:id/messages')
└─ :86  submit(@Req req, @Param('id', ParseUUIDPipe) id, @Body body)
   ├─ :97  getUserId(req.user)            → common/get-user-id.ts:7（sub ?? id）
   └─ :97  AgentService.submit            → agent.service.ts:97
      ├─ :98  model.isConfigured()        → 未配置则 503
      ├─ :99  workflowVersion 由服务端固定
      └─ :101 dataSource.transaction('READ COMMITTED')
         ├─ :102 AgentConversationStore.appendUserMessageAndCreateRun → agent-conversation.store.ts:127
         │  └─ :154 manager.transaction('READ COMMITTED')
         │     ├─ :155 lockAgentOwner（users 行锁，串行化同用户写入）
         │     ├─ :156 查 Thread（存在且未归档）
         │     ├─ :162 串行幂等：按 (userId, threadId, requestKey) 查 Message
         │     │  ├─ 命中 + digest 一致 → :165 查绑定 Run → 返回 replayed:true
         │     │  └─ 命中 + digest 不同 → :164 AGENT_REQUEST_KEY_CONFLICT
         │     ├─ :171 修订类：校验 baseVersion 是最新版 + range 合法
         │     ├─ :180 insert Message（runId=null）
         │     ├─ :185 AgentRunStore.create
         │     ├─ :190 回填 revision 坐标
         │     ├─ :197 appendAgentEvent(RUN_CREATED)
         │     ├─ :199 条件 UPDATE 回填 runId（WHERE runId IS NULL，affected=1）
         │     └─ :203 更新 thread.lastActivityAt
         │  └─ :207 catch 23505（UQ_agent_messages_request）→ :227 replayExistingRequest
         └─ :103 if (!record.replayed) 清 executionPaused
```

**逐层解析**

1. **controller 层只做三件事**：
   - `@Req()` 取 `req.user`（`AuthGuard` 在 `auth.guard.ts:28` 把 JWT payload 写进 `request.user`），`getUserId` 只认 `sub ?? id`——**用户归属永远来自认证上下文，不来自 body**。
   - `@Param('id', new ParseUUIDPipe())` 在进入 handler 前校验 UUID，非法直接 400，业务代码不用再判。
   - `@Body()` 只声明白名单字段（`requestKey/text/mode/revisionTarget`），**不接收** `workflowVersion`、工具权限、模型地址；`text` 由服务端包装成 `content: [{type:'text', text}]`，避免客户端伪造 `role:'assistant'` 或工具消息。
2. **service 层（`AgentService.submit`）**：
   - 写操作要触发模型，所以先查 `model.isConfigured()`，没配直接 503（读接口不查这层）。
   - `workflowVersion` 由请求形态固定：有 range → `agent-section-v1`；有 target 无 range → `agent-revise-v1`；`mode==='task'` → `agent-task-v2`；否则 `agent-read-v1`。
   - 开 `READ COMMITTED` 事务包住 store 调用；**只有非重放**（`!record.replayed`）才清 `executionPaused`——重试不能把已暂停的 Run 意外复活。
3. **store 层（`appendUserMessageAndCreateRun`）——真正的业务核心**：
   - **入参校验**：UUID、`requestKey` 非空 ≤128、`mode ∈ {dialogue,task}`、`workflowVersion` 非空 ≤128。
   - **修订一致性**：修订类工作流必须带 target，target 必须 `mode=task`、`artifactId` UUID、`baseVersion ∈ [1,49]`；`agent-section-v1` 必须有 range 且 `0 ≤ start < end ≤ 262144`。
   - **内容规范化**：1~64 个 block、总字节 ≤256KB；`goal` 从文本块拼出（空则拒绝）。
   - **请求摘要**：`sha256({contentVersion, blocks, mode, workflowVersion, revisionTarget})`。同 key 不同摘要 → `AGENT_REQUEST_KEY_CONFLICT`，防止"换内容复用幂等键"。
   - **事务内顺序**：`lockAgentOwner`（`users` 行锁）→ 校验 Thread → 串行幂等命中 → 修订版本校验 → insert Message（`runId=null`）→ 建 Run → 回填修订坐标 → 写 `RUN_CREATED` 事件 → 条件 UPDATE 回填 `runId` → 更新 thread 活跃时间。
   - **并发兜底**：两个事务都过了 `findOneBy` 才 insert 时，后到者触发唯一约束 `UQ_agent_messages_request`（PG 23505）；catch 后走 `replayExistingRequest` 只读重查，返回既有记录，而不是把冲突暴露成 409。

**几个"为什么"**

- **为什么消息先 `runId=null` 再回填**：保证"触发消息 ↔ Run"严格 1:1；回填用 `WHERE runId IS NULL` + `affected===1` 做并发断言，被并发改写就判 `AGENT_CONVERSATION_INCONSISTENT`。
- **为什么所有步骤一个事务**：避免"有消息无 Run"或"有 Run 未绑定消息"的半截事实；任何一步失败整体回滚。
- **为什么业务校验不在 controller**：Thread 归属/归档、幂等、版本冲突都需要 DB 当前状态和锁，必须与写入同事务；放 controller 只会变成"先查后写"的 TOCTOU。
- **错误如何变成 HTTP**：`AgentConversationStoreError` 把稳定码放在 `message`，`AgentApiErrorFilter` 正则提取；`INVALID_*` → 400，`THREAD_NOT_ACCEPTING_MESSAGES` / `AGENT_REQUEST_KEY_CONFLICT` → 409。

> 一句话：这个接口 = **认证取 userId → UUID 校验 → 白名单 body → 服务端固定 workflowVersion → 单事务内"行锁 + 幂等键 + 摘要 + 版本校验 + 消息/Run/事件原子创建"**，并发同键靠唯一约束兜底重放。

#### `POST runs/:id/confirmations/:confirmationId`：为什么两个 id 都放在路径里

**代码（`agent.controller.ts:126`）**

```typescript
@Post('runs/:id/confirmations/:confirmationId')
decide(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string,
  @Param('confirmationId', new ParseUUIDPipe()) confirmationId: string, @Body() body: {
    /** 确认对应的工具调用；服务端校验它与 Run、确认记录的绑定。 */
    callId: string;
    /** 必须是显式 boolean；仅 true 才表示批准。 */
    accept: boolean;
  }) {
  return this.agent.decide(getUserId(req.user), id, body?.callId, confirmationId, body?.accept);
}
```

**① path-tree**

```
agent.controller.ts:126  @Post('runs/:id/confirmations/:confirmationId')
└─ :127  decide(@Req req, @Param('id') id, @Param('confirmationId') confirmationId, @Body body)
   ├─ :134  getUserId(req.user)                  → AuthGuard 写入的 JWT 主体
   └─ :134  AgentService.decide                  → agent.service.ts:126
      ├─ :127  new ToolAuthorization(manager, catalog).decide
      │        └─ tools/tool-authorization.ts:79
      │           ├─ :80  typeof accept !== 'boolean' → INVALID_CONFIRMATION_DECISION
      │           └─ :82  manager.transaction('READ COMMITTED')
      │              ├─ :83  lockAgentOwner(manager, userId)
      │              ├─ :84  load(userId, runId, callId)      ← 按 callId 查，不按 confirmationId 查
      │              ├─ :85  find(userId, runId, callId)      ← 同上
      │              ├─ :86  confirmation.id !== confirmationId → CONFIRMATION_NOT_FOUND  ★关键
      │              ├─ :88  已非 PENDING → 同决定幂等返回 / 异决定 CONFIRMATION_DECISION_CONFLICT
      │              ├─ :92  isExpired（按 DB 时钟）
      │              ├─ :94  inspect → 重算 digest，与确认时不一致 → CONFIRMATION_BINDING_CHANGED
      │              ├─ :97  ToolCallStore.transition（EXPIRED / CONFIRMED / CANCEL_REQUESTED）
      │              └─ :99  resolve(confirmation, status)
      ├─ :128 result.status === 'APPROVED' → resume(runId)
      └─ :129 否则 → cancel(runId)
```

**② 文字说明**

**1）路径 = "对哪个资源"，body = "对它做什么"。** `confirmation` 是 `run` 的子资源，所以路径按 REST 层级写成 `/runs/{runId}/confirmations/{confirmationId}`；body 只承载动作载荷（`accept`）和冗余绑定校验（`callId`）。这不是随手拼的：路径参与路由匹配、访问日志、指标标签、限流键，把资源标识放路径才能按 run / confirmation 维度做观测和限流；body 是客户端可任意构造的载荷，不承担"我在操作谁"的语义。

**2）`confirmationId` 不是查询键，是"绑定断言"（fencing token）。** 看 `tool-authorization.ts:84-86`：它是**按 `callId` 查出确认记录**，再拿 `confirmation.id !== confirmationId` 做比对。也就是说这个 id 的作用是回答"你手里这张票，是不是当前这一张"：

```typescript
const confirmation = await this.find(manager, userId, runId, callId);
if (!confirmation || confirmation.id !== confirmationId) throw new Error('CONFIRMATION_NOT_FOUND');
```

场景：确认过期（`EXPIRED`）后重新走 `authorize` 会**插入一条新 confirmation 行**（新 UUID，`tool-authorization.ts:66`）。用户浏览器还停在旧页面、拿着旧 id 点"批准"，如果没有这道比对，就会用旧票批准新确认——正是典型的 TOCTOU。所以 `confirmationId` 必须由客户端带回、且必须放在"资源标识"的位置（路径），才能表达"我批准的是**这一个**确认"。

**3）为什么不塞进 body。** 技术上可行（`body.confirmationId`），但会丢掉三件事：① `ParseUUIDPipe` 只能挂在 `@Param('x')` / `@Query('x')` 具名参数上，进 body 就得靠全局 `ValidationPipe` + DTO class 或手写校验，非 UUID 的请求会带着脏值进入 service；② 日志/监控里只记 URL，body 不进访问日志，排障时看不到"批的是哪条确认"；③ 语义上 body 是"动作参数"，把资源身份混进去会让"路由匹配什么"和"业务操作什么"脱钩。

**4）为什么不用 `@Param() params` 一次拿两个。** Nest 支持 `@Param() params: { id: string; confirmationId: string }`，但那样：① 无法给单个字段挂 `ParseUUIDPipe`（Pipe 是逐参数生效的，对象形式要么整体套一个自定义 Pipe，要么退回全局 ValidationPipe + DTO）；② 失去"参数名 ↔ 路径段名"的一一对应，读代码时要回头数 `:id` / `:confirmationId` 的顺序；③ 两个 id 的校验规则将来可能分化（比如 `confirmationId` 换成别的 ID 方案），具名分开更好改。当前写法是"一个路径段 ↔ 一个具名参数 ↔ 一个 Pipe"，最直白。

**5）`callId` 为什么反而在 body。** 因为确认记录本身已经绑定了 `callId`（`agent_confirmations."callId"`），`decide` 也是按 `(userId, runId, callId)` 查记录；`callId` 在 body 里只是**让客户端声明"我以为我在批哪个调用"**，服务端用它查出记录后立刻用 `confirmationId` 交叉校验。真要写进路径也可以（`/runs/:id/calls/:callId/confirmations/:confirmationId`），但路径过长、且信息冗余——`confirmationId` 已经唯一确定了那条确认。

**6）`accept` 为什么强制 `typeof === 'boolean'`。** `"true"`、`1`、`{}`、缺省都不能被当成批准（`tool-authorization.ts:80`）。这是"默认拒绝"原则：批准必须显式，任何模糊输入一律 `INVALID_CONFIRMATION_DECISION` → 400。过期也不当批准（`isExpired` 后即使 `accept=true` 也落 `EXPIRED`）。

**7）错误码怎么落到 HTTP。** `CONFIRMATION_NOT_FOUND`、`CONFIRMATION_DECISION_CONFLICT`、`CONFIRMATION_BINDING_CHANGED` 都是"请求合法但当前状态不允许" → 409；`INVALID_CONFIRMATION_DECISION` → 400。前端据此区分"刷新状态重试"和"改参数"。

**③ 一句话**

路径里的两个 id 分别回答"哪个 Run"和"哪张确认票"，后者是**防旧票批准新确认的栅栏**；body 只放动作（`accept`）和冗余绑定（`callId`）。所以不是"非要拼在接口里"，而是资源标识本就属于路径，而 `confirmationId` 承担的是校验语义，必须由客户端显式带回。

#### `@Sse('runs/:id/stream')`：它不是"真推送"，是 SSE 封装的服务端轮询

**代码**（`agent.controller.ts:153-194`，按原文）

```typescript
@Sse('runs/:id/stream')
async stream(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Query('after') after?: string): Promise<Observable<MessageEvent>> {
  const userId = getUserId(req.user);
  await this.reader.ownedRun(userId, id);
  const cursor = Number(req.headers['last-event-id'] ?? after ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2147483647) throw new Error('INVALID_AGENT_EVENT_QUERY');
  return new Observable((subscriber) => {
    const count = this.streams.get(userId) ?? 0;
    if (count >= 4) { subscriber.error(new Error('AGENT_STREAM_LIMIT')); return; }
    this.streams.set(userId, count + 1);
    let next = cursor;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const exp = (req as Request & { user?: { exp?: number } }).user?.exp;
    const deadline = Math.min(Date.now() + 60000, exp ? exp * 1000 : Date.now() + 60000);
    const poll = async () => {
      try {
        if (stopped) return;
        if (Date.now() >= deadline) { subscriber.complete(); return; }
        const page = await new AgentEventReader(this.agent.dataSource.manager).list(userId, id, next, 100);
        if (stopped) return;
        for (const event of page.events) subscriber.next({ id: String(event.sequence), type: 'agent', data: event });
        next = page.nextAfter;
        if (!page.events.length) subscriber.next({ type: 'heartbeat', data: {} });
        timer = setTimeout(() => { void poll(); }, page.hasMore ? 0 : 1000);
      } catch { subscriber.error(new Error('AGENT_STREAM_UNAVAILABLE')); }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); const remaining = (this.streams.get(userId) ?? 1) - 1;
      if (remaining) this.streams.set(userId, remaining); else this.streams.delete(userId); };
  });
}
```

**① path-tree**

```
agent.controller.ts:153  @Sse('runs/:id/stream')
└─ :154  stream(...): Promise<Observable<MessageEvent>>
   ├─ :155  getUserId(req.user)
   ├─ :157  AgentRunReader.ownedRun(userId, id)              → agent-run.reader.ts:110 findOneByOrFail（越权即抛）
   ├─ :159  cursor = Number(headers['last-event-id'] ?? after ?? 0)
   ├─ :161  游标校验 → INVALID_AGENT_EVENT_QUERY
   └─ :162  new Observable(subscriber => ...)   ← factory，订阅时才执行
      ├─ :164-166  streams.get(userId) ≥ 4 → AGENT_STREAM_LIMIT，否则计数 +1
      ├─ :170-172  deadline = min(now+60000, token.exp*1000)
      ├─ :173  poll(): 每轮
      │   ├─ :175  stopped 提前返回
      │   ├─ :176  deadline → subscriber.complete()
      │   ├─ :178  new AgentEventReader(manager).list(userId, id, next, 100)
      │   │        └─ agent-event.reader.ts:39
      │   │           ├─ :40-43  UUID / after / limit 二次校验
      │   │           └─ :44-47  SQL 三件事：JOIN agent_runs 过滤 userId、
      │   │                     sequence > after、LIMIT limit+1（多取一条判 hasMore）
      │   ├─ :181  subscriber.next({ id: String(sequence), type:'agent', data: event })
      │   ├─ :182  next = page.nextAfter
      │   ├─ :184  空页 → heartbeat（不含 id，不污染游标）
      │   └─ :186  timer = setTimeout(poll, page.hasMore ? 0 : 1000)
      ├─ :189  void poll()                            ← 立即启动第一轮
      └─ :191  return teardown：stopped / clearTimeout / 归还并发计数（归零删键）
```

**② 文字说明**

**1）返回类型为什么是 `Promise<Observable<MessageEvent>>`。** 方法是 `async`，所以在返回流之前有两步**异步前置校验**：`await ownedRun()` 查库验归属、游标校验。这两件事放在 Observable **外面**是有意为之——Nest 先执行 handler 拿到返回值，再为此路由设置 `text/event-stream` 响应头并订阅这个 Observable。所以在 body 里 throw（`INVALID_AGENT_EVENT_QUERY`、`ownedRun` 抛 `EntityNotFoundError`）时响应头还没发出，异常过滤器仍能正常改写状态码（400/404），客户端拿到的是**标准 HTTP 错误**，而不是一条坏掉的 SSE 流。反过来，放在 factory 里的 `AGENT_STREAM_LIMIT` 只能走 `subscriber.error`，客户端看到的是连接错误事件。

**2）它为什么不叫"真推送"。** 没有任何 LISTEN/NOTIFY、WebSocket、长轮询。`poll()` 就是每秒一次 `SELECT ... WHERE sequence > $cursor`。选它的理由：① 本项目事件是低频的——一次用户提交产生几十条事件，1 秒轮询的代价可忽略；② 不引入额外基础设施（PG LISTEN 只在单连接可达，多副本下不可靠）；③ 断线续传能白嫖 SSE 规范（见下条）。代价是"事件最多晚 1 秒可见"，通过追平优化（第 4 条）缓解。

**3）游标为什么是 `headers['last-event-id'] ?? after ?? 0`。** SSE 规范（HTML Living Standard）规定：`EventSource` 断线重连时，**浏览器自动**把最后收到的 `id:` 值放进 `Last-Event-ID` 请求头。服务端什么都不用做，客户端重连就自动续传——这是 SSE 对 WebSocket 的最大优势，不需要自己实现"从哪继续"。业务侧的 `after` query 是给非 EventSource 客户端的兼容入口（和 `@Get('runs/:id/events')` 的 `after` 同一套）。`?? 0`：全新连接从头推。`req.headers['last-event-id'] ?? after ?? 0` 用 `??` 不用 `||`：空字符串 `''` 是真值，`||` 会把它当假值跳过，`??` 保留语义。

  - `subscriber.next({ id: String(event.sequence), ... })` 的 `id` 就是 SSE 的 `id:` 行，**客户端 EventSource 靠它更新 Last-Event-ID**。所以第 181 行是整条流能断线续传的支点。
  - **heartbeat 故意不带 `id`**：带了会推进客户端游标，下一次重连可能跳过尚未轮询到的事件。

**4）追平优化 `hasMore ? 0 : 1000`。** `agent-event.reader.ts:47` 用 `LIMIT limit+1` 多查一条，凭 `rows.length > limit` 判断有没有下一页：追平阶段 0 秒立即再拉（把积压事件尽快推完，降低首屏延迟），空闲阶段等 1 秒（不空转 DB）。`nextAfter` 取本页最后一条的 `sequence`、空页保持原值，所以重复轮不会漏也不会重。

**5）两层游标校验。** controller 的 `!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2147483647` 和 reader 的同款判断（`agent-event.reader.ts:42-43`）是重复的，看**为什么**：controller 侧要在开流前把非法输入变成 HTTP 错误；reader 是独立组件（`events` 接口也在用，见 `agent.controller.ts:140`），它有自己入参契约的防御。上界 `2147483647 = 2^31-1` 正是 Postgres `int4` 上界，与 `agent_events.sequence` 列类型对齐。

**6）`await ownedRun()` 是"显式失败优于沉默空结果"。** reader 的 SQL 已经 `JOIN agent_runs ... WHERE r."userId"=$1` 做了越权过滤——无权时返回的是**空页**，而空页与"暂无新事件"在协议上无法区分，客户端会傻等心跳。所以在开流前单独查一次归属，越权直接 `EntityNotFoundError` → 404。

**7）并发配额 Map。** `streams` 是 controller 实例字段，单例内存 `Map<userId, number>`，上限 4。防的是浏览器重连风暴、多标签堆积。**放在 Observable factory 里而不是方法体**是必须的：factory 在订阅时才执行，且 `return () => {...}` 的 teardown 只在 factory 存在——这样"每次订阅 = 申请一次配额 + 退订/断开归还一次"严格配对。放进方法体则请求建立但未订阅的流也占额度，且无处归还。归还写 `(get(userId) ?? 1) - 1` 而不是 `- 1` 直接减，是为了异常路径下已被清成 0 时不出负数；归零 `delete` 键防止 Map 随用户数单调增长。

**8）`deadline` 最长存活。** `min(now+60s, token.exp*1000)`：不建长生连接。到点 `complete()`，客户端 EventSource 自动重连。两条硬理由：① token 会过期，声称"已认证"的连接不能比凭据活得更久；② 让 LB/网关有机会在连接层做均衡与回收，长连接会绑住代理。`req.user.exp` 是 `AuthGuard` 验完 JWT 后挂上的 payload，单位秒，`*1000` 转毫秒。

**9）双 `if (stopped) return`。** 一次在 `list()` 之前（定时器已排但连接已断），一次在 `await list()` 之后——后者覆盖 await 期间客户端断开的竞态：如果不查，`subscriber.next` 会往已关闭的订阅推。RxJS 对 complete/error 后再 next 会静默忽略，但显式 return 少一次无谓序列化。

**10）读失败怎么恢复。** `catch { subscriber.error(new Error('AGENT_STREAM_UNAVAILABLE')); }`。注意重试**不是我们代码做的**：Nest 在 Observable error 时结束响应，浏览器 EventSource 的 `onerror` 触发自动重连，重连时带上 `Last-Event-ID`，新的 `stream()` 调用从 `next` 继续。所以"重试"靠的是 SSE 规范的客户端行为 + 服务端的游标续传，代码里只需要把失败变成"断开连接"。`catch {`（无绑定）是 ES2019 optional catch binding，因为只用得上"发生了"这个事实。

**11）`new AgentEventReader(...)` 每轮新建。** Reader 无状态（只持有 `manager`），`new` 成本为零，也避免了跨轮次持有同一 manager 的生命周期问题。这是前面"无状态 Helper 由调用方以 manager 构造"知识点的复用。

**12）`void poll()` 与 `timer: ReturnType<typeof setTimeout>`。** `poll()` 返回 Promise，在同步上下文（factory 首轮、`setTimeout` 回调）里调用会形成 floating promise，`void` 显式丢弃以满足 lint。`ReturnType<typeof setTimeout>` 是 Node（`Timeout`）与 DOM（`number`）返回类型不同的跨运行时写法。

**13）为什么用 SSE 而不是 WebSocket。** 本场景是纯单向（服务端→客户端），SSE 复用 HTTP 基础设施（代理、鉴权头、状态码），且断线续传是规范定义；WebSocket 的续传要自己实现，还得额外处理二进制帧与代理兼容。代价是只能单向下行，客户端→服务端走普通 REST（本例正是如此：提交用 `POST`，订阅用 `@Sse`）。

**14）一个 40 行方法混了四层职责。** 前置校验（method body）/ 流构造与配额（factory 头部）/ 轮询循环（`poll`）/ 退订清理（teardown）。之所以没有拆：**流的状态（`next`、`timer`、`stopped`、`deadline`）都在闭包里共享**，拆出去要把这五个变量连同生命周期一起搬走，换来的是"多两个文件"。当前规模下闭包内聚更可读；如果以后要加"按事件类型过滤""多 Run 复用一条流"再拆。

**③ 一句话**

这条接口 = **开流前完成归属与游标校验（保证错误能以 HTTP 状态码返回）→ 用 SSE 规范把"每秒查一次事件表"包装成断线可续传的流**；每用户 4 条并发配额、60 秒最长存活、追平时 0 秒/空闲 1 秒轮询、空页心跳保活、退订归还配额。它把"增量事件不丢、连接不长生、异常能重连"三件事都用极少的代码量兜住了。

#### 追问 A：为什么是"每用户 4 条 + 60 秒"，不是"同时段只准 1 条连接"

**这是两种不同的策略，选 4 是因为 1 需要额外的抢占协议且故障隔离差。**

**1）先算清楚"每个连接到底花什么"。** 一条存活的 SSE = 一个每秒执行的 `SELECT ... WHERE sequence > $cursor`（空闲时），所以**每用户成本 ≈ 连接数 qps**。无论上限是 1 还是 4，目的都是把这个乘积压住，防"100 个标签页 = 100 qps"打库。4 就是给这个乘积设的上界。

**2）为什么不是 1：正常使用天然会瞬时出现多条。**
- 浏览器 **EventSource 断线重连**与旧连接的 `complete()` 之间存在窗口：服务端已发完、客户端还没关，此刻同一用户同时持有旧+新两条。
- **刷新页面**：新连接先建、旧连接的 teardown 后跑。
- **多标签页各开各的 Run**：A 标签看 Run1、B 标签看 Run2，本就该同时存在两条。
- 阈值设成 1，上面三种正常场景都会随机撞上 `AGENT_STREAM_LIMIT`，用户侧表现为"莫名其妙的连接失败"。

**3）阈值设成 1 还额外需要一套"踢掉旧连接"的协议。** 要真正做到互斥，得把 `streams` 从"计数"升级成"保存 subscriber 引用"，新连接来时 `old.complete()`。问题：① SSE 的"关闭"只能由服务端结束响应，另一端正打开 Run 的页面会被无预警踢下线；② 需要处理"自己踢自己"（同一标签重连）与"踢别人"的区分；③ 一个行为异常的客户端就能把正常连接踢掉，**故障不隔离**。这些都是用复杂度换来的"少几条 qps"，不划算。

**4）所以 4 是"容错额度"而非"业务配额"。** 它大到对正常用户完全透明（重连/刷新/双标签都碰不到），小到最坏情况仍被压在上界内（4 qps/用户）。注释写的"防止浏览器重连或多标签堆积"就是这个意思。

**5）60 秒存活同理，是"重认证节拍"而非省资源。** SSE 连接一旦建立，HTTP 层的 `Authorization` 头就不再被检查——凭据已轮换/已撤销的旧流会**无限期**继续收事件。`min(60s, token.exp*1000)` 保证：① 流活不过凭据，撤销在下一次重连时生效；② 连接层有固定的回收点，代理/LB 的连接表不会只增不减。

**6）真正"每用户只一条轮询"的做法存在，但没做。** 单连接 + 本地 fan-out：一个用户只跑一条 `poll()`，多个页面订阅同一条流。DB 成本能降到 1 qps/用户，但需要进程内广播（多副本还要 Redis Pub/Sub），复杂度高一个数量级。当前设计是拿"最多 4 qps"换"无共享状态、无广播、跨副本可直接水平扩"。

#### 追问 B：`void poll()` 在干什么，`poll` 不是已经定义了吗

**两件事：① `poll` 此时只是被"定义"，从没被执行；② `void` 是对那条被丢弃的 Promise 的标记。**

```typescript
const poll = async () => { /* ... */ };   // 只是创建函数对象，一行都不跑
void poll();                               // ← 这一行才是"点火"
```

1. **`poll()` 是调用**。`async` 函数体里第一句是 `if (stopped) return;`——不调用就永远不会有人去查库。轮询链的自持靠 `timer = setTimeout(() => { void poll(); }, ...)`：每次迭代在上一次末尾把下一次排上。所以首轮必须显式 `void poll()` 点火，否则一条事件都不会推。

2. **`void` 是一元运算符**，语义是"求值、丢弃结果、产出 `undefined`"。

3. **先说清楚：`void poll()` 和裸 `poll()` 运行结果完全一样**，删掉 `void` 功能不受任何影响。我第一版解释写"为了满足 `no-floating-promises` lint"——**这是错的，本项目没有这条规则**（已核实：仓库只有根目录一个 `eslint.config.mjs`，用 `tseslint.configs.recommended`，未启用任何需要类型信息的 type-checked 规则，全文无 `floating-promises`）。`void` 在这里的真实价值是**给人看的意图标记**，共三点：

   - **可读性**：裸 `poll();` 读起来像"忘了处理这个 Promise"；`void poll();` 自明"我知道这个 Promise 悬空，且是有意的"。AJAX 场景下这类点火语句散落在代码里，不标记后人很容易在它前面加 `await` 或补 `.then()`，把并发行为改坏。
   - **向前兼容的防线**：项目哪天真升级到 `recommended-type-checked`，裸调用会立刻报错，`void` 是无需改代码的免疫写法。
   - **类型卫生**：`void` 表达式类型恒为 `undefined`，所以 `() => { void poll(); }` 这个回调的返回类型干净；若写 `() => poll()`，回调返回 `Promise<void>`，在需要同步返回的 API 签名上会扩散类型。

4. **`poll` 内部 `try/catch` 已吃掉所有异常**，Promise 不会 reject，所以不存在 unhandled rejection；`void` 不承担错误处理职责，纯粹是标记。`setTimeout` 回调里那个同理——回调是同步函数，Promise 悬空无害。

#### 追问 C：`stopped` 明明只在 teardown 里变 true，为什么 try 里要查两次

**因为 `stopped = true` 不只发生在"return 之后"——它发生在 `await list()` 悬停期间。** 两次检查守的是两个不同的时间窗口：

**窗口 1（await 之前，`:175`）**——定时器回调已经出队、正在执行，`clearTimeout` 再也拦不住它。典型路径：上一轮排定 `timer` → 触发前客户端断开 → teardown 调 `clearTimeout` → 但某些情况下回调已被事件循环取出并开始跑（已进入调用栈的定时器无法被撤回）。此时若没有第一道检查，会多打一次库。

**窗口 2（await 之后，`:179`）**——这是关键的那道，时序如下：

```
poll():  stopped=false → 通过检查①
         await list(...)  ← 协程在这里挂起，控制权交还事件循环
                 ↓  （DB 查询在途）
HTTP 响应结束（客户端断开/页面关闭/服务端 complete）
   → Nest 取消订阅 → RxJS 执行 teardown → stopped = true; clearTimeout(timer)
                 ↓
list() resolve，执行权回到同一个 poll 调用里，从 await 的下一行继续
```

**若没有第二道检查**，接下来会发生：`subscriber.next(...)` 往一个已关闭的订阅推数据、`next` 被推进、`timer` 再次排定——**一次彻头彻尾的泄漏**：为一个已经不在的订阅持续查库。`if (stopped) return;` 把这条续命的 chain 在这里剪断。

**支撑这个机制的三个细节**：

- `stopped` 是**闭包共享变量**：`poll` 与 teardown 定义在同一个 `new Observable(...)` factory 里，共享同一份 `let stopped`，所以 teardown 的写入 poll 能看见——这不是跨对象通信，就是同一个作用域。
- teardown 依赖"此刻 `timer` 是最新排定的那个"才有效：只有通过了第二道检查之后才会走到 `:186` 的 `timer = setTimeout(...)`。所以**检查②同时也是 teardown 正确性的前提**——它保证 teardown 里的 `clearTimeout(timer)` 清的确实是下一次轮询，而不是一个早已执行完的旧值。
- `if (timer) clearTimeout(timer)` 的判空：首轮 `void poll()` 若在读库前就报错（`subscriber.error` → RxJS 立即跑 teardown），此时 `timer` 还是 `undefined`。

#### 追问 C 补：为什么不是"多个 poll 并发"，`stopped` 又为什么必须是外部变量

**先排除一个误解：不存在多个 `poll` 同时运行。** JS 是单线程 + 协作式调度，每轮 `poll` 只有在上一轮末尾 `setTimeout` 排定后才会触发，任意时刻**飞在半路上的 poll 最多一个**。所以问题不是"多票并发竞争"，而是**同一个 `poll` 调用被 `await` 切成两半，取消恰好发生在中间**。

**`stopped` 恰恰不能是 `poll` 内的局部变量。** 它是 teardown（`return () => {...}`）与 `poll` 之间**唯一的通信通道**。若把 `let stopped = false` 写进 `poll` 函数体：

- 每次调用 `poll()` 都会新建一份 `stopped = false`，teardown 拿不到引用、写不进去；
- 取消机制直接失效——teardown 只能清掉还没触发的 `timer`，而"已经发出去、正在 await 的那趟查询"以及它后续的 `next`/续排全都会继续。

所以它是闭包共享变量这一点不是缺陷，而是取消能生效的**前提**。

**为什么"await 之后必须回头看"是 JS 的必然。** async 函数没有抢占式中断：`await list(...)` 让出控制权后，这次函数调用就被挂起；结果回来时同一个调用从下一行继续。挂起期间发生的取消（teardown 置 `stopped`、清 `timer`）**不会自动中止它**——只有它自己回来查一眼。单线程模型里没有"杀掉一个挂起协程"的原语，取消只能是协作式的：**置标志位 + 恢复执行时自查**。这就是第二道 `if (stopped) return;` 存在的根本原因，与 `stopped` 用什么形式无关。

**`clearTimeout` 为什么顶不住。** 它只能取消还没触发的定时器：已经出队、正在执行的 poll 拦不住；而 `await` 在途期间 teardown 清掉的是"下一次轮询"，清不掉"这一趟已经发出去的查询"及其后续动作。

**等价替代写法（说明问题不在 `stopped`，而在"await 后必须回归检查"）：**

```typescript
// 写法一：不自定义 flag，直接问 RxJS 订阅是否已关闭（RxJS 7 Subscriber 自带 closed）
const page = await new AgentEventReader(...).list(userId, id, next, 100);
if (subscriber.closed) return;

// 写法二：把取消语义下传，用 AbortController 贯穿查询
const controller = new AbortController();
return () => { controller.abort(); ... };
// ... await list({ signal: controller.signal }); if (controller.signal.aborted) return;
```

两者功能等价，**并且依然要在 await 之后写一行检查**——`subscriber.closed` 由 RxJS 在退订时置位，`aborted` 由 teardown 置位，都是"取消发生时置位、恢复时自查"的同一模式。

**唯一能免掉手写检查的方向是换声明式写法**，把取消交给框架：

```typescript
timer(0, 1000).pipe(
  takeUntil(timer(deadline - Date.now())),                          // 到期/退订自动切断
  switchMap(() => from(reader.list(userId, id, next, 100))),        // 退订时丢弃在途结果
  takeWhile((page) => !stopped),                                     // 或显式终态条件
)
```

`takeUntil` 由 RxJS 在退订瞬间切断、`switchMap` 自动丢弃已 resolve 的在途查询——手写的 `stopped` 判断被框架吸收。代价是管道语义绕、`next` 游标的推进和配额的申请/归还得另找着力点，调试时栈也变深。当前 40 行手写版本用两个 `if` 换来了"一眼能读完的执行顺序"，这个取舍是合理的。

#### 追问 D：`void poll()` 为什么在 factory 内、`return` 何时执行、只有一个 poll 为什么还要检查

这三个疑问是同一处没拆开：**函数定义 / 函数调用 / 函数返回，是三件不同时刻的事**；而 `poll` 又是一个 async 函数，它的一次"调用"会被 `await` 切成两个时间片。分开看就通了。

**1）`void poll()` 为什么必须在 `new Observable(...)` 里面**

两个理由，第一个是硬性的：

- **词法作用域**：`const poll = async () => {...}` 声明在 factory 内部，出了这对花括号就不存在。写在方法体里连编译都过不去。
- **语义**：factory 的整个函数体就是"**订阅发生时才做的事**"。Nest 的执行顺序是"先调用 handler 拿到返回值 → 再订阅这个 Observable"，所以 factory 里的代码天然就是"有人要这条流了"的时刻。`poll` 还要用 `subscriber`、`stopped`、`timer`、`deadline` 和刚申请的并发计数——全在这个闭包里，没有第二个地方能放。

注意：**factory 里的 `return` 不是"轮询结束时回去执行"**。它在 `void poll()` 之后立刻同步执行完，做的事情仅仅是"把清理函数这个对象交出去"。

**2）`return` 到底何时执行——两个 return 必须分开**

代码里有两个完全不同的 `return`：

```typescript
// A：方法的 return，handler 立刻把 Observable 交回 Nest，之后 Nest 才订阅
return new Observable((subscriber) => { ... });

// B：factory 的 return，把"取消时要执行的清理函数"交给 RxJS
return () => { stopped = true; if (timer) clearTimeout(timer); /* 归还配额 */ };
```

按时间排：

```
t0  handler 执行到 A → 把一个 Observable 对象交回 Nest
t1  Nest 订阅它 → 调用 factory(subscriber) → 执行到 B
    B 只是"return 一个函数对象"，factory 到此同步结束
    ※ 此刻轮询还没结束，连接还开着，什么都不清理
t2  void poll() 已在 t1 内启动，轮询链靠 setTimeout 自持
    ...
t3  取消时刻（客户端断开 / deadline 到点 complete / 读失败 error）
    → RxJS 才真正调用 B 交出去的那个函数
    → stopped = true; clearTimeout(timer); 归还配额
```

**RxJS 的契约就一句话**：`new Observable(fn)` 里 `fn` 的返回值被当作 teardown，在 unsubscribe / complete / error 时调用。所以 B 的"return"在 `t1` 就执行完了，**B 那个箭头函数的函数体**才是在 `t3` 执行。这处之所以读着别扭，是因为 `return () => {...}` 把"交出函数"和"执行清理"压在了一行里。

**3）只有一个 poll 在跑，为什么还要检查 `stopped`**

先纠一个措辞：`poll` **从来不写** `stopped`，它只读；`stopped` 只被 teardown 写。所以不是"多个 poll 抢着改"，而是——

> **一次 `poll()` 调用会被 `await` 切成两半，teardown 恰好插在中间。**

单线程保证的是"同一时刻只有一段代码在跑"，但**不保证一次函数调用连续跑完**：

```
t0   poll() 开始，stopped=false → 检查①通过
t1   发出 SELECT，执行到 await → 这一趟 poll【暂停】在这一行
     ※ 此刻它没跑完，只是让出了线程
t2   客户端断开 → teardown → stopped=true
     ※ 这里没有任何 poll 在跑，只有 teardown 在跑
t3   SELECT 结果回来 → 引擎从 await 的下一行【唤醒】t0 那一趟 poll，继续跑
     如果不检查②：subscriber.next() 推给已关闭的订阅 + 排下一个定时器
     → 为一个已经不存在的订阅持续查库，直到进程重启
```

类比：你把信投进邮筒（`await`）就回家睡觉了，第二天醒来发现锁被换了（`stopped=true`）。**换锁的不是你，是别人在你睡着时干的**——但你醒来后要办的事（推数据、排下一趟）已经不该办了。所以醒来第一件事是看一眼锁。

这就是为什么检查不能省：JS 的取消没有"抢占"，无法从外部掐断一个挂起的协程，只能由它**恢复执行时自查**。`stopped` 是 teardown 留给它的纸条。

**4）如果还是觉得闭包难读——等价改写**

同样的逻辑拆成字段/方法会更直白，代价是一个小类：

```typescript
class RunEventPoller {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(private readonly sub: Subscriber<MessageEvent>, private readonly ctx: {...}) {}

  start(): void { this.tick(); }                    // 点火
  stop(): void { this.stopped = true; this.timer && clearTimeout(this.timer); }  // teardown

  private tick = async (): Promise<void> => {
    if (this.stopped) return;                        // 醒来先看一眼
    if (Date.now() >= this.ctx.deadline) { this.sub.complete(); return; }
    const page = await this.ctx.reader.list(...);     // 让出线程
    if (this.stopped) return;                         // 醒来再看一眼
    for (const e of page.events) this.sub.next({ id: String(e.sequence), type: 'agent', data: e });
    if (!page.events.length) this.sub.next({ type: 'heartbeat', data: {} });
    this.timer = setTimeout(() => void this.tick(), page.hasMore ? 0 : 1000);
  };
}
```

Controller 里只剩三行意图：

```typescript
return new Observable((subscriber) => {
  const poller = new RunEventPoller(subscriber, { ... });
  poller.start();
  return () => poller.stop();
});
```

`start()` / `stop()` 把"点火"和"取消"命名出来，`stopped` 变成私有字段，两个 `if` 的含义由 `tick` 的注释统一说明。**这是我建议的下一步重构**——不是为了性能，是为了让这段逻辑在半年后还能被一眼读懂。要我现在动手吗？

#### 追问 E：用户代码评审五点 —— 逐条评估与落实

用户对原 `stream()` 提出五点评审。逐条结论如下（三条同意并已改、一条纠正前提、一条判为过度防御），并据此完成重构。

**① 「poll 同时取一批和排下一次，职责过载」—— 同意，已改。** 原写法里 `poll` 确实是"执行体 + 调度器"二合一，且入口有两个（`void poll()` 与 `setTimeout` 里的自调用），读者要自己拼出生命周期。现拆成三层：

```
AgentRunStreamPoller
├─ pollOnce()     只做一件事：取一批 → 推给订阅者 → 推进游标 → 返回 hasMore
├─ runPoll()      只做编排：前置守卫 → pollOnce → 二次检查 → scheduleNext
├─ scheduleNext() 只做调度，把"追平快拉、空闲慢拉"的策略显式命名
└─ start()/stop() 命名"点火"与"取消"
```

自持点从两个收敛成一个：`start()` → `runPoll()` → `scheduleNext()` → `runPoll()`……调用链在类型上一眼可读。

**② 「stopped 检查散落、catch 里不检查」—— 同意，但对你"合并成一个前置守卫"的建议要纠正。** await 后那次检查**不能合并**：前置守卫只能拦住"进入前已取消"，拦不住"await 悬停期间被取消"——这正是追问 C/D 反复讲的 JS 协作式取消的必然，合并掉就等于漏掉主路径。可合并的只是"进入时的两个判断"，现已收进 `runPoll()` 开头的两行。catch 侧已补 `if (this.stopped) return;`（`subscriber.error` 在已关闭订阅上是 no-op，RxJS 的 `isStopped` 保护，补它只为意图显式）。

**③ 「catch 吞原始错误、不清 timer」—— 一半同意、一半前提有误。** 原始错误被丢弃确实是缺陷，已修：`this.logger.warn(...)` 落库/日志，同时 `new Error('AGENT_STREAM_UNAVAILABLE', { cause: error })` 用 ES2022 的 `cause` 保留现场；对外仍只发稳定码（不违反过滤器"不暴露内部细节"的约定）。但"出错后没清理 timer"这个判断不成立：`pollOnce` 抛错时 `scheduleNext` 尚未执行，**根本没有新 timer 被排定**；`this.timer` 指的是早已触发的上一轮，`clearTimeout` 于它是 no-op。清理依赖的也不是"下游一定触发退订"这种隐式契约，而是 RxJS 的明文保证：`error()` / `complete()` 之后 teardown 必然被调用。已在 `fail()` 后显式 `return`，消除"catch 完继续往下"的视觉歧义。

**④ 「退订回调是一坨、共享状态无标注、?? 1 语义费解」—— 同意，两条都改了。** 配额整体抽到 `AgentStreamRegistry`，退订回调收敛成一行：

```typescript
return () => { poller.stop(); release(); };
```

其中 `acquire()` 成功后返回**归还函数**，把"申请—归还"变成配对操作（调用方无法归还未申请成功的槽位，也不会重复归还），`released` 标志做幂等双保险。`?? 1` 改为 `?? 0`：条目缺失按 0 计，`remaining = -1` 时不满足 `> 0` 直接删键，**永不写回负计数**；正常路径下 `acquire` 必然先 `set`，这条分支只在异常路径命中，注释已写明。

**⑤ 「清理无 try/finally」—— 不同意，判为过度防御。** 清理体只有 `clearTimeout` 和 Map 读写，两者都不会抛错；套 `try/finally` 只会带来噪音，与之前删 `ensureReady` 时"别堆冗余防御"的标准自相矛盾。真正的兜底已由"`released` 幂等标志 + `remaining > 0` 判据"提供。

**重构产物**

| 文件 | 职责 | 关键点 |
| --- | --- | --- |
| `agent-run-stream.poller.ts`（新） | 单条 SSE 订阅的轮询生命周期 | `start/stop` 命名两端；`pollOnce`/`runPoll`/`scheduleNext` 三层分离；`stopped/timer/next` 成为私有字段 |
| `agent-stream.registry.ts`（新） | 每用户并发配额 | `acquire()` 返回幂等归还函数；上限 4 与理由写在类注释；`count()` 供诊断 |
| `agent.controller.ts`（改） | 只剩"认证 → 归属校验 → 游标校验 → 接线" | `stream()` 从 30 行降到 12 行；`streams` 字段由 `Map` 换成 registry |

**验证**：三个文件 `transpileModule` 语法诊断 0；`tsc -p apps/server/tsconfig.json --noEmit` 的 37 条报错全部是 `Cannot find module '@inkweaver/shared' / '@langchain/*'`（环境缺依赖），**本轮三个文件 0 报错**，`agent.service.ts` 同样 0 报错。

#### 追问 E 续：单测落地（17 例全绿）

**测试约定沿用 `agent-event.reader.test.ts` 的做法**：`node:test` + `node:assert/strict`、依赖全部注入不连库，最终由 `pnpm test:unit`（`nest build` 后 `node --import reflect-metadata --test dist`）自动收录——**没有改任何脚本**。

**为了让轮询器可测，先把依赖收窄成结构化接口**（`AgentEventSink`）：

```typescript
export type AgentEventSink = Pick<Subscriber<MessageEvent>, 'next' | 'error' | 'complete'>;
```

只声明真正用到的三个下行动作。好处：调用方一眼看出这个类对外部世界的全部要求；测试可以直接传一个记录调用的普通对象，**不需要构造真实 Subscriber 或写类型断言**。Controller 侧 `sink: subscriber` 原样传入。

**`agent-stream.registry.test.ts`（6 例）** 覆盖配额的核心不变量：

- 申请成功即占槽、达到上限后拒绝且**不占新槽位**
- 归还递减、**归零即删键**（防 Map 随用户数增长）
- **归还函数幂等**：重复调用只释放一次（这是 `released` 标志的价值证明）
- 自定义上限、上限为 0、多用户互不影响

**`agent-run-stream.poller.test.ts`（11 例）** 覆盖轮询链的全部关键行为。关键手法有三：

1. **读库做成可控 Promise**：reader 的 `list()` 返回一个只在测试调 `resolve/reject` 时才落定的 Promise，于是能在 `await` 悬停期间插入 `stop()`——**第二轮 `stopped` 检查要覆盖的那个窗口，因此变成可确定验证的**。
2. **`enqueued` 与 `invoked` 分开记账**：前者是测试"预先批准"的查询次数，后者是真实发生次数。计划外查询（重复 `start()`、取消后又排下一轮）会让两者分叉，断言才真正有效。（第一版我把 `calls.length` 既当登记又当调用用，断言实际是空的，全部假绿。）
3. **`mock.timers.enable({ apis: ['setTimeout', 'Date'] })` + `tick()` + `setImmediate` 刷新**：本环境 `@types/node` 没有 `tickAsync`，改用 `tick(ms)` 后跟一次宏任务边界刷新微任务——轮询链挂在 `await` 上，不给边界续跑不了。

覆盖点：事件逐条推（`id`=序号、`type='agent'`）／空页 heartbeat 不带 `id`／`hasMore?0:1000` 节奏（含 999ms 不查、1000ms 才查）／游标推进与空页不回退／`start` 幂等／**`await` 中途取消后零查询**／`stop` 清定时器／到点 `complete()`／读失败只发稳定码且 `cause` 保留原错误并写日志、之后停止轮询／已取消时不再下发错误。

**过程中自己写错又被测试抓到的两处**（写测试的真实价值）：

- `page()` 辅助函数在空页时把 `nextAfter` 算成 0，而真实 reader 是**保持原游标不变**（`agent-event.reader.ts:55`）。若没测这条，"空页游标回退"的假实现会直接进生产。
- registry 一条断言把"幂等"和"归零删键"混在一起，预期值写反。

**运行结果**：`# tests 17 / # pass 17 / # fail 0`；`tsc -p tsconfig.streamtest.json`（临时配置，只编译这四个文件）零报错；跑完已删除临时 tsconfig 与 `dist-streamtest` 产物，仓库不留下垃圾。全量 `tsc --noEmit` 仍 37 条且**无一条落在本轮文件上**。

#### 入口层小结：`agent.controller.ts` 全日复盘（第三遍 · 入口层收工）

**这一层到底读了什么**

12 个路由，按"读透程度"分三档：

| 档 | 路由 | 沉淀位置 |
| --- | --- | --- |
| 已扩成完整版（贴代码 + path-tree + 为什么） | `POST threads/:id/messages`、`POST runs/:id/confirmations/:confirmationId`、`@Sse runs/:id/stream` | §1.6 + 追问 A–E |
| 已讲透类级机制 | `AgentApiErrorFilter`（`@Catch` / `host.switchToHttp` / 400 vs 409）、四件套（`@UseFilters` 等）、`ParseUUIDPipe` 内联 `new` | §1.4 / §1.5 / §1.6 |
| 已列占位、未展开 | `status` / `threads` / `createThread` / `thread` / `threads/:id/saves` / `runs/:id` / `runs/:id/resume` / `runs/:id/cancel` / `runs/:id/events` | §1.6 占位（多数是薄封装，用到再扩） |

**今天在这一层实际改了什么（不只是读）**

1. **删除 `ensureReady` 运行时 schema 探针**（11 处调用 + 方法 + `tick()` 检查）。理由：`docker-entrypoint.sh` 已在 Nest 启动前跑迁移且失败即 `exit 1`，接口层再查一遍 `information_schema` 是给部署流程缺失打补丁——补丁本身成了冗余。文档 §3.1.x 已从"设计解析"改写为"反例 + 正确做法"。
2. **重构 `stream()`**：30 行闭包 → `AgentRunStreamPoller` + `AgentStreamRegistry` 两个单职责文件。原写法的问题（用户五点评审）：poll 既执行又调度、`stopped` 检查无注释、catch 吞原始错误、退订回调四件事挤三行、调用链只能反推。
3. **补 17 例单测**并借可测性把 poller 依赖收窄成 `AgentEventSink`。

**这一层沉淀的知识域（供面试检索）**

- **NestJS**：DI 容器与模块边界、Provider 托管、装饰器反射；请求管线四件套（Guard/Interceptor/Pipe/Filter）；`ArgumentsHost` 与 `switchToHttp()`；方法级参数注入与 `ParseUUIDPipe` 内联实例化；`@Sse` 返回 `Promise<Observable<MessageEvent>>` 的时序（body 抛错仍是 HTTP 状态码，factory 内抛错只能走流错误）。
- **网络协议**：SSE 规范与 `Last-Event-ID` 断线续传、`MessageEvent` 结构、heartbeat 不带 `id` 的原因、SSE vs WebSocket 选型。
- **RxJS / 异步**：Observable factory 与 teardown 契约、`void` 运算符的真实作用（本仓库未开 `no-floating-promises`，它不是为 lint）、async 无抢占式中断所以取消必须"置标志 + 恢复时自查"。
- **并发与防御**：并发配额的两种策略（互斥 vs 容错额度）、最长存活与凭据续期、游标上界与 int4 对齐、防御代码的取舍标准（同一套标准既用于删 `ensureReady`，也用于拒绝给 teardown 加 `try/finally`）。
- **工程判断**：可读性重构的收益边界（什么时候值得拆类、什么时候闭包内聚更好）；测试断言的"空转"陷阱（计数器必须分开）。

**明天从哪接**

入口层还剩 `agent.service.ts` 未逐行（已读过 `ensureReady`/`tick()`/`submit`/`decide` 的入口部分）。建议顺序：`agent.service.ts` → 编排执行层 `agent-graph.ts` / `agent-graph.runner.ts` → 持久化层 store/writer/reader → 工具保存层。若想先把入口层的读透度补齐，则从 `GET runs/:id/events`（与刚重构的 reader 直接相关）或 `POST threads/:id/saves`（L1 两阶段保存的 prepare 入口）开始。

---

## 二、TypeScript

### `import` vs `import type`（注入场景差异）

**代码**（见上节「装饰器反射与 `design:paramtypes`」）

```typescript
import { AgentService } from './agent.service';          // 普通 import
import type { CreateAgentRequest } from './agent-conversation.store';   // import type
```

**解析**

- **`import { X }`（普通 import）**：把 `X` 作为运行时值引入，编译后保留引用。`AgentService` 被 `@Injectable()` 注入，DI 需要它在 `design:paramtypes` 里的具体类引用，所以必须普通 import（详见上方「装饰器反射与 `design:paramtypes`」）。
- **`import type { X }`**：只引入类型，编译后整行被抹掉、零运行时开销。用在仅当类型注解的场景（`CreateAgentRequest` 只在方法参数/返回类型里出现，不参与 DI、不是运行时值），写成 `import type` 既安全又更小打包体积。
- 二者混用是刻意区分：被注入的类用普通 import，纯类型用 `import type`。在 `verbatimModuleSyntax` 下，纯类型若误用普通 import 会报"应为 type-only"。

### 类型技巧（参数化查询 / 派生类型 / 解构赋值）

- **索引访问类型 `CreateAgentRequest['revisionTarget']`**：从已有类型取某字段类型复用，避免重复定义。
- **字面量联合类型 `'dialogue' | 'task'`**：把 `mode` 限制为固定两值，编译期防传错。
- **`ReturnType<typeof setTimeout>`**：`streams` 里 `timer` 字段类型写法（Node/浏览器 `setTimeout` 返回类型不同，用 `ReturnType` 兜底）。
- **`req.headers['last-event-id'] ?? after ?? 0`**：索引访问 + 空值合并链取游标。
- **`Number.isSafeInteger(cursor)` 防御**：防 NaN / 异常大值探测（SSE 游标校验）。

#### `Parameters<T>` 与 `ConstructorParameters<T>`：从消费方反推类型

**代码**（两处，一层之差）

```typescript
// agent.service.ts:179 —— 断言目标里 master 的类型
(this.dataSource.driver as unknown as { master: Parameters<typeof createAgentCheckpointer>[0] }).master

// agent-checkpointer.ts:5 —— 工厂入参 pool 的类型
export async function createAgentCheckpointer(pool: ConstructorParameters<typeof PostgresSaver>[0], schema = 'agent_checkpoint')
```

**解析**

- `Parameters<T>` 取**函数/方法**的参数元组，`ConstructorParameters<T>` 取**类构造器**的参数元组；对元组按 `[0]` 索引取第一个参数的类型，编译期求值、完全合法。
- 两处都是**从消费方反推**而非硬编码：`master` 的类型 = "checkpointer 工厂想要什么"，`pool` 的类型 = "PostgresSaver 构造器要什么"。上游签名改了，下游自动跟随，不会出现断言的类型和实际要的悄悄错位。
- 配套的**双重断言** `as unknown as { master: X }`：`dataSource.driver` 的公开类型是基类 `DatabaseDriver`，不暴露 postgres 驱动的 `.master`（pg 主连接池，运行时确实在 `PostgresDriver.master`）。TS 禁止两个不相干类型直接 `as`，`unknown` 是官方逃生舱——先抹掉类型再断言成"我从库源码里挖出的结构形状"。这是**以 external knowledge 担保运行时形状**的受控 hack，升 TypeORM 大版本要回归这个点。不硬编码 `Pool` 而用派生类型，是它比 `as { master: Pool }` 优的唯一理由。

#### 解构赋值进外层变量：`[ { acquired } ] = await lock.query(...)`

**代码**（`agent.service.ts:242`）

```typescript
let acquired = false;
try {
  [ { acquired } ] = await lock.query('SELECT pg_try_advisory_lock(...) AS acquired', [key]);
  if (!acquired) return;
  // ...
} finally {
  try { if (acquired) await lock.query('SELECT pg_advisory_unlock(...)', [key]); }
  finally { await lock.release(); }
}
```

**解析**

- `[ { acquired } ] = rows` 是两层解构：数组解构取 `rows[0]`（这行 SQL 必只返回一行），对象解构取 `.acquired` 列——列名靠 SQL 里的 `AS acquired` 对齐。
- **赋值目标是外层先声明的 `let acquired = false`，不是新声明**——这是全篇最实用的细节：`finally` 要靠它决定解不解锁，而 try 里任何一步抛错时它保持 `false`，finally 就跳过解锁。**失败时的默认值必须是"没锁过"**，否则会去解一把没拿到的锁。看到"外层 let + try 内解构赋值 + finally 里判它"三件套，就是资源获取/释放的配对模式。

#### 默认参数 + 白名单正则：`schema = 'agent_checkpoint'`

**代码**（`agent-checkpointer.ts:5-6`）

```typescript
export async function createAgentCheckpointer(pool: ..., schema = 'agent_checkpoint'): Promise<PostgresSaver> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('INVALID_CHECKPOINT_SCHEMA');
```

**解析**

- 默认参数让唯一生产调用点（`agent.service.ts:181`）只传 pool，规范 schema 名**单点定义**——它必须和迁移 `1790121600000-CreateAgentCheckpoints` 建的 schema 一字不差，单点即防漂移；测试则显式传隔离 schema。
- 默认值同时是隐患来源：编译期 `schema` 类型是 `string`，调用方可传任意字符串。而它下一秒要**拼接进 SQL**（`${schema}.checkpoint_migrations`）——**参数化查询对标识符无效**（`$1` 不能做表名/schema 名，Postgres 硬限制），所以白名单正则是唯一注入防线：小写字母开头、仅小写/数字/下划线、≤63（标识符上限），注入字符零生存空间。禁大写与引号还防了"未加引号标识符折叠成小写"的错位陷阱。

#### `Omit<T, K>`：从既有类型剔除指定键，生成"窄化"入参类型

**代码**（`agent.service.ts:97` 的 `submit` 签名）

```typescript
async submit(userId: string, input: Omit<CreateAgentRequest, 'workflowVersion'>) {
  // ... 内部自行推导 workflowVersion（四级 else-if 链）...
  const workflowVersion = input.revisionTarget?.range ? 'agent-section-v1'
    : input.revisionTarget ? 'agent-revise-v1'
    : input.mode === 'task' ? 'agent-task-v2' : 'agent-read-v1';
  // ...
  const record = await new AgentConversationStore(manager)
    .appendUserMessageAndCreateRun(userId, { ...input, workflowVersion });
}
```

**解析**

- `Omit<T, K>` 是 TS **内置工具类型**，标准库定义约等于 `Pick<T, Exclude<keyof T, K>>`：取 `T` 的全部键、去掉 `K` 指定的键，得到"少了某些字段的 `T`"。所以 `Omit<CreateAgentRequest, 'workflowVersion'>` = "拥有 `CreateAgentRequest` 全部字段、**唯独没有 `workflowVersion`**"的类型。
- **为什么这里用 Omit（而非再写一份 interface）**：`workflowVersion` 这个字段是**服务端根据 `revisionTarget`/`mode` 推导出来的**，不该由客户端指定。用 `Omit` 把入参类型里剔掉这个键，等于在**类型层面强制"调用方无法提供该字段"**——编译器就不允许 controller 把请求体里的 `workflowVersion` 传进来。随后 service 内部算出 `workflowVersion`，再用 `{ ...input, workflowVersion }` 补回完整对象传给下层（`appendUserMessageAndCreateRun` 的入参类型仍需带 `workflowVersion`，因为那是要落库的完整结构）。
- **这是"类型即契约 / 防越权"的用法**：相比 `CreateAgentRequest` 与"submit 入参"各写一个 interface（字段多时易漂移、重复），`Omit` 让 submit 入参**派生自** `CreateAgentRequest`——上游加字段、submit 入参自动跟随；同时精确禁止客户端伪造"运行哪个 workflow 版本"。
- **同类工具类型对照**：`Pick<T, K>` = "只保留 K 键"（与 `Omit` 互补）；`Partial<T>` = 全部字段变可选；`Required<T>` = 去掉可选；`Omit` 是唯一做"按 key 剔除"的。需要"去掉几个字段"时优先 `Omit`，不要手搓新 interface。

---

## 三、数据库（§1.3.3：类型ORM / 事务隔离 / 行锁·咨询锁 / 乐观锁 CAS）

### 3.1 类型ORM：DataSource 与 EntityManager

#### DataSource 与 EntityManager：manager 是什么、为什么能映射表

**代码**

`agent.service.ts` 注入的是 TypeORM 的 `DataSource`：

```typescript
constructor(
  readonly dataSource: DataSource,
  readonly model: AgentModelClient,
  private readonly knowledge: AgentKnowledgeService,
  private readonly index: DocumentIndexService,
) {
  assembleV1Tools(this.catalog, dataSource.manager);
}
```

`agent.controller.ts` 用它的 `manager` 去构造只读 Reader：

```typescript
export class AgentController {
  private readonly reader: AgentRunReader;

  constructor(private readonly agent: AgentService) {
    this.reader = new AgentRunReader(agent.dataSource.manager);
  }
}
```

`agent.module.ts` 里通过 `TypeOrmModule.forFeature([...])` 注册实体（这些实体类 ↔ 表名+列的元数据就装进了 DataSource）：

```typescript
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRun } from './entity/agent-run.entity';
// ... 其余 agent_* 实体 + Document / DocSnapshot / SyncUpdate
@Module({
  imports: [AuthModule, AiModule, SearchModule, TypeOrmModule.forFeature([
    AgentArtifactSource, AgentArtifactVersion, AgentArtifact, AgentDocumentSave, AgentMessage, AgentModelCall, AgentRunSource, AgentRun, AgentThread, AgentToolAttempt, AgentToolCall, Document, DocSnapshot, SyncUpdate,
  ])],
  controllers: [AgentController],
  providers: [AgentModelClient, AgentKnowledgeService, AgentService],
})
export class AgentModule {}
```

**解析**

- **`DataSource.manager` 是什么**：`DataSource` 是 TypeORM 的核心对象，持有连接池 + 全部实体元数据。`manager` 是它上面的**默认 `EntityManager`**——一个对数据库做增删改查的门面（`getRepository`、`find`、`save`、`createQueryBuilder`、`query`、`transaction` 等）。所以 `agent.dataSource.manager` 就是"绑定到这个 DataSource 默认连接池的那个 EntityManager"。
- **它的作用**：`EntityManager` 是所有 DB 操作的入口。`manager.getRepository(AgentRun)` 拿到一个 `Repository`（实体 ↔ 表的查询接口）；`manager.transaction(isolation, cb)` 开一个事务，并把一个**事务作用域内的 manager** 传给回调 `cb`，回调里所有操作共用这一条连接、一起提交/回滚。
- **DI 容器并不"知道表"——是你配置的**：DI 容器只负责把 `DataSource` 这个**配置好的对象**注入进来，它不知道任何表结构。表映射来自 TypeORM 的**实体元数据**：`agent.module.ts` 里的 `TypeOrmModule.forFeature([AgentRun, ...])` 把一批实体类挂到这个 DataSource 上，TypeORM 启动时读取这些类的装饰器（`@Entity('agent_runs')`、`@Column` 等）建立起"类 ↔ 表名/列"的元数据。之后 `manager.getRepository(AgentRun)` 正是去查这份元数据，才知道要操作 `agent_runs` 表。**所以"哪个表"是 TypeORM 元数据管的，不是 DI 容器管的**；DI 只是把 DataSource 实例接好线。

### 3.1.x 迁移就绪检查：为什么不该放在每个请求里（已移除）

**曾经的写法**

```typescript
async ensureReady(): Promise<void> {
  if (!(await this.status()).ready) throw new ServiceUnavailableException('Agent 数据结构尚未迁移');
}
```

controller 每个路由第一行 `await this.agent.ensureReady()`，service 的 submit / prepareSave / resume / decide / cancel 也各调一次——共 11 处。`status()` 靠查 `information_schema.columns` 里两个"迁移哨兵列"（`agent_runs.nextDispatchAt`、`agent_document_saves.indexScheduledAt`）判断 schema 是否已迁到最新版。

**为什么这是反模式**

- **职责错位**：schema 是否就绪是**部署阶段**的事实，不是每次 HTTP 请求的业务前提。把它写进请求路径，等于用运行时代码补部署流程的洞。
- **成本与收益不成比例**：每个请求多一条 `information_schema` 查询；换来的只是把"部署漏跑迁移"从 500 变成 503——问题没被解决，只换了个错误码。
- **掩盖真正的闸门**：项目本来就有更硬的闸门（见下），这层探测是重复防御。

**正确做法：迁移是启动前置条件**

`apps/server/docker-entrypoint.sh` 在 Nest 启动前执行迁移，失败直接退出容器：

```sh
if [ "${SKIP_MIGRATIONS:-}" != "true" ]; then
  node dist/scripts/run-migrations.js || { echo "[entrypoint] Migration failed"; exit 1; }
fi
exec "$@"
```

迁移失败 → 容器起不来 → `deploy-backend.sh` 的 `/readyz` 失败 → 部署中止。**这才是应该拦截"迁移没跑"的地方**：让部署失败，而不是让接口在运行时探测。

**结论**：已删除 `ensureReady()` 及 11 处调用点（含 `tick()` 里的重复检查）；`status()` 保留给 `GET /status` 做诊断。面试里这是个好例子——**防御性代码要放在正确的层：部署闸门优于运行时探针**。

### 3.2 事务隔离 / 行锁·咨询锁 / 乐观锁 CAS

#### `READ COMMITTED` 与事务组合：`dataSource.transaction(isolation, cb)`

`agent.service.ts` 的写路径统一 `await this.dataSource.transaction('READ COMMITTED', async (manager) => {...})`：回调里拿到的 `manager` 是**事务作用域内的 EntityManager**，所有操作共用一条连接、一起提交/回滚。传给低层 `AgentRunWriter` / `AgentRunStore` 的正是这个 manager——"用户锁 → 状态 CAS → 写事件"要么全提交要么全回滚（状态⇄事件原子性）。`READ COMMITTED` 是 Postgres 默认隔离级，本项目不升隔离级，竞态一律靠**显式锁 + CAS 条件更新**解决，而不是靠更高隔离。

#### 行锁：`lockAgentOwner` = users 表 `FOR UPDATE`

**代码**（`agent-data.cleanup.ts:7-11`，几乎所有写事务第一行都调）

```typescript
export async function lockAgentOwner(manager: EntityManager, userId: string): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('AGENT_TRANSACTION_REQUIRED');
  const rows = await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (rows.length !== 1) throw new Error('AGENT_OWNER_UNAVAILABLE');
}
```

- **锁的是 users 行，不是 advisory lock**：同一用户的 Agent 写事务在这行上排队，串行化一个用户的全部状态变更。`FOR UPDATE` 行锁**事务级**持有，提交/回滚自动释放，不需要显式 unlock。
- 顺带两个硬校验：`isTransactionActive` 保"必须在事务里用"（无事务调用直接抛）；行不存在 = `AGENT_OWNER_UNAVAILABLE`，不给已删用户落状态。
- 与 advisory lock 的分工：**用户级串行用行锁**（跟着事务走，零泄漏风险），**Run 级互斥用会话锁**（要跨"事务外的执行期"持有）。

#### 会话锁：`pg_try_advisory_lock` 与专属 QueryRunner

**代码**（`agent.service.ts:237-255`，`settleCancellation`）

```typescript
const lock = this.dataSource.createQueryRunner();
await lock.connect();
const key = agentCheckpointKey(run.userId, run.id);   // `${userId.toLowerCase()}:${runId.toLowerCase}`，先校验双方是 UUID
let acquired = false;
try {
  [ { acquired } ] = await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key]);
  if (!acquired) return;
  // ... 事务内重读状态 → 查在途工具调用 → AgentRunWriter.transition(CANCEL_SETTLED)
} finally {
  try { if (acquired) await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
  finally { await lock.release(); }
}
```

四个 Why：

1. **为什么必须专属 QueryRunner**：Postgres 咨询锁是**会话（连接）级**的。池化的 `manager` 每条查询可能落到不同连接，`pg_advisory_unlock` 会找错会话、静默失效，锁一直泄漏到那条连接归还销毁。QueryRunner 钉住一条物理连接，把"加锁→干活→解锁"绑在同一条连接上——这是本方法最大的设计点。
2. **`try_` 前缀 = 非阻塞**：抢不到立刻返回 false，绝不等待。对照阻塞版 `pg_advisory_lock` 会把 tick 共享循环和同批 10 个候选全堵死。抢不到的真实语义是"这 Run 正被别处执行（Graph runner 持同一把锁），本实例不插手"。
3. **`hashtextextended($1,0)`**：咨询锁键只能是 bigint，`hashtextextended(text, seed)` 把字符串键确定性地散列成 64 位整数（extended = 用满 64 位空间，老版 `hashtext` 只 32 位）。**确定性是命门**——unlock 用同函数同键再散列一次，必然得到同一个 bigint 才解得开。
4. **崩溃安全**：锁绑会话，进程没走到 finally 就死，Postgres 发现连接断开会自动释放——不存在永久死锁。嵌套 finally 则保"unlock 自身抛错（连接已断）也要 release"，顺序不可换（先解锁后释放）；`if (acquired)` 守卫保失败路径不会解一把没拿到的锁。

#### 乐观锁 CAS：两处形态

**形态一：`Run.revision` 版本 CAS**（`AgentRunStore.transition`）：`UPDATE ... WHERE status=旧 AND revision=旧`，两个条件任一不满足就 0 行——并发下只有一个写入者赢。状态与事件在同一事务追加，是"状态⇄事件"原子的地基。

**形态二：终态守卫 CAS**（`agent.service.ts:196-197`，tick 的 catch）：

```sql
UPDATE agent_runs SET "executionPaused"=NOT "cancelRequested","lastErrorCode"=$3
WHERE id=$1 AND "userId"=$2 AND status NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT')
```

它和候选查询的 `status IN ('CREATED','QUEUED','RUNNING','WAITING_CONFIRMATION')`（`:163-164`）**正好把 8 个状态词表对半切**（词表实证：`agent-event.ts:55`）：IN(流转态) 管"谁能被选中"，NOT IN(终态) 管"谁能被修改"。守卫防的是 SELECT 与 UPDATE 之间那次几秒钟模型调用里的竞态——期间用户取消、另一实例抢先跑完，Run 可能已被推到终态；没有这道守卫，失败回调会给一个 `CANCELLED`/`COMPLETED` 的 Run 打 `executionPaused=true`，把终态行拖回"暂停的半死状态"。**当守卫用时写负面清单（NOT IN 终态）而不是正面清单（IN 流转态）**：意图是"终态不可碰"，且未来新增流转态时负面清单依然守住底线。

#### `nextDispatchAt`：一个字段承载的调度词汇表

| 写法 | 位置 | 意图 |
|---|---|---|
| `=clock_timestamp()` | `resume()` / `cancel()` | 立即生效 |
| `+interval '2 seconds'` | tick 成功路径（`:188`） | 服务后冷却一个轮询周期 |
| 推向更远的未来 | `ToolExecutionMaintenance` 退避 | 延迟生效 |

- 候选资格线是 `"nextDispatchAt" <= clock_timestamp()`——**这个字段就是"允许被再次派发的时间点"**，不推就意味着下一轮 tick 立刻又选中。
- 成功路径的 `+2s` 真正消费者是**非终态的成功返回**：`WAITING_CONFIRMATION`（graph 在人工确认点 interrupt，任务活着等人，靠它把周期性重检节流在每轮一次）、取消未结算（`settleCancellation` 因锁被占/在途调用原地返回，靠它当重试节拍）。终态行是**无害空转**（已被 `status IN (...)` 挡在候选外）；失败和 BUSY 根本走不到这行——失败进 catch 打 paused 出局，BUSY 直接 `continue` 不推时间保持"到期"。
- 2s 与 `onModuleInit` 的 `setTimeout(loop, 2000)` 严格对齐，两处硬编码是隐性契约；跨实例场景下它还是第一道防线——各实例定时器不同步，不推的话 B 实例 1ms 后就会重选 A 刚服务过的 Run（锁 BUSY 只是第二道）。

#### `LIMIT 1` vs `LIMIT 10`：同关键字两种用途

- **批处理上限**（tick 候选查询、`dispatchIndexing`）：`LIMIT 10`——选中的每行都要处理，扫不完下轮继续（因为筛选条件是"IS NULL"/"到期"，没处理的行不会消失，天然持久游标）。
- **存在性短路**（`settleCancellation` 的在途工具调用检查）：`SELECT id ... LIMIT 1`——只判"有没有"，一行就定结论，多一行都是浪费；选最窄的主键列 + Postgres 匹配到首行即停扫。等价于 `EXISTS` 子查询的应用层表达。

#### 取消的设计：持久意图 + 轮询收敛，不是同步命令

`cancel()` 第一件事是把 `cancelRequested=true` **落库**（`agent.service.ts:139`），API 当场返回"取消已受理"；真正结算异步发生在某个未来 tick：`cancelRequested=true` 在候选查询里恒放行（不挑 workflowVersion——用户按了取消就必须能结算，是比模型在不在更高的优先级），每轮 `settleCancellation` 三重守卫（抢不到锁 / 已终态 / 有在途工具调用）任一不过就原地返回 + `+2s` 推后，下轮再来。等待有界：模型有超时、工具有租约回收，锁终会释放。**意图同步、收敛异步**，中间不需要额外取消队列或信号量。

---

## 四、网络协议（SSE / Last-Event-ID）

> 来自 `agent.controller.ts` 的 `@Sse('runs/:id/stream')` 路由，先占位，读到再扩。

- **SSE 是什么**：`text/event-stream`、服务端→客户端单向流式推送；本项目是"服务端轮询封装"（每 1s 读事件表增量推），非 WebSocket 真双工。
- **`Last-Event-ID` 断线续传**：每条事件带 `id:`，客户端断开重连自动把最后收到的 id 放进 `Last-Event-ID` 请求头；服务端据此游标续传，保证不漏事件。
- **`MessageEvent` 结构**：`{ id, type, data }`；`id` 即事件序号、客户端拿它当下次 `Last-Event-ID`。
- **heartbeat 保活**：追平无新事件时推空 `heartbeat` 事件，确认连接在线。

## 五、RxJS 与异步流

> 来自 `@Sse` 路由的 `Observable<MessageEvent>` 实现，先占位，读到再扩。

- **`Observable` 与 `Observer`**：`new Observable(sub => sub.next/error/complete)`；`next` 推数据、`error` 中断、`complete` 结束。
- **`Promise<Observable<MessageEvent>>` 为什么包两层**：方法 `async` 先 `await ensureReady()` 做前置校验，再返回流（异步准备好 → 返回 Observable）。
- **退订清理 `return () => {...}`**：Observable 工厂返回的 teardown：置 `stopped`、清 `timer`、归还 `streams` 并发计数（归零删键），是 RxJS 资源回收标准位。

## 六、并发与防御性设计

> 来自 `stream()` 方法的并发配额与校验，先占位，读到再扩。

- **`new Map<string, number>()` 每用户并发配额**：`streams` 用内存 Map 记每用户 SSE 连接数，超 4 条 `subscriber.error` 拒，防重连/多标签堆积（单进程内存态，多实例不共享）。
- **游标范围硬校验**：`cursor < 0 || cursor > 2147483647`（32 位有符号整数上界），非法游标直接拒。
- **`deadline` 最长存活**：`min(60s, token exp*1000)`，到期主动 `complete` 让客户端重连，不做长生连接（也受 token 有效期约束）。

#### 降级门禁：`if (this.model.isConfigured())` 与 `$1::boolean OR save OR cancel`

**代码**（`agent.service.ts:156-166`）

```typescript
if (this.model.isConfigured()) await this.dispatchIndexing();
// ...
AND ($1::boolean OR "workflowVersion"='agent-save-v1' OR "cancelRequested"=true)
```

**解析**

- 模型关闭是**部署态**不是每 Run 的错误：不设门禁，每个到期 Run 都会派发→模型节点抛 `AGENT_MODEL_NOT_CONFIGURED`→被 catch 打上 `executionPaused`，把全局一件事伪装成 N 个运行时错误，还要逐个手动 resume（而 `resume()` 在模型没配好时也拒绝）。设了门禁的真实语义是**"冻结，不是失败"**：Run 原地待命，模型配好的第一轮 tick 自动捡起，零人工干预、零错误码。
- 门禁放行两类不依赖模型的活儿：`agent-save-v1`（保存是纯本地事务）和 `cancelRequested=true`（取消结算不碰模型，且**不挑 workflowVersion**——用户按了取消就必须能结算，是比模型在不在更高的优先级）。
- `$1::boolean` 显式断言的硬理由：pg 驱动传参数不带类型，裸 `$1` 放进 `OR` 链里 Postgres 推不出类型会直接报 `could not determine data type of parameter $1`；断言的另一作用是读代码的人一眼看出这格传的是开关。

#### BUSY 不是失败：`continue` 的正确性含义

`AGENT_GRAPH_BUSY` 这个字符串**恰好匹配 catch 里的稳定错误码正则**（全大写+下划线）——若不用 `continue` 让它落下去，一次瞬时的跨实例锁竞争就会被当成错误码落库 + `executionPaused` 翻转，Run 被判失败还要人工 resume。`continue` 跳过 catch 剩余全部代码（错误码归一 + 暂停 UPDATE），且因为推 2s 那行在 try 里（异常发生时本来就到不了），`nextDispatchAt` 保持"到期"，下轮自然重试。**竞争不是错误，撤就是了**——与 `if (!acquired) return` 同一种哲学。

#### fail-fast + 稳定错误码：`createAgentCheckpointer` 的版本自检

`agent_checkpoint` schema 由项目自有迁移创建（含版本行 `(0)-(4)`），代码期望精确等于 `[0,1,2,3,4]`——缺版本（库落后）多版本（库超前）都拒绝交货。放在**装配期**而非交给 langgraph 运行时：失败要在"接线时"以稳定错误码炸掉（`AGENT_CHECKPOINT_SCHEMA_MISMATCH` 能被 tick catch 归类落 `lastErrorCode`），而不是让 LangGraph 在第一次写 checkpoint 时抛晦涩错误。**fail-fast 的位置选择比 fail-fast 本身更重要**。

#### `||` 运算符当控制流：`if (!row.title || row.deletedAt || await this.index.scheduleReindex(...))`

三个知识点合成一行：**短路求值**（前面的真了后面的根本不执行，所以"文档没了就不投递"是免费的）+ **任意表达式都能当条件**（调用也是表达式，副作用——入队 BullMQ——发生在条件求值里）+ **返回值即语义**（`scheduleReindex` 设计成 boolean，调用方一个 `if` 就够用，不需要 try/catch）。读法：**"前面是豁免条件，最后一个是真正干活且干成了才算数；调用返回假 = 什么都没干成，整个 if 落空"**（投递失败不标记，下轮重扫）。可读性代价是副作用藏在条件里，展开版（两个 continue + 一个 mark）行为完全等价。

#### `scheduleReindex` 真实实现：固定 jobId 去重 + active 冲突延迟 30s（被第三处 `||` 引用的投递方法，10-22 补读）

`dispatchIndexing` 第三处 `||` 操作数 `await this.index.scheduleReindex({...})` 真正落到 `ai/document-index.service.ts:62`。它才是"投递"动作本身（BullMQ `add`），`dispatchIndexing` 只负责"扫出待投件 + 标记已投"。两者通过 boolean 返回值闭环：**`true`=投出去了→`dispatchIndexing` 标记 `indexScheduledAt`；`false`=队列挂了→不标记→下轮 tick 重扫**。tick 循环即重试机制，无需额外重试调度。

真实代码（`document-index.service.ts:62-88`）：

```typescript
async scheduleReindex(payload: AiIndexJobPayload): Promise<boolean> {
  const jobId = `reindex-${payload.docId}`;                 // 固定 jobId：同 docId 全局唯一主任务
  try {
    const existing = await this.indexQueue.getJob(jobId);    // 取已有任务
    if (existing) {
      const state = await existing.getState();
      if (state === 'active') {
        return this.enqueueDelayedReindex(payload);          // 分支 A：正在索引 → 延迟分支
      }
      // BullMQ 在任务记录仍存在时不会重建相同 jobId；终态任务同样必须先删。
      await existing.remove();                               // 分支 B：waiting/delayed/completed/failed → 先删
    }
    await this.indexQueue.add('reindex', payload, {
      jobId,
      removeOnComplete: 100,                                 // 保留最近 100 个成功记录便于排查
      removeOnFail: 50,                                     // 保留最近 50 个失败记录
      attempts: 3,                                          // 瞬时失败自动重试
      backoff: { type: 'exponential', delay: 2000 },        // 指数退避
    });
    return true;                                            // 投递成功
  } catch (error) {
    this.logger.warn(`入队索引失败 docId=${payload.docId}`, error);
    return false;                                           // 异常隔离：Redis 挂了不阻断文档主流程
  }
}
```

为什么这么写（硬理由，非概念）：

1. **固定 `jobId` 是去重核心**（`:63`）。BullMQ `jobId` 队列内唯一，同 docId 多次编辑/恢复恒落到同一 `jobId` → 天然防抖合并。所以 `dispatchIndexing` 不必自己记"这个 doc 上次投了没"——去重交给队列约束。
2. **`active` 不能 `remove`+`add`，必须走延迟分支**（`enqueueDelayedReindex`）。active 任务正在跑"切块→嵌入→写 pgvector"无法中断；直接 `remove` 会丢正在写的向量、硬 `add` 同 jobId 又冲突。故保留 active 主任务，另起独立 `reindex-${docId}-delayed`、延迟 30s，等 active 完成后再用最新 payload 覆盖。
3. **非 active 必先 `remove` 再 `add`**（`:73`）。BullMQ 硬约束：只要任务记录还在（含 `completed`/`failed` 终态，因 `removeOnComplete:100` 只保留不立即删），`add` 同 jobId 抛 `Job with id ... already exists`。故统一 `remove()` 清旧记录再 `add` 最新 payload。
4. **`catch → false` 与 `dispatchIndexing` 闭环**（`:84-87`）。Redis 不可用 → warn + `false` → `dispatchIndexing` 的 `||` 落空 → 不更新 `indexScheduledAt` → 该行保持"未投递" → 下轮重扫重试。
5. **payload 是全量快照**（`dispatchIndexing` 传 `{docId, userId, title, content}`）。入队即把 `content` 整份塞进 job，Worker（`ai-index.processor.ts`）直接消费快照、不回查 `documents` 表；文档后续改名/改内容不影响已入队索引。

`enqueueDelayedReindex`（`:109-132`）关键：`delayedJobId=reindex-${docId}-delayed` 与主线 `reindex-${docId}` 是**两个独立 jobId**，不与 active 主任务抢号；自身多次编辑靠 `getJob(delayedJobId)+remove()` 去重，只留最后一次编辑内容。

#### 队列如何调度向量索引（BullMQ Worker 消费 + 切块→嵌入→pgvector）

`scheduleReindex` 只负责入队（`.add()` 内部 Lua 脚本把 job 写进 Redis 的 wait/delayed）；真正生成向量的是 AI 模块的 Worker，与 `agent.service.ts` 解耦——`dispatchIndexing` 标记 `indexScheduledAt` 只代表"已投递"，不代表"已索引"。

**消费模型（BullMQ 是拉模型）**：`@Processor(AI_INDEX_QUEUE, { concurrency: 1 })`（`ai-index.processor.ts:16`）让 Nest 按队列名起一个 BullMQ Worker，启动即**阻塞拉取** `wait` 列表——不是 Cron、不是定时轮询，`.add()` 一入队就被取走。`delay:30s` 的延迟 job 进 `delayed` ZSET，到期才提升进 `wait`。`concurrency:1` = 同一时刻只跑一个（索引是重 I/O：嵌入 HTTP + pgvector 写）。队列与 Worker 在 `ai.module.ts:30` 用 `BullModule.registerQueue({ name: AI_INDEX_QUEUE })` 接线；Redis 连接由 `app.module.ts:41` 的 `BullModule.forRootAsync` 提供。

**管线 `process()`（`ai-index.processor.ts:31`）**：

```typescript
async process(job: Job<AiIndexJobPayload>): Promise<void> {
  const { docId, userId, title, content } = job.data;
  const plain = htmlToPlainText(content);       // 剥 HTML/实体 → 纯文本
  const chunks = chunkPlainText(plain);         // 700 字符/块，重叠 100（step=600）
  if (chunks.length === 0) { await this.vectorStore.deleteByDocId(docId); return; }
  const embeddings = await this.embeddingClient.embedDocuments(chunks);   // 批量 POST /embed
  await this.vectorStore.replaceDocChunks(        // 单事务：DELETE 旧块 + 逐条 INSERT
    chunks.map((text, chunkIndex) => ({
      userId, docId, chunkIndex, title, content: text, embedding: embeddings[chunkIndex]!,
    })),
  );
}
```

- `chunkPlainText`（`chunking.ts:47`）：700/100 重叠防句子被切在边界丢上下文；参数校验 `overlap < chunkSize` 防 step=1 退化成逐字符切块（DoS）。
- `embedDocuments`（`embedding.client.ts:49`）：要求返回等长数组且每向量维度 = `AI_EMBEDDING_DIMENSIONS`，否则抛 `ServiceUnavailableException` → BullMQ 按 `attempts:3` + `backoff exponential 2000` 重试。
- `replaceDocChunks`（`pg-vector.store.ts:36`）：单事务内 `DELETE FROM document_chunks WHERE "docId"=$1` 再逐条 `INSERT ... ($6::vector)`，"原子替换"保证新旧块不混留。

> 与 tick 的关系：`AiIndexProcessor` **不依赖** LLM `model.isConfigured()`，只要 Redis + 嵌入服务 + pgvector。所以 `dispatchIndexing` 的 model gate 会挡住索引投递，而 Worker 本身毫无模型依赖——这是「待拍板」疑点①的根源。

#### agent.service.ts 公开方法逐行（status / context / submit / prepareSave / resume / decide / cancel）

这 7 个方法是 HTTP 层（controller）直接调用的"用户面"入口，不含 `tick` 那条后台轮询线。逐行读发现：**模型依赖在这 7 个方法里形成了一条清晰、自洽的规则**——能不碰模型的路径一律放行，必须跑 Graph 的路径才硬性要求模型。

**① path-tree（用户面入口调用层级）**

```
controller（§1.6 12 路由）
├─ POST /runs/:id/events · /stream        → 只读快照/事件（不入本组）
├─ POST /threads/:id/messages             → AgentService.submit           :97
├─ POST /threads/:id/saves                → AgentService.prepareSave      :109
├─ POST /runs/:id/resume                  → AgentService.resume           :114
├─ POST /runs/:id/cancel                  → AgentService.cancel           :126 (注:decide 也会调)
└─ POST /runs/:id/confirmations/:id       → AgentService.decide           :134  ─┬→ APPROVED → resume
                                                                                  └→ REJECTED → cancel
GET  /agent/status                        → AgentService.status           :83
（context:90 是被上面多数方法复用的"授权上下文工厂"，非路由直连）
```

**② 文字说明（真实代码 + 为什么）**

`submit`（`:97`）：先 `if (!this.model.isConfigured()) throw ServiceUnavailableException` —— 提交必然走 Graph 推理，故**此处硬性要求模型**。workflowVersion 用"最具体意图优先"四级 else-if 链选取（章节修订 `agent-section-v1` > 全文修订 `agent-revise-v1` > 任务 `agent-task-v2` > 只读 `agent-read-v1`），保证任一 input 只命中一个版本。同事务内 `appendUserMessageAndCreateRun` 先写消息再建 Run（原子，半途崩溃不出现"有消息无 Run"）；仅当 `!record.replayed`（非幂等重放）才 `executionPaused=false`，让 tick 立刻捞起新 Run。

`resume`（`:114`）：两道守卫——`isAgentRunTerminal || cancelRequested → AGENT_RUN_NOT_RESUMABLE`；`workflowVersion !== 'agent-save-v1' && !model.isConfigured() → AGENT_MODEL_NOT_CONFIGURED`。**关键对照**：save-v1 的恢复不要求模型（纯本地保存、崩溃恢复），非 save-v1 才要求。这与 `submit` 的"必要求模型"形成镜像一致。

`decide`（`:134`）：把确认裁决完全委托给 `ToolAuthorization.decide`（比对 confirmationId/资源摘要/权限），自己只做副作用路由——APPROVED→`resume`、否则→`cancel`。

`cancel`（`:126`）：**两阶段**。阶段一（事务内）持久化 `cancelRequested=true, executionPaused=false` 让 tick 的结算分支能捞起终态化；阶段二（事务外）`SELECT` 出所有 tool_calls 逐条 `ToolExecutionControl.cancel` 通知取消。放事务外是为避免长事务持锁、且工具取消可能含外部副作用，其失败不影响"意图已持久化"这一关键不变量。

`status`（`:83`）：两个 `EXISTS` 取 AND 查 `information_schema`，只判 `agent_runs.nextDispatchAt` 与 `agent_document_saves.indexScheduledAt` 两列是否存在（= 已迁到支持调度的版本），**不是全量 schema 校验**；模型侧三项均不读网络，故该接口永不因模型关闭而 5xx。`context`（`:90`）：按 `save` 布尔切换 L0/L1 与 read/create 权限，是授权上下文工厂，每次工具调用时 `ToolAuthorization` 还会再核一遍（纵深防御）。

**③ 逐行读检阅出的发现**

- **一致性设计（正面，值得面试讲）**：模型依赖在这 7 方法里自洽——`submit`/`resume`(非save-v1) 要求模型；`status`/`cancel`/`resume`(save-v1)/`decide`/`prepareSave` 不要求。这正好与 `tick` 候选查询的 `($1 OR workflowVersion='agent-save-v1' OR cancelRequested)` 门禁闭环：**凡是模型关闭时仍要推进的路径，代码层面都已放开**，唯一例外是之前标记的 `dispatchIndexing` 被 model gate 挡住（疑点①）。
- **可商榷点 A（`decide` 的两次事务）**：`decide` 内部 `ToolAuthorization.decide` 开一个事务，随后 `resume`/`cancel` 各再开一个事务（`lockAgentOwner` 各锁一次 users 行）。是顺序两个事务、非嵌套，逻辑正确；但若把"确认裁决 + 恢复/取消"合并进一个事务会更紧凑（需权衡 `ToolAuthorization.decide` 的复用性）。非缺陷，记录待定。
- **可商榷点 B（`status` 的 model 三项）**：`!isConfigured()` 时仍调 `configuredModel()`/`limits()`，依赖这两个方法在"未配置"时也返回安全默认值（否则会抛）。已在注释中点明"模型侧三项均不读网络"——读代码时应追这两个方法的未配置分支确认无抛错，属下一层（agent-model.client）待核项。

> 以上 7 方法均为"入口编排"：自身只做参数校验、事务边界、调用下层；真正的"建 Run 细节 / 授权裁决 / 保存两阶段 / 工具取消"分别落在 `AgentConversationStore` / `ToolAuthorization` / `AgentSaveService` / `ToolExecutionControl`，按「锚点登记、详读见各层」处理。

##### status() 的 SQL 探针详解（information_schema / schema / 为什么不全量校验）

`status()` 的就绪判断是一行无 `FROM` 的纯表达式查询（`agent.service.ts:87-88`）：

```sql
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='agent_runs' AND column_name='nextDispatchAt')
  AND
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='agent_document_saves' AND column_name='indexScheduledAt')
  AS ready
```

**① SQL 结构解析**
- 没有 `FROM` 业务表：只对表达式求值，最终返回**单行单列** `ready`（`boolean`）。
- 两个 `EXISTS` 取 `AND`：`ready = A列存在 AND B列存在`，两列都在才 `true`。`const [row]` 解构出唯一行，`row?.ready === true` 取布尔。
- `SELECT 1` 是哑值：`EXISTS` 只关心子查询"是否至少返回一行"，不看 SELECT 列表内容，写 `1`/`*`/`null` 都等价。

**② 为什么用 `information_schema.columns`（约定俗成的标准用法）**
- 它是 **SQL 标准（ISO/IEC 9075）定义的元数据视图**，PostgreSQL / MySQL / SQL Server / Oracle 都实现。所以"用它探列是否存在"跨库可移植、团队无需解释——这正是"约定俗成"的根。
- PostgreSQL 私有的替代写法是直接查 `pg_catalog.pg_attribute` 联 `pg_class` / `pg_namespace`（前者内部就是建在这套系统表之上）。`pg_catalog` 更强（能拿生成列/系统列），但**不跨库、暴露 PG 实现细节**，一般只在 `information_schema` 表达不了时才用。本项目选标准视图，图可读、可移植。

**③ 为什么不直接查业务表有没有这个列**
其实我们"就是在查某张具体表有没有某列"——只是通过**系统目录视图**查，而非触碰表本身。不直接 `SELECT nextDispatchAt FROM agent_runs LIMIT 0` 有三个硬理由：
1. **未迁移环境会抛错、让接口 5xx**：迁移没跑时该列/表不存在 → PG 直接抛 `column does not exist` / `relation does not exist`，异常冒泡把本应返回 `ready:false` 的接口打成 500。而 `status()` 设计要求"永远不报错、只回显状态"（`:82`/`:89` 注释）。
2. **`information_schema.columns` 是元数据视图、非业务表**：只读系统目录，不受行锁/业务表权限/数据状态影响，零副作用、永远安全返回布尔。这正是 `:86` 注释"故意只查 information_schema 而非碰业务表"。
3. 它本身就是 SQL 标准里"检查列是否存在"的规范写法。

**④ `WHERE table_schema = current_schema()` 的作用（关键机制差异）**
- **两种机制不同**：`SELECT * FROM agent_runs`（业务查询）靠 `search_path` 解析未限定表名，自动取"第一个含该表的 schema"——这是**名字解析阶段**的魔法，结果等价于查 `current_schema().agent_runs`；而 `FROM information_schema.columns WHERE table_name='agent_runs'` 只是**按列值过滤一张视图**，**不触发任何 search_path 解析**，会返回所有 schema 里名为 `agent_runs` 的行（多 schema 就是多行，没有"第一个"概念）。
- **不加 schema 过滤会假阳性**：若 `public.agent_runs` 有该列、但 app 实际用的 `myapp.agent_runs` 没有 → `EXISTS` 仍为 `true` → 探针报 `ready:true`，可 app 一跑 `tick` 就列不存在报错。加 `table_schema = current_schema()` 让目录查询**精确对齐业务查询的解析结果**——只认 app 真正用的那个 schema。
- **为什么不写死 `'public'`**：用 `current_schema()` 让探针跟随部署的 `search_path` 配置；万一哪天配自定义 schema 也不用改码，属"不假设单 schema"的防御式写法。

**⑤ schema 是什么（基础概念）**
- 层级：`数据库(database) > schema（命名空间）> 表/视图`。schema 是"装表、视图、函数等的容器"。类比：数据库是磁盘，schema 是文件夹，表是文件；或类比编程语言的 namespace / package（同名对象放不同 schema 不冲突）。
- **PostgreSQL vs MySQL 对应关系（易混点）**：
  - MySQL 里 `SCHEMA` 是 `DATABASE` 的**同义词**（`CREATE SCHEMA` ≡ `CREATE DATABASE`），所以 MySQL 的"schema"就等同于"直接装表的那层容器"。
  - PostgreSQL 多一层：`database > schema > table`，故 **PG 的 `schema` ≈ MySQL 的 `database`**（都是直接装表的那层）；PG 的 `database` 是更重的隔离单元（独立 catalog，跨库查询需 FDW）。
  - **schema ≠ 视图（view）**：视图是"保存的查询/虚拟表"，在两种库里都一样；schema 不是视图。会混淆只因 `information_schema` 这个 schema 里恰好装的是视图，纯属巧合，非定义。

**⑥ 本项目实际是单 schema（已核）**
- 实体装饰器 `@Entity('agent_runs')` / `@Entity('agent_document_saves')` **都没带 `schema` 选项**（已读 `entity/agent-run.entity.ts:10`、`entity/agent-document-save.entity.ts:4`）→ 这些业务表落到连接的默认 schema（默认 `public`）。
- 所以本项目 `current_schema()` 实际就是 `public`，`table_schema = current_schema()` 等价于 `= 'public'`，多 schema 误判风险在你这不存在；代码写 `current_schema()` 只是通用、不假设单 schema。
- 补充事实：项目里**确有第二个 schema `agent_checkpoint`**（来自 `createAgentCheckpointer(schema='agent_checkpoint')`，给 LangGraph 检查点状态用），但那是独立的、与 agent 业务表无关，别混为一谈。

> 另记：`status()` 只查 `nextDispatchAt` / `indexScheduledAt` 两个"迁移哨兵列"（两列分别由不同迁移加入，代表调度/索引两条能力），**不是全量 schema 完整性校验**——未迁移环境也只安全返回 `ready:false` 而不报错。全量校验的 `ensureReady` 运行时探针已在 §1.6 反例里删除（部署闸门 `docker-entrypoint.sh` 已在 Nest 启动前跑迁移）。

##### transaction() 重载：为何有的传隔离级别、有的不传

`DataSource/EntityManager.transaction()` 是两个重载：**第一个参数是字符串 → 隔离级别**；**第一个参数是函数 → 回调（用默认隔离级别）**。

- 本项目用 PostgreSQL，默认隔离级别即 `READ COMMITTED`，故 `transaction('READ COMMITTED', fn)` ≡ `transaction(fn)` 在 PG 下**行为等价**。
- 生产代码（agent.service.ts:116/134/160/287 及全部 store/writer/runner）**统一显式传 `'READ COMMITTED'`**；缺省短写只出现在测试（`tool-call.persistence.integration.test.ts:234/239/254`），测试不在乎隔离级别。
- 只有**非默认级别**才真正改变行为：`agent-artifact.store.ts:109` 与 `agent-data.exporter.ts:48` 用 `'REPEATABLE READ'`（导出/快照需可重复读，防中途数据变）。
- 显式写 `'READ COMMITTED'` 即使等价也不冗余：**自解释意图** + **防御连接复用导致会话级隔离被改过**的兜底。

##### submit 外层事务的必要性（内层 savepoint + 解暂停原子性）

`appendUserMessageAndCreateRun` 内部不是一条 SQL——它自己开事务（`agent-conversation.store.ts:154`）跑「锁 → 校验线程 → 幂等去重 → 插消息+Run+事件 → 回填 runId」共 4~7 条语句，必须原子（否则"有消息无 Run"）。submit 再包一层事务（`:116`）的真正价值：

1. **提供被共享的 `manager`**：`new AgentConversationStore(manager)` 把同一事务的 EntityManager 传进 append 与后面的 `UPDATE agent_runs SET executionPaused=false`，三段同连接同事务。
2. **把"建 Run + 解暂停"绑成原子单元**：`if (!record.replayed) UPDATE executionPaused=false` 依赖 append 刚返回的 `record.run.id`，目的让新 Run 立刻解除暂停、好让 tick 捞起。两步必须一起提交——否则 append 提交但 unpause 没跑（进程在中间崩），Run 留在 `executionPaused=true`，而 `tick` 候选查询过滤暂停 Run → **永久卡死、且重试因 `replayed=true` 跳过 unpause 而救不回**。
3. **内层 `transaction` 不独立提交**：当 `this.manager` 已是 submit 事务里的 EntityManager 时，内部 `this.manager.transaction()` 不再开物理事务，而是作为外层事务的 **savepoint（嵌套点）**；真正落库只发生在 submit 外层边界。所以 append 内部写入与外层 unpause UPDATE 处在**同一回滚边界**。

> 结论：用户面"看起来只有一行"是因为重活在 append 内部；事务在这里有两层正当性——内层保证消息+Run 多语句原子，外层保证"建 Run 且 解暂停"要么全做要么全不做。

##### executionPaused 调度闸门（与 status / nextDispatchAt / cancelRequested 正交）

`agent_runs` 上的布尔列（`agent-run.entity.ts:83`），迁移默认 `true`（出生即暂停）。`tick` 候选查询第一行硬过滤（`:191`）：`WHERE "executionPaused"=false`。

它和另外三维**正交**，共同决定一条 Run 能否被 tick 派发：

| 列 | 维度 | 含义 |
|---|---|---|
| `status` | 生命周期 | CREATED→…→COMPLETED/FAILED/CANCELLED（终态与否） |
| `executionPaused` | 暂停闸门 | 即便非终态，被按住也不派发 |
| `nextDispatchAt` | 退避时间戳 | tick 最早何时才可考虑它 |
| `cancelRequested` | 取消意图 | 配合 `executionPaused=false` 让 tick 的取消分支结算 |

`tick` 需同时满足：非终态 **且** `executionPaused=false` **且** `nextDispatchAt<=now`（模型关时还要 `cancelRequested=true` 或 save-v1）。

默认出生暂停的设计：**解耦"Run 已存在"与"Run 可被派发"**，由显式信号放行。置 `false`（放行）的三个点：`submit`（`:120` 全新提交）、`resume`（`:142`）、`cancel`（`:165` 连 cancelRequested 一起，使模型关时也能被结算）。`:226` 派发后 `SET executionPaused=NOT "cancelRequested"`——BUSY 时保持暂停等下轮、已请求取消则放行给取消分支。

##### cancel 两阶段拆分的三个理由（agent.service.ts:158-172）

- **阶段一（事务内）**：`lockAgentOwner`（users 行 `FOR UPDATE`）+ 幂等判终态 + `UPDATE ... "cancelRequested"=true,"executionPaused"=false,"nextDispatchAt"=clock_timestamp()`。持久化**取消意图**，让 tick 的 `settleCancellation` 分支能捞起并终态化。
- **阶段二（事务外）**：逐条 `ToolExecutionControl.cancel` 通知在途工具调用停止（释放租约/标 CANCELLED）。

拆分的硬理由：

1. **事务要短、不长持锁**：阶段一持有 users 行锁并做一条 UPDATE，毫秒级提交放锁；阶段二逐条通知可能耗时/含外部调用，塞进同事务会长时间持锁、致同用户操作阻塞甚至死锁。
2. **"意图已持久化"不变量不能被阶段二失败拖累**：若两阶段合一，阶段二抛错会**整体回滚** → `cancelRequested=true` 被撤销 → 取消意图丢失 → Run 继续跑（bug）。拆分后阶段一先独立提交，阶段二失败仅工具多跑一会儿。
3. **工具取消含外部副作用，本不该进 DB 事务**：释放租约、调适配器无法靠事务回滚，放进事务既给不了原子性又白拉长锁。

> 阶段二**不是终态化本身**——真正翻 `CANCELLED` 是异步的 `tick`→`settleCancellation`（其守卫 `:294-297`：尚有非终态工具调用就返回、不终态化，防"撂半路"）。阶段二只是**加速收敛**：主动把在途工具调用摁停，让"工具都落下"这个安全条件尽快满足，结算尽早发生。这是本模块反复出现的"持久化意图 + 异步结算"模式（submit / settleCancellation / cancel 同构）。

---

#### tick 主分派循环的委托方法锚点（详读见各层）

`dispatchIndexing`/`settleCancellation` 这一支已读完；`tick` 主循环"取 10 条候选 Run → 分派 graph/save/cancel"的**分派调用点也已读**（每个分支调谁、在什么条件下调，已清楚）。**被调用的实现**（下表四个方法）按「锚点现在登记、详读放到对应层」策略留到编排/工具/持久化层深读——**这不等于"tick 没读"，只是实现未深读**。锚点如下：

| 委托方法 | 文件:行 | 归属层 | 一句话职责 |
| --- | --- | --- | --- |
| `ToolExecutionMaintenance.runOnce()` | `tools/tool-execution-maintenance.ts:44` | 工具层（维护） | 跑 `recoverExpiredAll` / `advanceDueRetries` / `expireDue` 三件套：回收租约超时、推进重试、清理过期 |
| `AgentGraphRunner.run()` | `agent-graph.runner.ts:57` | 编排执行层 | 持会话锁 → `CREATED→QUEUED→RUNNING` → `invoke` 编译图（检索→模型→工具→成果）→ `finish` 闸门 |
| `AgentSaveService.execute()` | `agent-save.service.ts:49` | 工具保存层 | L1 写工具两阶段保存的"批准后原子提交"（单事务写 document，无事务外适配器） |
| `AgentRunWriter.transition()` | `agent-run.writer.ts:30` | 持久化层 | Run 状态机原子推进（行级 CAS `WHERE status=旧 AND revision=旧`），与事件同事务 |

> 注意：`AgentRunWriter.transition`（writer，:30）包的是 `AgentRunStore.transition`（store，:97）；`tick` 用的是 Writer 这层"事务组合入口"。另有 `tool-call.store.ts:114` 的 `transition` 是 ToolCall 级，别混淆。

---

## 第三遍 · 今日小结（2026-10-20：provider 生命周期与 DI 边界）

**读的范围**：`agent.service.ts` 的类级部分——字段、构造器（`assembleV1Tools` / `catalog`）、`onModuleInit` / `onModuleDestroy`、`status()`。全部沉淀在 §1.3（8 个 #### 小节）+ §1.1 末尾的「DI 的边界」小结。

**今天真正改了的代码（不只是读）**

| 改动 | 文件 | 原因 |
| --- | --- | --- |
| 补 `app.enableShutdownHooks()`（4 行含注释） | `apps/server/src/main.ts:55` | 全仓原本没有，Nest 默认不注册信号处理器 → `docker stop` 时 `AgentService.onModuleDestroy` 从不执行，在途 `tick()` 有被硬杀风险。已读 Nest 11.1.18 `nest-application-context.js:197` 验证关闭顺序 |

**今天修正的四个自己的口径**（记下来是为了下次不再犯）

1. `void poll()` 不是为了 lint —— 本仓库没开 `no-floating-promises`，是意图标记（§追问 B 已改）。
2. `unref` 不是"必须的双保险" —— 两种世界里定时器都阻挡不了退出，它在本项目不可达，属低价值保险（§1.3 末节追问）。
3. `assembleV1Tools` 放构造器不是因为"安全考虑"，是因为零 IO + fail-fast + public `catalog` 构造即完整。
4. "5 条待补" 不代表什么都缺 —— 分类索引里 8 行原本标"待补"的知识域实际都已沉淀，已改为实锚点。

**待用户决定**：`agent.service.ts` 里两处 `this.timer.unref()` 删不删（结论：不可达保险但零成本，倾向留）。



| 层     | 文件                                         | 状态             | 已沉淀知识点                                                  |
| ----- | ------------------------------------------ | -------------- | ------------------------------------------------------- |
| 入口层   | `agent.module.ts`                          | ✅ 逐行           | NestJS·DI 容器（双重引用 / Provider 托管 / 装饰器反射）、TS·import type |
| 入口层   | `agent.controller.ts`                      | ✅ 已完成（12 路由） | §1.4 异常过滤器 / §1.5 四件套 / §1.6 路由方法（submit、decide、@Sse stream 已扩成完整版）+ 追问 A–E；重构产物 `agent-run-stream.poller.ts` / `agent-stream.registry.ts` + 17 例单测 |
| 入口层   | `agent.service.ts`                         | 🔶 见下方「最新进度表」（本旧表已弃用） | 状态以 10-22「最新进度表」为准 |
| 编排执行层 | `agent-graph.ts` / `agent-graph.runner.ts` | 🔲             | —                                                       |
| 持久化层  | store / writer / reader                    | 🔲             | —                                                       |
| 工具保存层 | `tool-executor.ts` 等                       | 🔲             | —                                                       |

> 明日接续点：`agent.service.ts:152` `async tick()` —— 调度主循环（`context()` → `dispatchIndexing()` → `ToolExecutionMaintenance.runOnce()` → 取 10 条待派发 Run → 分派 `agent-graph` / `agent-save` / 重试 / 取消 → `nextDispatchAt` 退避推进 → `executionPaused` 翻转）。这是核心逻辑，需要逐行 + 事务边界 + 状态推进一起读。

---

## 第三遍 · 今日小结（2026-10-22：`agent.service.ts` 收官）

**读的范围**：`tick()` 全文（候选查询/降级门禁/三分支裁决/懒初始化/`+2s` 冷却/catch 归一）→ `dispatchIndexing()`（持久投递全链）→ `settleCancellation()`（会话锁三重守卫）→ 顺读 `createAgentCheckpointer()`。沉淀位置：§三 3.2（事务/行锁/会话锁/CAS/`nextDispatchAt`/`LIMIT`/取消收敛，七个 #### 全部实锚点）、§二（`Parameters`/`ConstructorParameters`、双重断言、解构赋值进外层变量、默认参数+白名单）、§1.1（DI 边界表新增 `AgentGraphRunner` 行）、§六（降级门禁/BUSY/fail-fast/`||` 控制流）。

**今天真正改了的代码（纯注释，执行语句零改动）**

| 改动 | 文件 | 原因 |
| --- | --- | --- |
| `tick()` JSDoc 四步结构 + 8 段行内 Why | `agent.service.ts:146-200` | 用户反馈"注释太少"；BUSY 为何 continue、错误码正则契约、终态守卫竞态等此前只存在于对话里 |
| `dispatchIndexing()` JSDoc + 5 段行内 | `agent.service.ts:202-231` | LEFT JOIN 为何不能换 INNER、`LIMIT 10` 节奏、复合条件四走向、投递语义不回滚 |
| `settleCancellation()` JSDoc + 7 段行内 | `agent.service.ts:235-275` | 专属 QueryRunner 的会话级锁理由（池化换连接会 unlock 落错会话）、`lockAgentOwner` 是**行锁不是咨询锁**（读源码后才写）、嵌套 finally 顺序 |
| `createAgentCheckpointer()` JSDoc + 4 段行内 | `agent-checkpointer.ts:4-25` | 两道守卫动机、标识符无法参数化只能白名单、版本自检 fail-fast |
| 修正 `+2s` 注释的**错误口径** | `agent.service.ts:186` | 原写"无论成功还是已处理的失败都统一推后"——**失败走 catch 根本到不了这行**，已改为"仅成功路径执行，真正消费者是非终态的成功返回" |

**今天修正的两个自己的口径**（记下来为了下次不再犯）

1. "+2s 成功失败都推" —— 错。失败进 catch 打 paused 出局，try 里的推后行被异常跳过；真实消费者只有 `WAITING_CONFIRMATION` 和取消未结算两种非终态成功返回，终态行是无害空转。
2. `lockAgentOwner` 是"用户级咨询锁" —— 错。读 `agent-data.cleanup.ts:7-11` 确认是 `users` 表 `FOR UPDATE` **行锁**（事务级持有、顺带校验用户存在）。与 advisory lock 的分工：用户级串行用行锁，Run 级互斥用会话锁。

**发现的设计疑点（待用户拍板，未改码）**

- `tick()` 第一行 `if (this.model.isConfigured()) await this.dispatchIndexing()` 的 gate 与主查询不一致：主查询在模型关闭时仍放行 `agent-save-v1`（保存执行不碰模型），即"模型关闭期间保存照样能完成"，但这些保存的索引投递却被 model gate 挡住，文档静默不入向量库直到模型恢复。建议摘掉 gate（索引/BullMQ worker 与模型配置无关）；备选是保持总闸语义但写进运维文档。
- 附带两个小重构提议：① `isConfigured()` 每轮调两次，可 hoist 成 `const modelReady`；② catch 里 `error instanceof Error` 写两遍，可收窄一次成 `const failure = error instanceof Error ? error : undefined`。

**10-22 收工后补读（用户点名回头读）**：`scheduleReindex`（`ai/document-index.service.ts:62`）是 `dispatchIndexing` 第三处 `||` 操作数真正引用的 BullMQ 投递方法，10-22 当时只讲了语义没读实现。本轮补读：固定 `jobId=reindex-${docId}` 去重、`active` 冲突走 `enqueueDelayedReindex` 延迟 30s、非 active 先 `remove` 再 `add`、catch 返回 `false` 与 `dispatchIndexing` 闭环（不标记 → 下轮重扫）。已新增 §三 `||` 控制流小节后 `scheduleReindex 真实实现` 子节，进度表 `agent.service.ts` 行同步改为"类体读完（仅主循环线）+ 委托方法 scheduleReindex 已补读"。

**最新进度表**（取代 10-20 表）

| 层     | 文件                                         | 状态             | 已沉淀知识点                                                  |
| ----- | ------------------------------------------ | -------------- | ------------------------------------------------------- |
| 入口层   | `agent.module.ts`                          | ✅ 逐行           | NestJS·DI 容器（双重引用 / Provider 托管 / 装饰器反射）、TS·import type |
| 入口层   | `agent.controller.ts`                      | ✅ 已完成（12 路由） | §1.4 异常过滤器 / §1.5 四件套 / §1.6 路由方法；重构产物 `agent-run-stream.poller.ts` / `agent-stream.registry.ts` + 17 例单测 |
| 入口层   | `agent.service.ts`                         | ✅ 类体 + 全部公开方法逐行读完 | §1.3 全套；§1.1 DI 边界；§三 3.2 七 ####；§六 四项；`enableShutdownHooks` 已补；`scheduleReindex 真实实现` 子节；跨模块索引管线；**新增 §三「agent.service.ts 公开方法逐行」子节**（status/context/submit/prepareSave/resume/decide/cancel + 模型依赖一致性规则 + 2 处可商榷点）；主分派循环被调实现见 §三「tick 主分派循环的委托方法锚点」表，留各层深读 |
| 编排执行层 | `agent-graph.ts` / `agent-graph.runner.ts` | 🔲             | —                                                       |
| 持久化层  | store / writer / reader                    | 🔲             | —                                                       |
| 工具保存层 | `tool-executor.ts` 等                       | 🔲             | —                                                       |

> 明日接续点：① 先逐行读完 `agent.service.ts` 剩余公开方法（`submit` / `decide` / `status` 之前只析入口未逐行；tick 分派调用点已读、无需重读）——这些方法里的委托调用（AgentConversationStore / AgentRunWriter / AgentSaveService 等）按「锚点现在登记、详读见各层」处理；② 读完后再进下一层，首选编排执行层 `agent-graph.ts`→`agent-graph.runner.ts`（面试素材密度最高）；③ 收工前跑一次全量 `typecheck`/`lint` 验证 `main.ts` 与纯注释改动。

## 第三遍 · 今日小结（2026-10-22 续：索引调度链路 + tick 线收口）

**读的范围（跨模块补读）**：用户追问"indexQueue 怎么调度生成向量索引"，补读 AI 模块索引管线——`ai-index.processor.ts`（`@Processor(AI_INDEX_QUEUE,{concurrency:1})` Worker，`process()` 跑 htmlToPlainText→chunkPlainText(700/重叠100)→embedDocuments(HTTP /embed)→replaceDocChunks 单事务 DELETE+逐条 INSERT `$6::vector`）；`ai.module.ts`（BullModule.registerQueue + @Processor）；`ai.constants.ts`（AI_INDEX_QUEUE='ai-document-index'）；`chunking.ts`/`embedding.client.ts`/`vector/pg-vector.store.ts`；`app.module.ts:41` BullModule.forRootAsync 提供 Redis 连接。

**关键认知**：BullMQ 是**拉模型**——Worker 启动即阻塞拉取 wait 列表，job 入队即被取走；delayed job（delay:30s）走 delayed ZSET 到期才提升进 wait；`process()` 只执行不检查。`.add()` 内部 Lua 脚本写 Redis（job hash + wait/delayed），应用层无显式 Redis 代码。

**代码决策（用户拍板）**：`enqueueDelayedReindex` 与 `scheduleReindex` 的 add 选项块重复——确认属实，提议抽 `REINDEX_JOB_OPTIONS` 常量；**用户决定不改**（"虽然冗余但可读性强"）。

**tick 线状态（口径修正）**：今日完成 `dispatchIndexing`/`settleCancellation` 这一支（含 scheduleReindex + 整条索引管线），且 `tick` 主循环"取 10 条候选 Run → 分派 graph/save/cancel"的**分派调用点已读**（每个分支调谁已清楚）；仅**被调实现**（AgentGraphRunner.run / AgentSaveService.execute / AgentRunWriter.transition / ToolExecutionMaintenance.runOnce，见 §三 锚点表）按策略留到各层深读。**tick 这条线的阅读是完整的（调用点层面），实现深读是下一层的任务。**

**明日计划**：① 逐行读完 `agent.service.ts` 剩余公开方法（submit/decide/status 等，之前只析入口）；② 读这些方法的委托调用时按"锚点现在登记、详读见各层"；③ 之后进编排执行层；④ 收工跑全量 typecheck/lint。

**待用户拍板（沿用）**：tick 第一行 model gate 与"模型关时 save-v1 仍放行但索引投递被挡"矛盾（建议摘 gate）；`isConfigured` hoist 成 `modelReady`；catch 里 `failure` 收窄一次。

---

## 第三遍 · 今日小结（2026-10-26：编排执行层 `agent-graph.ts` 逐行读完）

**读的范围**：`agent-graph.ts` 全部节点/边/端口/state 声明（`Annotation`/`AgentGraphState`/`AgentGraphPorts`/`createAgentGraph`）逐行读完，并生成完整执行流程图（含 ReAct 多轮循环 + 条件分支 + 成果流）。runner 初步理解（实例级别 vs graph 级别）。

---

### 编排执行层 · `agent-graph.ts` 知识点

#### Annotation 是 LangGraph 的状态声明 API

`Annotation.Root({...})`（`agent-graph.ts:16`）聚合多个 channel 为图的状态 schema，传给 `new StateGraph(AgentGraphState)`（`:90`）。每个字段用 `Annotation<T>()`（`:18–30`）声明状态槽。

**关键反直觉点：默认 reducer = 覆盖（overwrite），不是追加**。节点返回值和状态逐键合并，但没有自定义 reducer 的 channel 默认用"最后一次写入胜出"——所以 `tools` 节点必须手动展开旧值：

```typescript
return { messages: [...state.messages, ...results], citations };  // agent-graph.ts:130
```

若直接 `{ messages: results }` 会**丢掉历史消息**。`typeof AgentGraphState.State`（`:71`）把声明还原成 TS 类型供节点参数标注——这是"值 → 类型 → 取 .State"的两步升格（`Annotation.Root` 产的是运行时定义器值，不是类型）。

#### AgentGraphPorts 六边形架构端口设计

`AgentGraphPorts`（`:33–58`）是图的**外部能力接口**，`createAgentGraph` 的第一个入参（`:61`）。典型依赖倒置：图只声明"我需要什么"，具体实现由 `agent-graph.runner.ts` 注入。

| 端口 | 调用点 | 职责 |
|------|--------|------|
| `initialize()` | `initialize` 节点 :92 | 从业务记录构建初始 messages/versions/citations |
| `guard()` | **几乎每个节点开头**（:72/96/107/134…） | 每步重检 Run 状态/归属/Worker 存活——恢复后必须重新确认"还该不该继续干" |
| `tools(versions)` | `model` 节点 :98 | 当前权限 ∩ 固定版本求交，**不沿用 checkpoint 里的权限**（防 stale auth） |
| `model(messages, tools)` | `model`/`synthesize` 节点 | 单步模型调用 |
| `tool(call, version, callKey)` | `tools` 节点 :116 | 执行单个工具；`callKey` 由轮次/位置固定生成 → 恢复复用已提交副作用 |
| `artifact?.publish(...)` | `publishOutline`/`publishDraft` | 幂等发布成果到业务表 |
| `finish(answer, citations)` | `finish` 节点 :166 | 幂等提交可见回答与 Run 终态 |

`artifact` 是可选端口（`:47`）：读/对话模式不装配，图靠 `ports.artifact?.xxx` 短路走不同边（`:170/172`），避免为不同工作流写多张图。

#### `addEdge` vs `addConditionalEdges`

- `addEdge(from, to)`：固定边，编译时确定（如 `START→initialize`、`tools→model`、`finish→END`）。
- `addConditionalEdges(from, fn)`：运行时根据 `State` 或 `ports` 的值动态决定走向。`model` 后的条件路由（`:170`）是 ReAct 核心：
  - `state.answer` 为真 → 有 `artifact` 则进成果流（修订模式直奔 `draft`，否则先 `generateOutline`），否则直接 `finish`
  - `state.answer` 为假 → `tools` 执行后回到 `model` 继续循环

#### synthesize 中 messages 是人工构造的（非直接用 state.messages）

`state.messages` 只存真实对话历史，但 `state.answer`/`state.outline` 作为独立字段存在 State 里。**模型消费上下文时必须看到完整对话历史**，所以 `synthesize`（`:71`）要把这些"散落在 State 各字段里的产物"回灌成 `assistant` 消息，再拼接本轮固定提示词模板作为 `user` 消息。

这不是"伪造消息"，而是**把业务流程翻译成模型能消费的对话格式**。不同模式（章节替换/修订/提纲/草稿）走不同提示词模板，但统一走 `messages` 通道。

#### `state.citations` 引用标签绑定

`AgentCitationBinding = { label: string; sourceId: string }`（`agent-citations.ts:2–7`）。`read_document` 工具执行后由 `AgentToolSourceStore.captureReadDocument`（`agent-tool-source.store.ts:60`）生成绑定，标签按 `S1`、`S2`…顺序分配，最多 20 个。

- `tools` 节点收集（`agent-graph.ts:137–141`）：去重后并入 `state.citations`
- `synthesize` 节点校验（`:87`）：`validateAgentCitations(result.text, state.citations)` 检查模型回答里的 `[S...]` 是否都在已知列表中，**防止模型 hallucinate 引用**

#### synthesize 只管生成、publish 独立

`synthesize` 调用 `ports.model(messages, [])` 让 LLM 生成内容，产物写入 `state.outline` 或 `state.answer`。`publishOutline`/`publishDraft` 是独立节点，调用 `ports.artifact.publish()` 把 State 里的产物**幂等写入业务表**。

**为什么必须拆开**：生成先进入 checkpoint（节点后自动落盘），再经独立节点幂等写入。如果把"生成 + 发布"写成一个节点，发布时崩了恢复重跑会**重复发布**。拆开后 `publish` 靠 requestKey 等幂等机制保证重复执行不 duplicate。

#### `model` 节点 vs `synthesize`：ReAct 决策中枢 vs 强制生成

| | `model` 节点 | `synthesize` |
|---|---|---|
| tools | 传入真实工具列表 | 传入 `[]`（剥夺工具调用权） |
| 分支 | 两条出口：`answer` → 终态/成果流；`toolCalls` → tools 循环 | 单出口：总是生成内容 |
| 消息 | 直接喂 `state.messages`（真实历史） | 人工拼装（历史 + 回灌产物 + 固定模板） |
| 产物 | `answer` 只是"模型认为可以回答" | `outline`/`answer` 是最终业务写入 |

`model` 节点是 ReAct 的**"思考+决策"中枢**（给工具、看历史、决定回答还是行动）；`synthesize` 是**"强制生成"闭卷考试**（不给工具、给固定题目、必须直接写答案）。两者绝不能合并，合并就断了循环。

#### `addNode('xxx')` vs `ports.xxx()`：节点是步骤、ports 是能力

- `addNode('model')` / `addNode('tools')`：图的**执行步骤**，声明"走到这步时执行什么逻辑"
- `ports.model()` / `ports.tool()` / `ports.tools()`：节点内部**调用的外部能力接口**

关系：**节点 → 调用 → ports**。`addNode` 决定"做什么、顺序怎样"，`ports` 提供"每一步具体怎么落地"。

#### runner 实例 vs graph 实例

```
AgentService
└─ this.runner = new AgentGraphRunner(services)   ← 一个实例，长生命周期
   ├─ .run(Run-A) → createAgentGraph(ports-A) → graph-A.invoke()
   ├─ .run(Run-B) → createAgentGraph(ports-B) → graph-B.invoke()
   └─ .run(Run-A) → createGraph(ports-A) → 从 checkpoint 恢复继续
```

- **runner 实例**：复用（`if (!this.runner)` 只 new 一次）
- **graph 实例**：per-run（`run()` 内现场 `createAgentGraph(...)`）
- **checkpointer**：共享（同一 PostgreSQL，按 `thread_id: key` 区分不同 Run 的断点）

每次 `run()` 都根据当前 Run 的 `workflowVersion` 决定 `artifact` 端口配置（`agent-read-v1` 无成果流、`agent-task-v2` 带审查、`agent-revise-v1` 跳过提纲、`agent-section-v1` 带章节替换），所以图必须现场编译。

#### `agent-graph.runner.ts` 逐行阅读要点

**`run()` 9 步流程**
1. `agentCheckpointKey` 生成 advisory lock key = thread_id（同一字符串两用：PG 会话锁 + LangGraph checkpoint key）
2. 独立 `QueryRunner` 建连接 → `pg_try_advisory_lock` 抢锁（会话级，网络调用期间不持业务行锁）
3. `load()` 加载 Run + 白名单校验；`authorization()` 查最新策略
4. 状态机推进：CREATED → ENQUEUE → START（`AgentRunWriter.transition` CAS 条件更新）
5. 按 `workflowVersion` 组装 `artifact` 端口（`if/else` 提前构建，避免三元嵌套）
6. `createAgentGraph(ports, checkpointer, limits)` 现场编译图
7. `graph.getState(config)` 检查 checkpoint：全新启动 `{}` / 中断恢复 `new Command({ resume: true })` / 已跑完 `null`
8. `graph.invoke(input, config)` 执行图
9. `finally` 双重释放：先 `pg_advisory_unlock` 再 `queryRunner.release`（顺序不可颠倒）

**`load()` 优化：加 `skipValidation` 参数**
- 入口（`:127`）走完整校验：存在 + threadId + workflowVersion 白名单 + mode 约束
- 内部端口（guard/artifact/model/tool/finish 等 8 处）传 `true` 只查存在性，跳过白名单——因为 Run 走到这些端口时前面已验证过多轮

**变量重命名**
- `lock` → `queryRunner`：消除"还没加锁变量就叫 lock"的歧义。advisory lock 是后面 SQL 申请的，queryRunner 只是独立连接对象。

---

### 跨文件追读（runner 下游方法）

| 文件 | 方法 | 核心理解 |
|---|---|---|
| `agent-artifact-revision.ts` | `loadAgentRevision` | 版本冲突三条规则：① 基准版仍最新 ② 当前 Run 自己刚提交 v+1（幂等恢复）③ 其他 Run 抢先发布 → 冲突。`revisionMaterial` 用正则 `strip` 去除旧稿 `[S...]` 标签，防止模型沿用旧引用 |
| `tools/tool-resources.ts` | `inspectToolResources` | 三层校验：scope 白名单 → DB 存在性（documents/folders 表）→ SHA-256 版本摘要（bindingDigest）。`library` 只读不写；`document` 不能 `create`。实时查询不缓存，权限撤销立即发现 |
| `agent-artifact.store.ts` | `publish` | 幂等重放：同一 artifact+version+digest → 直接返回已存记录。CAS 版本递增：`expectedVersion + 1` 必须等于当前最新版 +1。`citedIds` 包含正文引用 + evidence 引用，两者都需要权限复核 |
| `agent-citations.ts` | `validateAgentCitations` | 全文扫描 `[S...]`（**包括代码块**），不静默修复。标签必须是 `[S数字]`（S0/S01 非法），且必须在 bindings 列表中有映射。返回实际被引用的 sourceId 列表 |
| `agent-evidence.ts` | `parseAgentEvidenceReport` | 结构合法 ≠ 事实正确。五层校验：顶层结构 / issue 字段 / sourceLabels 存在性 / description 中的 `[S...]` 必须在 sourceLabels 中显式列出 / 整体 ≤64KiB |
| `agent-knowledge.service.ts` | `collect` | `Promise.allSettled([RAG, 搜索])` 并行，单路失败降级。RAG 优先（语义精度高），search 只补充未覆盖文档。归属复核：回查 documents 表确认未删除。Unicode code point 切片（非字节切片） |

**设计债务（未改，已记）**

- `validateAgentCitations` 职责过载：同时做"bindings 校验"和"answer 扫描提取"。`agent-evidence.ts:31` 传哑字符串 `'证据引用映射'` 只为复用前者，语义不清晰。应拆为 `validateBindings` + `extractCitations` 两个函数。

**代码改动汇总（纯注释 + 小重构，零逻辑变更）**

| 文件 | 改动 |
|---|---|
| `agent-graph.ts` | 中文注释（createAgentGraph JSDoc + 节点 + 边） |
| `agent-graph.runner.ts` | 注释 + load skipValidation + artifact 拆 if + lock→queryRunner |
| `agent-artifact-revision.ts` | 注释 |
| `tools/tool-resources.ts` | 注释 |
| `agent-artifact.store.ts` | 注释 |
| `agent-citations.ts` | 注释 |
| `agent-evidence.ts` | 注释 |
| `agent-knowledge.service.ts` | 注释 |

**更新进度表**

| 层 | 文件 | 状态 | 已沉淀知识点 |
|---|---|---|---|
| 入口层 | `agent.module.ts` | ✅ 逐行 | NestJS·DI 容器、TS·import type |
| 入口层 | `agent.controller.ts` | ✅ 已完成 | 异常过滤器 / 四件套 / 路由方法 |
| 入口层 | `agent.service.ts` | ✅ 类体 + 全部公开方法逐行读完 | §1.3 全套；§三 七 ####；跨模块索引管线 |
| **编排执行层** | **`agent-graph.ts`** | **✅ 逐行读完** | **Annotation / Ports / State / Nodes / Edges / 完整执行流程图；10+ 知识点见上** |
| **编排执行层** | **`agent-graph.runner.ts`** | **✅ 逐行读完** | **`run()` 9 步 / advisory lock / load skipValidation / artifact if/else 拆分 / 6 端口实现 / checkpoint 恢复 / 下游追读 8 文件** |
| 持久化层 | store / writer / reader | 🔲 | — |
| 工具保存层 | `tool-executor.ts` 等 | 🔲 | — |

> 明日接续点：`createAgentGraph({...})` 各端口的**被调实现**追根溯源——`AgentModelCallRecorder.step`（模型调用审计）、`ToolExecutor.execute`（L0 只读工具三阶段）、`AgentArtifactStore.publish`（已读）等。这是 runner 内部最深的一层，面试素材密度最高。

---

## 第三遍 · 今日小结（2026-10-27/28：runner `initialize` 端口 + 知识检索链路逐行追读）

**读的范围**：`agent-graph.runner.ts` 的 `initialize` 端口（`:183-226`）全部逐行追读完，并深入 5 个下游文件：`agent-knowledge.service.ts:collect` / `agent-source.store.ts:capture` / `agent-section-context.ts:prepareSectionContext` / `agent-artifact-revision.ts:loadAgentRevision`（第2次）/ `1790035200000-CreateAgentRunSources`（迁移）。

### initialize 端口五版本差异速查

```
agent-graph.runner.ts:185 initialize 端口
├─ 通用前置：load(true) + authorization()
│
├─ agent-section-v1 分支:188
│   ├─ loadAgentRevision(manager, current, scope)         ← 加载基准稿
│   ├─ knowledge.collect(userId, runId, goal, docIds)     ← RAG+搜索检索新来源
│   ├─ prepareSectionContext(manager, current, scope, candidates, base)
│   │   └─ 继承旧引用标签（S1..Sn）+ 新来源续号（Sn+1...）+ 构造 JSON 消息
│   └─ return { messages, citations, versions }
│
└─ 其他版本分支:204（task-v1 / task-v2 / revise-v1 / read-v1）
    ├─ SQL 查触发消息前最近 20 条历史（复合键游标分页）
    ├─ knowledge.prepare(userId, runId, { system, currentUser, history, limits, knowledge })
    ├─ revise-v1 额外:218  loadAgentRevision → revisionMaterial → push 到 messages
    └─ return { citations: prepared.sources, messages: prepared.messages, versions }
```

| workflowVersion | 历史消息 | 知识检索 | 基准稿处理 | 消息格式 |
|---|---|---|---|---|
| agent-read-v1 | ✅ 最近 20 条 | `knowledge.prepare` | 无 | 标准对话流 |
| agent-task-v1 | ✅ 最近 20 条 | `knowledge.prepare` | 无 | 标准对话流 |
| agent-task-v2 | ✅ 最近 20 条 | `knowledge.prepare` | 无 | 标准对话流 + evidence 审查 |
| agent-revise-v1 | ❌ 空（避免旧标签冲突） | `knowledge.prepare` | `revisionMaterial` 去除旧引用后作为 user 消息追加 | 标准对话流 + 基准稿数据消息 |
| agent-section-v1 | ❌ 无 | `knowledge.collect` | `prepareSectionContext` 继承旧引用标签 + 按 range 提取选中片段 | **专用 JSON**：`{ baseTitle, baseContent, range, selectedText, sources }` |

### collect 方法完整链路

```
agent-knowledge.service.ts:96 collect()
RAG(topK=8) + 搜索(topK=12)
    ↓ Promise.allSettled（单路失败降级，两路都失败才抛错）
合并去重（Map<docId, Candidate>，RAG 优先）
    ↓
按 score 降序取前 maxSources（默认 8）
    ↓
归属复核：SELECT ... FROM documents WHERE "userId"=$1 AND "deletedAt" IS NULL AND id=ANY($2::uuid[])
    ↓
Unicode code point 切片（[...excerpt].slice(0, 6000)）
    ↓
AgentSourceStore.capture(userId, runId, sources) 持久化
```

- **双路降级**：`Promise.allSettled` 任一路失败不阻塞另一路；只有两路都失败才抛 `AGENT_KNOWLEDGE_UNAVAILABLE`
- **归属复核必须**：向量索引/搜索引擎返回的结果可能已过期（文档被删或转移归属），必须回查 `documents` 表确认
- **`::uuid[]` 类型标注**：`id = ANY($2::uuid[])` 中 `::uuid[]` 不可省——PostgreSQL 需要显式类型对齐，否则 `uuid = ANY(text[])` 报错

### capture 方法关键设计

```
agent-source.store.ts:65 capture()
validateSources（结构守卫）
    ↓
事务 + FOR UPDATE 锁 Run 行（仅 RUNNING 可写）
    ↓
循环 source:
  INSERT ... ON CONFLICT DO NOTHING（sourceKey 唯一约束）
    ↓
  SELECT 读回完整行（含 DB 生成的 id）
```

- **`sourceKey` 去重公式**：`doc:{docId}@{documentUpdatedAt.toISOString()}:{sha256(title+excerpt+kind)}`
  - 同一文档 + 同一版本时间 + 同一内容摘要 → 重复 → `DO NOTHING`
  - 文档更新后 `updatedAt` 变化 → 新 `sourceKey` → 新快照
- **`orIgnore()` 而非 `orUpdate()`**：这里是"捕获"不是"覆盖"——重复就跳过，不改 `updatedAt`，保护审计时间线
- **Repository QueryBuilder 冗余 `.into()` 已删**：从 `Repository` 创建 QueryBuilder 时 `.into()` 是可选的（Repository 已绑定实体），显式写属于重复声明

### prepareSectionContext 三步流程

```
agent-section-context.ts:18 prepareSectionContext()
1. 加载基准稿（runner 层已校验时通过可选 base 参数复用，避免二次查询）
2. 查历史引用：
   agent_artifact_sources JOIN agent_run_sources
   WHERE versionId=base.id ORDER BY label
   → 保留原标签 S1..Sn
3. 复制旧引用为 retrievalKind='revision'（orIgnore 幂等）
4. 新来源从 max(Sn)+1 续号（上限 20）
5. 统一 UPDATE citationLabel + usedInContext=true
6. 构造 JSON 消息包：{ baseTitle, baseContent, range, selectedText, sources }
```

**为什么仅限 `agent-section-v1`**：章节模式有三大专属需求——① 继承旧引用标签（基准稿里已有 `[S1][S2]`，新来源必须续号防冲突）② 按 `revisionRange` 提取选中片段（模型需要知道替换范围对应的实际文本）③ 专用 JSON 消息结构（非标准对话流）。其他版本（task/revise/read）共用 `knowledge.prepare` 的标准逻辑。

### 新增 TypeScript / 数据库知识点

#### `flatMap` = map + flat(1)

```typescript
nums.flatMap((n) => n > 1 ? [n] : []);  // 过滤+映射合一
```

在 `agent-knowledge.service.ts:159` 中被用作"带映射的过滤"：`!doc` 或 `!excerpt` 时返回 `[]`（被过滤），满足条件时返回 `[{...}]`（被保留并展开）。等价于 `filter + map`，但只用一次遍历。本项目候选最多 8 个，性能差异可忽略，是风格选择。

#### `Object.fromEntries` = `Object.entries` 的逆操作

```typescript
// 数组 → 对象
Object.fromEntries([['read_document', '1'], ['search', '2']]);
// { read_document: '1', search: '2' }
```

在 `agent-graph.runner.ts:200/225` 中把 `catalog.list()` 返回的工具数组转换为 `{ toolName: version }` 对象，供模型消费。

#### TypeORM `InsertQueryBuilder` 链式方法

```typescript
repository.createQueryBuilder()
  .insert()
  .values({...})      // 从 Repository 出发时 .into() 可省
  .orIgnore()         // ON CONFLICT DO NOTHING
  .execute();
```

`.orIgnore()` 的冲突依据迁移中的唯一约束：`CONSTRAINT "UQ_agent_run_sources_key" UNIQUE ("runId", "sourceKey")`。`orIgnore` 只保证不抛重复错误，**不返回刚插入的行**，所以必须再 `SELECT` 读回完整记录。

### 设计债务（沿用 + 新增）

- `validateAgentCitations` 职责过载（沿用，10-26 已记）：同时做 bindings 校验 + answer 扫描提取
- `agent-graph.runner.ts:230` model 端口里的 `loadAgentRevision`：这里又出现"用 throw 做分支"的写法，但 model 端口确实需要基准稿内容做权限复核，不是纯短路。暂时保留。

### 代码改动汇总

| 文件 | 改动 |
|---|---|
| `agent-graph.runner.ts` | `prepareSectionContext` 调用点加注释；`loadAgentRevision` 返回值复用传入 `base` 参数 |
| `agent-section-context.ts` | 全方法逐段加注释（12 处）；`base?: AgentArtifactVersion` 可选参数；`base`→`resolved` 统一命名 |
| `agent-source.store.ts` | 注释（sourceKey / validateSources / capture）；删除冗余 `.into(AgentRunSource)` |

### 更新进度表

| 层 | 文件 | 状态 | 已沉淀知识点 |
|---|---|---|---|
| 入口层 | `agent.module.ts` | ✅ 逐行 | NestJS·DI 容器、TS·import type |
| 入口层 | `agent.controller.ts` | ✅ 已完成 | 异常过滤器 / 四件套 / 路由方法 |
| 入口层 | `agent.service.ts` | ✅ 类体 + 全部公开方法逐行读完 | §1.3 全套；§三 七 ####；跨模块索引管线 |
| 编排执行层 | `agent-graph.ts` | ✅ 逐行读完 | Annotation / Ports / State / Nodes / Edges / 完整执行流程图 |
| 编排执行层 | `agent-graph.runner.ts` | ✅ 逐行读完 | `run()` 9 步 / 6 端口实现 / checkpoint 恢复 / **initialize 五版本差异** / **model 三阶段权限复核** / **tool 端口六步** / **finish 闸门** / 下游追读 15+ 文件 |
| 持久化层 | store / writer / reader | 🔲 | — |
| 工具保存层 | `tool-executor.ts` 等 | 🔲 | — |

---

## 第三遍 · 今日小结（2026-10-29：runner `model` / `tools` / `finish` 端口 + 全链路追读）

**读的范围**：`agent-graph.runner.ts` 剩余三个端口（`model:231-249`、`tools:251-298`、`finish:304-333`）全部逐行追读完，并深入 12+ 个下游文件：`agent-model-tools.ts`（`selectAgentModelTools` / `toAgentModelMessages`）、`tool-policy.ts:evaluate`、`agent-model-call.recorder.ts:step+finish`、`agent-model.client.ts:step+parseAgentModelDecision`、`tool-call.store.ts:create+transition`、`tool-attempt.writer.ts:writeToolAttempt`、`agent-event.writer.ts:appendAgentEvent`、`tool-authorization.ts:authorize`、`tool-executor.ts:execute`、`agent-tool-source.store.ts:captureReadDocument`、`agent-conversation.store.ts:appendAssistantMessage`。

### model 端口：三阶段权限复核 + 模型调用

```
agent-graph.runner.ts:231 model 端口
├─ ① load(true) 刷新 Run 状态
├─ ② status 必须为 RUNNING
├─ ③ authorization() 取最新权限策略
├─ ④ 修订/章节模式复核基准稿（loadAgentRevision，丢弃返回值）
├─ ⑤ 复核当前上下文来源权限（inspectToolResources，当前 usedInContext 的 docId）
├─ ⑥ 复核历史工具调用的资源权限（agent_tool_calls SUCCEEDED → inspectToolResources）
└─ ⑦ AgentModelCallRecorder.step（审计预占 → 事务外调用 → 审计结算）
```

### AgentModelCallRecorder.step 三阶段审计

```
阶段一（事务内）：预算预占
  ├─ FOR UPDATE 锁 Run
  ├─ SQL 聚合：runCalls / dayCalls / runTokens / dayTokens
  ├─ 四重超限检查 → AGENT_MODEL_BUDGET_EXCEEDED
  └─ INSERT agent_model_calls (status='STARTED')
阶段二（事务外）：模型调用
  ├─ ChatOpenAI.invoke(messages, { signal })
  ├─ signal.throwIfAborted() 防竞态
  └─ parseAgentModelDecision 解析 answer / tool_calls
阶段三（事务内）：审计结算
  └─ CAS UPDATE status='SUCCEEDED' WHERE status='STARTED' RETURNING id
```

### ToolExecutor.execute 三阶段执行模型

```
阶段一（事务内）：领取
  ├─ recheck（策略/参数/资源/确认复核）
  ├─ 限制校验：builtin + L0 + 只读 + timeout≤60s
  ├─ 预算检查（toolCallLimit）
  ├─ transition START（READY → EXECUTING）
  ├─ 租约领取（leaseOwner + leaseExpiresAt CAS）
  └─ 预算预留（RESERVED）
阶段二（事务外）：执行
  ├─ 心跳续租（定期 UPDATE leaseExpiresAt）
  ├─ 调用边界落库（invocationStartedAt CAS）
  ├─ 适配器 execute（Promise.race 超时）
  └─ 输出校验（大小 + Schema）
阶段三（事务内）：结算
  ├─ CAS 校验（EXECUTING + STARTED + 本 Worker + 未过期）
  ├─ 错误码裁决（取消 > 超时 > 失败）
  ├─ 重试判定（safe 策略 + 未达上限 → RETRY_SCHEDULED）
  ├─ 状态机终态转换（SUCCEEDED / FAILED / STOPPED_WITHOUT_EFFECT）
  ├─ 写结果（agent_tool_results）
  ├─ 预算结算（SETTLED / RELEASED）
  └─ 释放租约（leaseOwner = NULL）
```

### finish 端口：事务内原子收尾

```
agent-graph.runner.ts:304 finish 端口
├─ 守卫：status=RUNNING、cancelRequested=false、无未结算 tool call
├─ validateAgentCitations（引用标签与快照一致性校验）
├─ 复核引用来源权限（inspectToolResources citedIds）
├─ UPDATE agent_run_sources SET cited=true WHERE citedIds 包含
├─ AgentConversationStore.appendAssistantMessage（写入 assistant 消息）
└─ AgentRunWriter.transition COMPLETE（RUNNING → COMPLETED）
```

### 系统性设计债务：Guard-by-SideEffect

**已标记到 Issue.md #54**。全仓库多处调用 `loadAgentRevision`（2 处丢弃）、`inspectToolResources`（7/8 处丢弃），把"主流程函数"的守卫逻辑当"纯校验器"用。修复方向：职责分离，拆出 `assertXxxAccessible` 纯校验函数。

### 新增知识点

| 知识点 | 文件 | 说明 |
|---|---|---|
| `->>` JSON 文本提取 | `agent-tool-source.store.ts:33` | PostgreSQL jsonb 运算符，`->>` 返回 text（不带引号），`->` 返回 jsonb |
| `<>` 不等于 | `tool-executor.ts:101` | SQL 标准"不等于"，`b.status <> 'RELEASED'` = 排除已释放 |
| `signal.throwIfAborted()` | `agent-model.client.ts:211` | invoke 后竞态检查：响应在取消信号后到达时丢弃结果 |
| `Promise.race` 超时模式 | `tool-executor.ts:194` | 适配器 execute 与 setTimeout 竞速，超时 abort |
| 心跳租约 CAS | `tool-executor.ts:136` | 续租 UPDATE 条件：`leaseOwner=本 Worker AND status=STARTED AND 未过期` |
| `COALESCE("endedAt", clock_timestamp())` | `tool-attempt.writer.ts:40` | 对账补全时保留首次结束时间 |
| CTE 原子序列号分配 | `agent-event.writer.ts:12` | `WITH allocated AS (UPDATE ... RETURNING) INSERT ... SELECT FROM allocated` |

### 代码改动汇总

| 文件 | 改动 |
|---|---|
| `agent-graph.runner.ts` | model / tools / finish 端口注释；checkpoint 恢复注释 |
| `agent-model-tools.ts` | `selectAgentModelTools` 拆 if + 注释；`toAgentModelMessages` ReAct 完整性校验注释 |
| `tool-policy.ts` | `evaluate` 九层策略判断逐条注解 |
| `agent-model-call.recorder.ts` | `step` 三阶段注释；`finish` CAS SQL 逐段拆解 |
| `agent-model.client.ts` | `step` 五阶段注释；`parseAgentModelDecision` 分支注释 |
| `tool-call.store.ts` | `create` / `transition` 完整注释 |
| `tool-attempt.writer.ts` | `writeToolAttempt` 三分支注释 |
| `agent-event.writer.ts` | `appendAgentEvent` CTE SQL 逐段拆解 |
| `tool-authorization.ts` | `authorize` 五步流程注释 |
| `tool-executor.ts` | `execute` / `executeAttempt` 三阶段模型注释（19 步编号） |
| `agent-tool-source.store.ts` | `captureReadDocument` / `readDocumentSource` 注释 |
| `agent-conversation.store.ts` | `appendAssistantMessage` 注释 |

> 明日接续点：`tick()` 调度层 或 `AgentService` 公开 API 层；或者回头看 `AgentRunWriter` / `AgentRunStore` 等持久化层。runner 全链路已通，面试弹药已足。

---

## 七、前端层（Agent 页面与 SSE 流式通信）

> **定位**：前面六章全是后端（NestJS / LangGraph / PostgreSQL），本章补全前端视角——页面怎么挂、API 怎么调、SSE 怎么收、状态怎么管。前端层与后端层的接口契约是 `agentApi`（`packages/api/src/agent/agentApi.ts`），所有类型定义也集中在此。

### 7.1 前端项目结构（apps/web）

```
apps/web/src/
├── App.tsx                    # 路由表：/ai → AgentPage
├── pages/
│   ├── AgentPage.tsx          # Agent 工作台（三栏布局）
│   └── AiAskPage.tsx          # 第一期 RAG 问答页（独立页面）
├── services/apiClient.ts      # 导出 agentApi / aiApi / apiClient
└── styles/agent.css           # Agent 页面样式

packages/api/src/
├── client.ts                  # Axios 实例：401 自动刷新、共享刷新队列
├── agent/agentApi.ts          # Agent 前端协议（所有接口 + 类型 + SSE stream）
└── ai/aiApi.ts                # AI 问答协议（ping / ask）

packages/services/src/
└── ai/aiService.ts            # AI 业务服务薄封装（ping / ask）
```

**路由挂载**：`App.tsx:59` `<Route path="/ai" element={<AgentPage />} />`，在 `AuthRoute` 保护内，需登录访问。

### 7.2 API 层：从 Axios 到业务接口

#### ① apiClient（`packages/api/src/client.ts`）

- **Axios 实例**：`baseURL='/api'`，默认超时 10s；响应拦截器直接 `return response.data`（业务层拿到的是解包后的数据）。
- **401 自动刷新**：模块级共享刷新锁 `sharedIsRefreshing` + 等待队列 `sharedRefreshQueue`，防止并发 401 导致 refresh token 被二次消费而失败。
- **公开接口白名单**：`PUBLIC_AUTH_PATHS`，登录/注册/刷新等路径 401 时不跳转登录页。

#### ② agentApi（`packages/api/src/agent/agentApi.ts`）

| 方法 | HTTP | 说明 |
|---|---|---|
| `status()` | `GET /agent/status` | 查询能力就绪状态 |
| `threads()` | `GET /agent/threads` | 最近 100 个会话 |
| `createThread(title)` | `POST /agent/threads` | 创建会话 |
| `thread(id)` | `GET /agent/threads/${id}` | 读取会话消息与运行历史 |
| `submit(threadId, input)` | `POST /agent/threads/${threadId}/messages` | 幂等提交用户消息并触发 Run |
| `run(id)` | `GET /agent/runs/${id}` | 读取 Run 完整快照 |
| `save(threadId, input)` | `POST /agent/threads/${threadId}/saves` | 准备保存固定版本 |
| `decide(runId, id, callId, accept)` | `POST /agent/runs/${runId}/confirmations/${id}` | 批准/拒绝保存确认 |
| `cancel(id)` | `POST /agent/runs/${id}/cancel` | 请求取消 Run |
| `resume(id)` | `POST /agent/runs/${id}/resume` | 恢复暂停的 Run |
| `events(id, after)` | `GET /agent/runs/${id}/events` | 分页读取事件（兜底补页） |
| `stream(id, after, signal, onEvent)` | `GET /agent/runs/${id}/stream` | **SSE 增量流**（见 7.3） |

**类型定义**：`AgentThreadView` / `AgentRunView` / `AgentMessageView` / `AgentArtifactView` / `AgentRunDetail` / `AgentSubmitInput` 全部集中在 `agentApi.ts` 导出，前后端共用同一套类型契约。

### 7.3 SSE 流式通信详解（`agentApi.stream`）

这是前端最核心的实时机制——不是 LLM token 级流式，而是**业务事件 SSE 增量推送**（快照 + 续传）。

#### 为什么用 SSE 而非 WebSocket？

- SSE 是**单向**服务端推，Agent 场景只需服务端→客户端推送事件，无需客户端频繁发心跳。
- 天然支持**断线续传**：通过 `Last-Event-ID`（本实现用 `after` 查询参数）恢复，无需自己维护复杂重连状态机。
- 复用 HTTP 鉴权（Bearer token），无需 WebSocket 的独立握手鉴权。

#### 前端实现（`agentApi.ts:100-125`）

```typescript
async stream(id: string, after: number, signal: AbortSignal, onEvent: (sequence: number) => void): Promise<void> {
  let consumed = 0;   // 已解析字节位置
  let last = after;   // 上次确认的事件序号
  let lastRefresh = 0;

  // 增量解析：从上次消费位置继续切分，处理"粘包"
  const consume = (text: string) => {
    let end: number;
    while ((end = text.indexOf('\n\n', consumed)) >= 0) {
      const frame = text.slice(consumed, end);
      consumed = end + 2;
      // heartbeat：每 5s 触发一次回调，让前端有机会刷新快照
      if (/^event:\s*heartbeat\s*$/m.test(frame) && Date.now() - lastRefresh > 5000) {
        lastRefresh = Date.now(); onEvent(last);
      }
      // agent 事件：解析 id 字段得到 sequence，只处理比 last 大的（幂等保护）
      const match = /^id:\s*(\d+)\s*$/m.exec(frame);
      if (match && /^event:\s*agent\s*$/m.test(frame)) {
        const sequence = Number(match[1]);
        if (Number.isSafeInteger(sequence) && sequence > last) {
          last = sequence; onEvent(sequence);
        }
      }
    }
  };

  // XHR 适配器：利用 onDownloadProgress 读取已收到的 responseText
  const result = await apiClient.get<string, string>(`/agent/runs/${id}/stream`, {
    params: { after },
    responseType: 'text',
    timeout: 70000,      // 70s 长连接，匹配心跳周期
    signal,              // AbortController，页面切换/取消时终止
    adapter: 'xhr',      // 必须用 XHR（fetch 的 ReadableStream 在部分浏览器不支持 onprogress）
    onDownloadProgress: (progress) => {
      const xhr = progress.event?.target as { responseText?: string } | undefined;
      if (typeof xhr?.responseText === 'string') consume(xhr.responseText);
    },
  });
  if (typeof result === 'string') consume(result);
}
```

**关键设计点**：
1. **`adapter: 'xhr'`**：fetch 的 ReadableStream 在部分环境不支持细粒度下载进度，XHR 的 `responseText` 可以读到当前已接收的全部文本，实现增量解析。
2. **粘包处理**：SSE 帧以 `\n\n` 分隔，但 XHR `onDownloadProgress` 触发时可能收到不完整帧，所以用 `consumed` 游标记录已解析位置，下次触发时从该位置继续。
3. **`sequence > last` 幂等保护**：同一条事件可能因断线重连重复推送，前端用序号去重。
4. **heartbeat 兜底**：心跳事件每 5s 触发一次 `onEvent(last)`，让前端有机会拉最新快照（即使没新事件）。

#### AgentPage 中的订阅循环（`AgentPage.tsx:79-111`）

```typescript
useEffect(() => {
  // ...
  let after = 0;
  let done = false;

  const load = async () => {
    // 拉取最新快照：thread 消息 + run 详情
    const [thread, run] = await Promise.all([
      agentApi.thread(threadId),
      runId ? agentApi.run(runId) : Promise.resolve(null)
    ]);
    setMessages(thread.messages); setRuns(thread.runs); setDetail(run);
    done = !!run && terminal(run.run.status);
  };

  const subscribe = async () => {
    await load();                    // 先拉一次完整快照
    if (!runId || stopped || done) return;
    try {
      await agentApi.stream(runId, after, abort.signal, (sequence) => {
        after = sequence;            // 记录已消费序号，断线后从此续传
        void load();                 // 每个事件触发一次快照刷新
      });
    } catch { /* 断线不抛错，由定时器重连 */ }
    // 断线后 2s 重订阅，复用 after 序号
    if (!stopped && !done) timer = setTimeout(() => { void subscribe(); }, 2000);
  };
  void subscribe();
  // ...
}, [threadId, runId, status?.ready]);
```

**数据流**：`subscribe()` → `load()` 拉快照 → `stream()` 等事件 → `onEvent` 回调 → `load()` 再拉快照 → 断线 → 2s 后 `subscribe()` 复用 `after` 重连。Run 终态后 `done=true`，不再重连。

### 7.4 AgentPage 状态管理与数据流

#### 状态一览

```typescript
const [status, setStatus] = useState<{ ready: boolean; modelConfigured: boolean } | null>(null);
const [threads, setThreads] = useState<AgentThreadView[]>([]);      // 左栏：会话列表
const [messages, setMessages] = useState<AgentMessageView[]>([]);   // 中栏：消息流
const [runs, setRuns] = useState<AgentRunView[]>([]);               // 中栏：运行历史
const [detail, setDetail] = useState<AgentRunDetail | null>(null);  // 右栏：Run 详情
const [mode, setMode] = useState<'dialogue' | 'task'>('dialogue');  // 对话/任务模式
const [text, setText] = useState('');                               // 输入框
const [busy, setBusy] = useState(false);                            // 操作锁
const [folders, setFolders] = useState<...>([]);                    // 文件夹树（保存用）
const [folderId, setFolderId] = useState('');                       // 选中文件夹
const [selection, setSelection] = useState<... | null>(null);       // 文本选区（局部修订）
```

#### 三栏布局

- **左栏**：会话历史（`threads`），点击切换 `threadId`。
- **中栏**：模式切换 + 消息流（`messages`）+ 输入框。消息只展示 `content.map(b => b.text).join('\n')`（首版仅文本块）。
- **右栏**：Run 详情（`detail`）= 状态 + 成果 + 保存预览 + 确认 + 来源 + 模型用量。

#### 通用操作包装 `act()`（`AgentPage.tsx:115-121`）

```typescript
const act = async (action: () => Promise<void>) => {
  if (busy) return;
  setBusy(true); setError('');
  try { await action(); await refresh.current(); }
  catch (reason) { setError(getApiErrorMessage(reason, '操作失败，请重试')); }
  finally { setBusy(false); }
};
```

所有会改变服务端事实的操作（提交/保存/重试/取消/确认）都走 `act`，用 `busy` 锁串行化，结束后统一 `refresh()` 拉最新快照。

#### 幂等请求键 `keyFor()`（`AgentPage.tsx:125-129`）

```typescript
const keyFor = (value: unknown) => {
  const signature = JSON.stringify(value);
  if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
  return request.current.key;
};
```

- **网络重试复用同一键**：参数未变时复用 `requestKey`，服务端按同键重放（`AGENT_REQUEST_KEY_CONFLICT` 幂等），不新建 Run。
- **参数变了换新键**：用户改了文本/模式/修订目标，JSON 签名变化，`crypto.randomUUID()` 生成新键，避免"改内容"被当成"重试"。

### 7.5 引用标签渲染（`citedText`）

```typescript
function citedText(text: string, detail: AgentRunDetail | null): React.ReactNode {
  return text.split(/(\[S[1-9]\d*\])/g).map((part, index) => {
    const source = detail?.sources.find((item) => part === `[${item.citationLabel}]`);
    return source ? <Link key={index} to={`/documents/${source.docId}`}>{part}</Link> : part;
  });
}
```

- **正则切分**：`(\[S[1-9]\d*\])` 捕获组让标签本身也成为独立片段。
- **只对本 Run 的来源建链**：服务端已在 `finish` 闸门校验标签与来源一一对应，前端只渲染已校验的映射，未命中退化为纯文本（不产死链）。
- **不用 `dangerouslySetInnerHTML`**：模型产出的正文是不可信数据，只按文本处理，HTML 不会被执行。

### 7.6 保存流程的两阶段确认（前端视角）

后端 `agent-save.service.ts` 把保存拆为 `prepare` + `execute`，前端对应如下交互：

1. **准备保存**：用户点击"准备保存此版本" → `agentApi.save()` → 后端创建新的 Run 走 `prepare` 路径 → 前端跳转到该 Run 查看保存预览。
2. **用户确认**：右栏展示 `detail.confirmations` 中 `status === 'PENDING'` 的确认卡片，含截止时间和确认/拒绝按钮。
3. **批准/拒绝**：点击调用 `agentApi.decide(runId, confirmation.id, confirmation.callId, true/false)` → 后端 `execute()` 原子提交或拒绝。

### 7.7 与后端的接口契约对照

| 前端看到的 | 后端对应 |
|---|---|
| `AgentRunView.status` | `agent_runs.status`（状态机） |
| `AgentRunView.executionPaused` | `agent_runs.executionPaused`（错误暂停） |
| `AgentRunView.cancelRequested` | `agent_runs.cancelRequested`（取消意图） |
| `AgentMessageView.content` | `agent_message.content`（`AgentContentBlock[]`，首版仅 `text`） |
| `AgentArtifactView.evidence` | `agent_evidence` 表（结构化证据检查） |
| `AgentRunDetail.sources` | `agent_run_source` 表（Run 来源快照） |
| `AgentRunDetail.confirmations` | `agent_tool_call` + `agent_tool_attempt`（确认绑定） |
| `AgentRunDetail.saves` | `agent_document_save` 表（保存预览） |
| `AgentRunDetail.modelCalls` | `agent_model_call` 表（模型审计） |

### 7.8 前端面试话术要点

- **SSE 不是 LLM token 流**：是"业务事件流式推送"——Run 状态变化、新消息、新成果等以 SSE 事件推送给前端，前端收到事件后拉完整快照刷新 UI。
- **断线续传**：`after` 序号 + 2s 自动重连，保证不丢事件；`sequence > last` 幂等去重。
- **前端不轮询业务接口**：除 SSE 断线重连外，不主动轮询 `agentApi.run()`，全靠事件驱动刷新。
- **两阶段保存的人工干预**：`prepare` 展示预览 → 用户 `decide` → `execute` 原子落库，体现"人工确认干预"的产品 sense。
- **引用安全**：模型产出的 `[S1]` 标签不直接渲染为链接，必须通过服务端校验的来源映射才生成 `<Link>`，防止指向未授权文档。
