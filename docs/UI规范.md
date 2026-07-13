# InkWeaver UI 规范

本文描述可长期复用的 UI 约束。令牌具体数值和组件 Props 以源码为准，避免文档复制后与实现分叉。

## 1. 事实来源

| 范围 | 源码 |
|------|------|
| Web 全局 CSS 令牌 | [`apps/web/src/index.css`](../apps/web/src/index.css) |
| 跨端颜色、间距、阴影与圆角 | [`packages/ui/src/design-system/colors.ts`](../packages/ui/src/design-system/colors.ts) |
| 共享 UI 组件 | [`packages/ui/src/components/`](../packages/ui/src/components/) |
| Web 编辑器样式与接口 | [`packages/editor-web/src/components/`](../packages/editor-web/src/components/) |
| Web 页面样式 | [`apps/web/src/styles/`](../apps/web/src/styles/) |

`apps/web` 的 CSS 令牌与 `packages/ui` 的 TypeScript 令牌服务于不同渲染环境；新增共享语义时应同时评估两处是否需要对齐，而不是在文档中维护第三套数值。

## 2. 视觉语义

- `primary`：主要操作、当前状态和焦点。
- `secondary`：辅助强调，不替代主要操作。
- `success`、`warning`、`error`、`info`：状态反馈；不能只用颜色表达含义。
- `bg`、`text`、`border`：页面层级、可读性和组件边界。
- `spacing`、`radius`、`shadow`：优先使用现有令牌，不在组件中随意新增近似值。

Web 默认字体栈以 Inter 和系统字体为主；代码块使用等宽字体。图标使用各应用 `package.json` 已声明的 Lucide 包并按需导入。

## 3. 组件约束

- 按钮必须有明确的主要、次要、文字或危险语义，并提供 disabled/loading 状态。
- 输入控件必须包含可见标签或等效的无障碍名称、错误提示和焦点状态。
- 卡片和弹窗使用现有背景、边框、圆角与阴影令牌；弹窗须支持关闭、键盘焦点和窄屏布局。
- Toast、Alert 与通知不能只写入状态而不挂载可见 UI。
- 共享行为优先进入 `packages/ui`；仅某个页面使用且高度业务化的组件留在对应应用。

## 4. 响应式与跨端

- 布局从窄屏可用开始，再增强桌面多栏、侧边栏与工具区。
- 不用设备名称决定布局；使用内容所需空间和现有 CSS 断点。
- Web/H5 可共享 `editor-web` 和 Web 组件，但页面导航与密度可分别适配。
- Native 使用 `editor-mobile` 和 React Native 组件，不直接导入浏览器 DOM 或 Web 专属模块。
- 交互目标需适合触控；关键功能不能仅依赖 hover。

## 5. 编辑器

- 公共编辑器协议定义在 `packages/editor-core`。
- Web 入口为 `InkWeaverEditor`；其 Props 以 `packages/editor-web/src/components/InkWeaverEditor.tsx` 为准。
- 标题、正文、工具栏、目录与侧边操作应保持清晰层级；窄屏允许折叠非关键工具。
- 新增扩展时同时检查序列化、Yjs 同步、只读分享和移动端降级行为。
- 上传、链接和 HTML 展示必须考虑输入校验、权限和内容安全。

## 6. 可访问性

- 保持文字与背景对比度，焦点状态不能被移除。
- 图标按钮提供 `aria-label` 或可见文本。
- 表单错误与异步状态应被辅助技术识别。
- 模态框打开后管理焦点，关闭后恢复到触发元素。
- 动画服从 reduced-motion 偏好；不以动画作为唯一反馈。

## 7. 变更规则

- 修改令牌时先改事实来源，再验证 Web、H5、Native 和共享组件受影响范围。
- 新增组件前检查 `packages/ui` 与现有应用组件，避免重复实现。
- 只有稳定的设计约束进入本文；页面临时样式和一次性视觉实验留在代码或设计任务中。
