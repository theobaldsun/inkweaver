# InkWeaver Web 设计规范文档

## 概述

本文档定义了 InkWeaver Web 应用的设计规范，确保与移动端 H5 项目保持高度一致。

---

## 1. 色彩系统

### 1.1 主色调

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-primary-50` | #eff6ff | 主色浅背景 |
| `--color-primary-100` | #dbeafe | 主色悬停 |
| `--color-primary-200` | #bfdbfe | 主色边框 |
| `--color-primary-300` | #93c5fd | 主色高亮 |
| `--color-primary-400` | #60a5fa | 主色按钮 |
| `--color-primary-500` | #3b82f6 | **主色** |
| `--color-primary-600` | #2563eb | 主色按下 |
| `--color-primary-700` | #1d4ed8 | 主色深色 |
| `--color-primary-800` | #1e40af | 主色文字 |
| `--color-primary-900` | #1e3a8a | 主色标题 |

### 1.2 辅助色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-secondary-50` | #f0fdf4 | 辅助色浅背景 |
| `--color-secondary-100` | #dcfce7 | 辅助色悬停 |
| `--color-secondary-500` | #22c55e | **辅助色** |
| `--color-secondary-600` | #16a34a | 辅助色按下 |

### 1.3 功能色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-success` | #22c55e | 成功状态 |
| `--color-warning` | #f59e0b | 警告状态 |
| `--color-error` | #ef4444 | 错误状态 |
| `--color-info` | #3b82f6 | 信息提示 |

### 1.4 中性色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-white` | #ffffff | 背景色 |
| `--color-gray-50` | #f9fafb | 页面背景 |
| `--color-gray-100` | #f3f4f6 | 卡片背景 |
| `--color-gray-200` | #e5e7eb | 边框色 |
| `--color-gray-300` | #d1d5db | 分割线 |
| `--color-gray-400` | #9ca3af | 占位文字 |
| `--color-gray-500` | #6b7280 | 辅助文字 |
| `--color-gray-600` | #4b5563 | 正文文字 |
| `--color-gray-700` | #374151 | 标题文字 |
| `--color-gray-800` | #1f2937 | 深色文字 |
| `--color-gray-900` | #111827 | 最深色文字 |

---

## 2. 字体系统

### 2.1 字体栈

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

### 2.2 字体大小

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--font-size-xs` | 12px | 辅助文字 |
| `--font-size-sm` | 14px | 正文小号 |
| `--font-size-base` | 16px | 正文 |
| `--font-size-lg` | 18px | 标题小号 |
| `--font-size-xl` | 20px | 标题中号 |
| `--font-size-2xl` | 24px | 标题大号 |
| `--font-size-3xl` | 30px | 页面标题 |
| `--font-size-4xl` | 36px | 主标题 |

### 2.3 字体粗细

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--font-weight-normal` | 400 | 正文 |
| `--font-weight-medium` | 500 | 强调文字 |
| `--font-weight-semibold` | 600 | 标题 |
| `--font-weight-bold` | 700 | 主标题 |

### 2.4 行高

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--line-height-tight` | 1.25 | 紧凑文字 |
| `--line-height-normal` | 1.5 | 正文 |
| `--line-height-relaxed` | 1.75 | 段落文字 |

---

## 3. 间距系统

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--spacing-1` | 4px | 微小间距 |
| `--spacing-2` | 8px | 小间距 |
| `--spacing-3` | 12px | 中等间距 |
| `--spacing-4` | 16px | 标准间距 |
| `--spacing-5` | 20px | 较大间距 |
| `--spacing-6` | 24px | 大间距 |
| `--spacing-8` | 32px | 超大间距 |
| `--spacing-10` | 40px | 极大间距 |

---

## 4. 圆角系统

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--radius-sm` | 4px | 小元素 |
| `--radius-md` | 8px | 按钮、输入框 |
| `--radius-lg` | 12px | 卡片 |
| `--radius-xl` | 16px | 弹窗、模态框 |
| `--radius-full` | 9999px | 圆形元素 |

---

## 5. 阴影系统

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) | 输入框、按钮 |
| `--shadow-md` | 0 4px 6px -1px rgba(0,0,0,0.1) | 卡片 |
| `--shadow-lg` | 0 10px 15px -3px rgba(0,0,0,0.1) | 弹窗 |
| `--shadow-xl` | 0 20px 25px -5px rgba(0,0,0,0.1) | 模态框 |

---

## 6. 组件设计规范

### 6.1 按钮

| 类型 | 样式 | 状态 |
|------|------|------|
| 主按钮 | 主色背景，白色文字 | 默认/悬停/按下/禁用 |
| 次按钮 | 白色背景，主色边框 | 默认/悬停/按下/禁用 |
| 文字按钮 | 透明背景，主色文字 | 默认/悬停/按下/禁用 |

### 6.2 表单

| 元素 | 样式规范 |
|------|----------|
| 输入框 | 灰色边框，聚焦时主色边框，圆角 8px |
| 选择框 | 同输入框，右侧下拉箭头 |
| 复选框 | 方形，选中时主色填充 |
| 开关 | 圆形滑块，开启时主色背景 |

### 6.3 卡片

- 背景: `--color-white` 或 `--color-gray-50`
- 圆角: `--radius-lg`
- 阴影: `--shadow-md`
- 内边距: `--spacing-5`

### 6.4 徽章

| 类型 | 样式 |
|------|------|
| 默认 | 灰色背景，灰色文字 |
| 主色 | 主色背景，白色文字 |
| 成功 | 绿色背景，白色文字 |
| 警告 | 黄色背景，深色文字 |
| 错误 | 红色背景，白色文字 |

---

## 7. 响应式设计

### 7.1 断点

| 断点 | 宽度 | 设备类型 |
|------|------|----------|
| `--breakpoint-sm` | 640px | 手机 |
| `--breakpoint-md` | 768px | 平板 |
| `--breakpoint-lg` | 1024px | 桌面 |
| `--breakpoint-xl` | 1280px | 大屏幕 |

### 7.2 布局适配

| 断点 | 侧边栏 | 内容区域 |
|------|--------|----------|
| < 768px | 折叠 | 全屏 |
| >= 768px | 展开 | 自适应 |

---

## 8. 图标规范

- 使用 Lucide React 图标库
- 统一图标尺寸: 16px / 18px / 20px / 24px / 32px
- 图标颜色使用 CSS 变量控制

---

## 9. 状态反馈

### 9.1 加载状态

- 加载中显示 spinner 动画
- 加载文案: "加载中..."

### 9.2 空状态

- 显示图标和提示文案
- 提供操作按钮引导用户

### 9.3 错误状态

- 显示错误图标和错误信息
- 提供重试按钮

---

## 10. 代码组织

### 10.1 CSS 文件结构

```
src/
├── index.css          # 全局变量和基础样式
├── styles/
│   └── main.css       # 组件样式
└── components/        # React 组件
```

### 10.2 命名规范

- CSS 类名使用 BEM 命名法
- 变量名使用 kebab-case
- 组件文件名使用 PascalCase

---

## 附录: 设计令牌对照表

| 设计令牌 | CSS 变量 | 值 |
|----------|----------|-----|
| Color.Primary | `--color-primary-500` | #3b82f6 |
| Color.Success | `--color-success` | #22c55e |
| Color.Error | `--color-error` | #ef4444 |
| Font.Size.Base | `--font-size-base` | 16px |
| Font.Weight.Normal | `--font-weight-normal` | 400 |
| Spacing.Medium | `--spacing-4` | 16px |
| Radius.Medium | `--radius-md` | 8px |
| Shadow.Card | `--shadow-md` | 0 4px 6px -1px rgba(0,0,0,0.1) |