> 笔记 #6：React Hooks 闭包陷阱与异步并发控制。本笔记关联项目代码 `apps/web/src/` 下搜索组件（请求序号）、auth 模块（共享刷新锁）、settings 页面（useRef 桥接）。

## 笔记 #6：React Hooks 闭包陷阱与异步并发控制

**日期**：2026-08-17
**触发场景**：修复前端一系列并发与状态管理问题（搜索竞态、Token 刷新竞态、闭包旧值等）过程中，深入理解 `useState` 在异步回调中值不可靠的根因，以及请求序号、共享刷新锁等并发控制模式的设计哲学。

---

### 一、React 闭包陷阱：Stale Closure 根因

#### 1.1 问题现象

```tsx
const [settings, setSettings] = useState<UserSettings>(initialValue);

const handleFastClick = async () => {
  console.log('Read settings at click time:', settings); // 快照值
  setSettings({ ...settings, darkMode: true }); // 乐观更新
  await api.update({ darkMode: true });
  console.log('Settings after API call:', settings); // ⚠️ 仍然是旧值！
};
```

用户在第一次 `await` 完成前再次触发点击，第二次调用看到的 `settings` 可能是第一次调用之前的值。回滚时使用闭包 `settings` 而非 ref 快照，会覆盖掉期间已成功的另一次保存。

#### 1.2 根因：函数是对象，闭包是"焊死的指针"

在 JavaScript 中，**函数不仅是代码，更是一个带状态的对象**：

| 概念 | 说明 |
|------|------|
| **词法环境（Lexical Environment）** | 函数被创建时所在的作用域，包含所有变量的绑定（指针） |
| **闭包（Closure）** | 函数对象内部保存的、指向其创建时刻词法环境的引用 |
| **变量绑定（Binding）** | 变量在内存中的唯一地址，绑定本身不可变，但值可变 |

函数创建时，它将词法环境中每个变量的**内存地址**"焊"在了自己的内部。这个绑定是**不可变**的——函数不会因为外部环境变化而去更新自己的指针。

#### 1.3 渲染时序详解

```
T1 (Render 1):
  count_1  → 内存地址 0x001, 值=0
  handleClick_v1 → 保存: count 指针 → 0x001
  用户点击 → 调用 handleClick_v1 → 输出 count@0x001 = 0 → 进入 await

T2 (Render 2, await 尚未结束):
  count_2  → 内存地址 0x002, 值=1  (新变量！)
  handleClick_v2 → 保存: count 指针 → 0x002
  handleClick_v1 因为在 await 中，JS 引擎让它暂时存活（GC 延迟）

T3 (await 返回):
  handleClick_v1 恢复执行
  它根据自己保存的指针 0x001 查找变量
  → 访问的是 count_1 = 0（而非 count_2 = 1）
```

**关键结论**：`await` 就像一个"时空裂缝"，将函数的执行上下文冻结在了过去。当它重新苏醒时，外面的世界（组件状态）已经变了，但它手中握有的依然是旧世界的内存地址。

#### 1.4 解决方案：useRef 作为跨渲染共享信箱

`useRef.current` 的值：
- 不受 React 重渲染影响
- 所有版本的函数（handleClick_v1, v2, v3...）都指向同一个 ref 对象
- 通过 `ref.current = newValue` 可以跨越渲染周期传递最新值

```tsx
const settingsSnapshotRef = useRef<UserSettings>(initialValue);

const saveSettings = async (partial) => {
  const snapshot = settingsSnapshotRef.current; // 总是能拿到最新值
  // ... API 失败时回滚
  setSettings(snapshot); // ✅ 回滚到保存前的真实状态
};
```

---

### 二、请求序号机制：并发结果错序的终极解法

#### 2.1 问题：搜索请求错序

用户输入 "hel" → 输入 "hello"：

| 请求 | 关键词 | 发出时间 | 网络延迟 | 返回时间 |
|------|--------|----------|----------|----------|
| A | "hel" | T1 | 500ms | T3（慢） |
| B | "hello" | T2 | 100ms | T2+100ms（快） |

B 先返回 → 结果正确。A 后返回 → **用旧结果覆盖了新结果** ❌

#### 2.2 为什么不用防抖（Debounce）

防抖只能**减少请求数量**，不能**消除结果错序**：

| 方案 | 减少请求 | 保证结果顺序 |
|------|----------|-------------|
| 防抖（Debounce） | ✅ | ❌ 慢请求依然会覆盖快请求的结果 |
| 请求序号（Request ID） | ❌ | ✅ 旧请求结果直接丢弃 |
| 防抖 + 请求序号 | ✅ | ✅ 工业级最佳组合 |

#### 2.3 请求序号的实现原理

```tsx
const searchRequestIdRef = useRef(0);

const handleSearch = async (searchQuery) => {
  const requestId = ++searchRequestIdRef.current; // 自增序号
  try {
    const response = await api.search(searchQuery);
    // 核心检查：只有最新请求（序号最大）才能更新状态
    if (requestId === searchRequestIdRef.current) {
      setResults(response.documents);
    }
  } catch (error) {
    // 同样的检查逻辑
    if (requestId === searchRequestIdRef.current) {
      setSearchError(error.message);
    }
  } finally {
    if (requestId === searchRequestIdRef.current) {
      setSearching(false);
    }
  }
};
```

**为什么比 AbortController 更简单**：
- 不需要服务端支持请求取消
- 不需要处理中断异常的特殊逻辑
- 只需要一个 ref 自增整数

#### 2.4 URL 变化 ≠ 页面刷新

在 React Router（SPA）中，URL 变化不会触发 HTML 重载：
- React Router 拦截 `popstate`/`pushState` 事件
- 只更新路由状态（`useSearchParams`）
- 触发使用该状态的组件 `useEffect`
- 旧的 `await` 请求依然在后台运行

---

### 三、共享刷新锁：多实例 Token 竞态解决方案

#### 3.1 问题场景

现代前端应用中，同时存在以下情况：
- 多浏览器标签页
- 微前端架构（多个子应用共享 localStorage）
- 多 axios 实例（默认 `apiClient` + 特殊场景 `rawClient`）

当 JWT Token 过期时，多个实例可能**同时**收到 401 错误并触发刷新。

#### 3.2 Refresh Token Rotation 的陷阱

现代安全实践中，用 `refresh_token` 换取新 Token 时，后端通常会：
1. 签发新的 `access_token` 和 `refresh_token`
2. **立即作废旧的 `refresh_token`**

这意味着如果两个并发刷新请求（R1, R2）同时发出：
- R1 成功 → 旧 `refresh_token` 被作废
- R2 紧接着用旧 `refresh_token` 刷新 → **失败** ❌
- 部分用户被强制登出

#### 3.3 共享刷新锁设计

```
模块级变量（所有实例共享）:
├── sharedIsRefreshing: boolean     ← 互斥锁
└── sharedRefreshQueue: Array       ← 等待队列
```

**执行流程**：
1. 第一个 401 请求 → 设 `sharedIsRefreshing = true` → 发起唯一的刷新请求
2. 后续 401 请求 → 检测到锁已占用 → 加入 `sharedRefreshQueue` 等待
3. 刷新成功 → `processRefreshQueue(token)` → 所有等待请求获得新 Token 并重试
4. 刷新失败 → `processRefreshQueue(error)` → 所有等待请求收到统一错误

#### 3.4 为什么不直接强制登出

| 维度 | 强制登出 | 静默刷新 + 请求排队 |
|------|----------|---------------------|
| 用户体验 | 工作成果丢失（文档、表单） | 完全无感知 |
| 多标签页安全 | 一个 Tab 登出 → 全部会话失效 | 各 Tab 透明协同 |
| 生产力场景 | 灾难性（编辑器、代码工具） | 无缝对接 |
| 适用场景 | 简单只读应用 | 复杂交互型应用 |

---

### 四、递归 vs 迭代：算法选择取决于场景

#### 4.1 `deleteFolder` 用 BFS 迭代的原因

| 维度 | 说明 |
|------|------|
| **核心需求** | 检测循环引用（A→B→A） |
| **深度限制** | 500 层上限，超限零操作 |
| **执行策略** | 两阶段：收集（纯读）→ 执行（纯写） |
| **栈溢出风险** | BFS 只用一个栈帧，DFS/递归每层占一帧 |
| **原子性** | 收集阶段超限直接拒绝，数据库零影响 |

#### 4.2 `updateFolder` 用 DFS 递归的原因

| 维度 | 说明 |
|------|------|
| **核心需求** | 快速定位目标节点，修改后立即停止 |
| **数据规模** | 文档文件夹通常 < 1000 节点，无栈溢出风险 |
| **树结构** | 有向无环图（DAG），不存在循环引用风险 |
| **代码可读性** | 递归实现比 BFS 队列逻辑更简洁 |
| **尽早退出** | 找到目标后立即 return，不遍历剩余节点 |

**算法选择原则**：
- 需要**检测环路** → BFS + `visited` Set
- 需要**快速定位** → DFS（递归）尽早退出
- 数据量**极大**（>5000 层）→ 必须用迭代，避免栈溢出
- 需要**原子操作** → 两阶段设计（收集 → 执行）

---

### 教训

1. **`await` 会冻结函数的时间**：异步回调中永远不要信任闭包中的 state 值，使用 `useRef` 架设跨渲染的信息桥梁
2. **请求序号比 AbortController 更通用**：不需要服务端支持取消，简单的自增整数即可解决并发结果错序
3. **Token 刷新必须串行化**：多实例环境下，必须用模块级变量充当互斥锁和等待队列
4. **算法选择看场景**：递归简洁但有栈溢出风险；迭代安全但代码复杂。根据数据规模和需求（是否要检测环、是否要预检查上限）做出选择

---
