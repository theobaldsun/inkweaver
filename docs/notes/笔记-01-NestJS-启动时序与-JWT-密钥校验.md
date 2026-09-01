> 笔记 #1：NestJS 启动时序与 JWT 密钥校验。本笔记关联项目代码 `apps/server/src/main.ts`、`apps/server/src/app.module.ts`、`apps/server/src/modules/users/users.module.ts`、`apps/server/src/modules/auth/auth.module.ts`。

## 笔记 #1：NestJS 启动时序与 JWT 密钥校验

**日期**：2026-08-11
**触发场景**：修复 SRV-P1-05（JWT secret 回退硬编码值）时，发现 `assertStrongSecretsInProduction` 在 `JwtModule.register` 之后才执行，存在时序漏洞。

---

### 一、启动时序总览

```
Node.js 加载 main.ts
  │
  ├─ bootstrap() 被调用                              [main.ts:28]
  │     │
  │     ├─ await NestFactory.create(AppModule)       [main.ts:30]
  │     │     │
  │     │     │  ┌─ 阶段 1：模块初始化（同步阻塞）
  │     │     │  │
  │     │     │  │  NestJS 内部递归处理 AppModule.imports：
  │     │     │  │
  │     │     │  │  ┌─ ConfigModule.forRoot()          [app.module.ts:34]
  │     │     │  │  │   加载 .env，注册 ConfigService
  │     │     │  │  │
  │     │     │  │  ├─ BullModule.forRootAsync()       [app.module.ts:39]
  │     │     │  │  │   通过 ConfigService 解析 Redis 配置
  │     │     │  │  │
  │     │     │  │  ├─ TypeOrmModule.forRootAsync()    [app.module.ts:47]
  │     │     │  │  │   通过 ConfigService 解析数据库配置
  │     │     │  │  │
  │     │     │  │  ├─ UsersModule                    [app.module.ts:52]
  │     │     │  │  │   内部 import JwtModule.register()
  │     │     │  │  │   → getJwtModuleOptions() 立即执行
  │     │     │  │  │     [users.module.ts:48]
  │     │     │  │  │
  │     │     │  │  ├─ AuthModule                     [app.module.ts:52]
  │     │     │  │  │   内部 import JwtModule.registerAsync()
  │     │     │  │  │   → getJwtModuleOptions() DI 解析时执行
  │     │     │  │  │     [auth.module.ts:28-31]
  │     │     │  │  │
  │     │     │  │  ├─ DocumentsModule → JwtModule.register()
  │     │     │  │  ├─ AiModule → JwtModule.register()
  │     │     │  │  ├─ StorageModule → JwtModule.register()
  │     │     │  │  ├─ SearchModule
  │     │     │  │  ├─ NotificationsModule
  │     │     │  │  ├─ MailModule
  │     │     │  │  └─ SyncModule → JwtModule.register()
  │     │     │  │
  │     │     │  │  所有 providers 注册、DI 容器解析完成
  │     │     │  │  触发 OnModuleInit → OnApplicationBootstrap 钩子
  │     │     │  │
  │     │     │  └─ NestFactory.create() resolve
  │     │     │
  │     ├─ 阶段 2：全局增强注册（await 返回后）
  │     │     ├─ app.useGlobalFilters(...)            [main.ts:44]
  │     │     ├─ app.useGlobalPipes(...)              [main.ts:92]
  │     │     ├─ assertStrongSecretsInProduction()    [main.ts:101]
  │     │     ├─ app.listen(port)                     [main.ts:103]
  │     │     └─ logger.info("server started")
  │     │
  │     └─ bootstrap() 返回
```

**核心要点**：`NestFactory.create()` 是同步阻塞的——它 resolve 之前，`main.ts` 后续代码一行都不会执行。任何在模块初始化阶段的 `throw` 都会导致 bootstrap 失败。

---

### 二、模块注册方式详解

#### 三种 import 形式

| 形式 | 用途 | 执行时机 | 本项目示例 |
|------|------|---------|-----------|
| `forRoot()` / `forRootAsync()` | 全局配置，全应用只初始化一次 | 装饰器求值时 | `ConfigModule.forRoot()`、`BullModule.forRootAsync()`、`TypeOrmModule.forRootAsync()` |
| `register()` / `registerAsync()` | 局部配置，每个模块独立初始化一份 | `register`: 装饰器求值时<br>`registerAsync`: DI 解析时 | `JwtModule.register()` 在 4 个模块里各调 1 次 |
| 直接引用 Module 类 | 复用已初始化的实例，不重复创建 | 不触发初始化 | `DocumentsModule` import `AuthModule`、`HealthModule` import `ConfigModule` |

#### `register()` vs `registerAsync()` 关键区别

| | `register(options)` | `registerAsync({ useFactory, inject })` |
|---|---|---|
| **调用时机** | 装饰器求值时（极早） | DI 容器解析时（所有模块初始化之后） |
| **ConfigService 可用性** | ❌ 不可用，只能读 `process.env` | ✅ 可用，通过 `inject` 注入 |
| **本项目示例** | `users.module.ts:48`、`sync.module.ts:35` | `auth.module.ts:28-31` |

```typescript
// users.module.ts:48 — 装饰器求值时立即调用，ConfigService 不可用
JwtModule.register(getJwtModuleOptions())

// auth.module.ts:28-31 — DI 解析时才调用，ConfigService 可用
JwtModule.registerAsync({
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => getJwtModuleOptions(configService),
  inject: [ConfigService],
})
```

#### 功能模块 vs 基础设施模块

| 类型 | 示例 | 需要 forRoot/register？ | 原因 |
|------|------|------------------------|------|
| **基础设施模块** | ConfigModule、TypeOrmModule、JwtModule、BullModule | ✅ 需要 | 需要外部配置（密钥、连接串）才能工作 |
| **功能模块** | UsersModule、DocumentsModule、HealthModule | ❌ 不需要 | 自身已包含完整 controllers/providers，配置通过 DI 从其他模块获得 |

#### 直接引用的"复用"机制

当多个模块 import 同一个模块类（如 UsersModule 和 DocumentsModule 都 import AuthModule），NestJS 只初始化一次，第二次引用直接返回已创建的实例。这是 NestJS 模块单例的基础。

---

### 三、生命周期钩子 vs 请求管线

#### 生命周期钩子：管应用生死

```
1. constructor()              ← Provider 实例创建
2. onModuleInit()             ← 所有 Provider 注册完成
3. onApplicationBootstrap()   ← 应用已就绪
4. onApplicationShutdown()    ← 收到 SIGTERM/SIGINT
```

- 触发时机：应用启动/关闭时各触发一次
- 适用场景：数据库预热、连接第三方服务、注册定时任务、释放资源
- 本项目：未实现任何钩子

#### 请求管线：管每次请求流转

```
HTTP 请求到达
  │
  ├─ ① 全局中间件（app.use）          [main.ts:39-40]
  │     bodyParser.json()、/uploads 静态文件
  │
  ├─ ② 全局守卫 → 控制器守卫          本项目：AuthGuard [auth.guard.ts]
  │     全局先于控制器，返回 true 才继续
  │
  ├─ ③ 全局拦截器(before) → 控制器 → 路由  本项目未配置
  │     before 阶段：外→内
  │
  ├─ ④ 全局管道 → 控制器 → 路由       [main.ts:92-98]
  │     ValidationPipe 处理 @Body/@Param 参数
  │
  ├─ ⑤ 路由处理器执行
  │
  ├─ ⑥ 路由拦截器(after) → 控制器 → 全局
  │     after 阶段：内→外（洋葱模型）
  │
  ├─ ⑦ 全局过滤器 → 控制器 → 路由     [main.ts:44-79]
  │     内→外执行，全局过滤器是最后一道防线
  │
  └─ HTTP 响应返回
```

**两者关系**：生命周期钩子管**应用的生死**，请求管线管**请求的流转**。

---

### 四、main.ts vs app.module.ts

| | main.ts | app.module.ts |
|---|---|---|
| **角色** | 代码入口（Node.js 从这里开始执行） | 配置入口（声明应用需要哪些模块） |
| **类比** | `main()` 函数 | `application.conf` |
| **做什么** | 调用 `NestFactory.create()` → 注册全局增强 → `app.listen()` | 声明 imports、controllers、providers 的依赖关系 |
| **何时执行** | 最开始，Node.js 加载后立即执行 | 在 `NestFactory.create()` **内部**被解析 |

没有 main.ts，AppModule 不会自己启动——它只是一个带 `@Module` 装饰器的类。

---

### 五、ConfigService 深度理解

#### `app.get(ConfigService)` vs `new ConfigService()`

| | `app.get(ConfigService)` | `new ConfigService()` |
|---|---|---|
| 创建时机 | NestJS DI 容器内部创建 | 手动创建 |
| 单例 | ✅ 所有模块共享 | ❌ 每次 `new` 创建独立实例 |
| 数据来源 | 从 `ConfigModule.forRoot()` 加载的 `.env` 读取 | 从 `process.env` 直接读取 |
| 与 DI 容器关系 | 是 DI 容器的一部分 | 完全独立，不被 DI 容器识别 |

#### `assertStrongSecretsInProduction` 现在的定位

当前 `getJwtModuleOptions()` 已在密钥缺失时直接 `throw`，`assertStrongSecretsInProduction` 中 JWT_SECRET 相关的弱密钥检查已冗余。但该函数仍可用于检查其他配置（DB、Redis 等），保留做整体健康检查。

#### 为什么不把 assert 提前到 `create` 之前

理论上可以用 `ConfigModule.load()` 提前加载配置并校验，但会：
1. 让启动流程更复杂
2. 破坏 NestJS 的封装原则（绕过模块系统直接读 `process.env`）
3. 当前方案（消费点 throw）不依赖任何执行顺序，更健壮

---

### 六、Q&A 合集

**Q：`bootstrap()` 由谁调用？**
由 Node.js 执行。`main.ts:108` 的 `bootstrap().catch(...)` 是普通函数调用。NestJS 是被调用的库，不控制调用时机。

**Q：每个 Module 都会调用 `bootstrap()` 吗？**
不会。`bootstrap()` 只在 `main.ts` 里被调用一次，是应用入口。

**Q：嵌套 import 会怎样？再走一遍？**
不会。NestJS 深度优先遍历模块图，每个模块只初始化一次。如 `AppModule → DocumentsModule → AuthModule` 的顺序：AuthModule 先完成 → DocumentsModule 完成 → AppModule 继续。循环依赖用 `forwardRef(() => ...)` 打破（项目中 `DocumentsModule ↔ AiModule` 就用了）。

**Q：`registerAsync` 能让 assert 在 getJwtModuleOptions 之前执行吗？**
不能。`registerAsync` 只是把 `getJwtModuleOptions` 从装饰器求值推迟到 DI 解析，但两者都仍在 `NestFactory.create()` 内部，都在 `assertStrongSecretsInProduction` 之前。要让 assert 先执行，必须在 `NestFactory.create()` 之前校验，但这会破坏封装。

---

### 教训

1. **安全校验必须在密钥被使用之前执行**：`assertStrongSecretsInProduction` 在密钥被使用之后才检查，属于"事后检查"模式。应在密钥消费点直接阻断（当前 `getJwtModuleOptions` throw 方案）
2. **`register()` vs `registerAsync()` 的选择**：需要依赖注入时必须用 `registerAsync()`，否则只能在装饰器阶段拿到静态值
3. **`NestFactory.create()` 是同步阻塞的**：它 resolve 之前，`main.ts` 中后续代码都不会执行。任何在模块初始化阶段的 throw 都会导致 bootstrap 失败
4. **装饰器求值时机**：`@Module({...})` 里的 `imports` 数组中，静态方法（如 `forRoot()`、`register()`）会在装饰器被求值时**立即执行**
5. **功能模块不需要 forRoot/register**：它们的配置通过依赖注入从其他模块获得，不需要外部传配置
6. **单例不等于只初始化一次**：`forRoot()` 全应用只初始化一次；`register()` 每个模块独立初始化一份；直接引用复用已有实例

---
