# InkWeaver Web 设计规范

## 1. 概述

本文档定义了 SyncBox-AI Web 项目的设计规范，确保 UI 设计风格、图标系统及字体规范与移动端 H5 项目保持高度一致。

---

## 2. 色彩系统

### 2.1 主色调

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-primary-50` | #eff6ff | 主色浅背景 |
| `--color-primary-100` | #dbeafe | 主色悬停状态 |
| `--color-primary-200` | #bfdbfe | 主色边框 |
| `--color-primary-300` | #93c5fd | 主色图标 |
| `--color-primary-400` | #60a5fa | 主色高亮 |
| `--color-primary-500` | #3b82f6 | 主色按钮 |
| `--color-primary-600` | #2563eb | 主色文字 |
| `--color-primary-700` | #1d4ed8 | 主色深色 |

### 2.2 辅助色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-secondary-500` | #06b6d4 | 辅助色主色 |
| `--color-secondary-600` | #0891b2 | 辅助色深色 |

### 2.3 功能色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-success-500` | #22c55e | 成功状态 |
| `--color-warning-500` | #f59e0b | 警告状态 |
| `--color-error-500` | #ef4444 | 错误状态 |
| `--color-info-500` | #3b82f6 | 信息提示 |

### 2.4 中性色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--color-bg-primary` | #ffffff | 主背景 |
| `--color-bg-secondary` | #f8fafc | 次背景 |
| `--color-bg-tertiary` | #f1f5f9 | 三级背景 |
| `--color-text-primary` | #1e293b | 主文字 |
| `--color-text-secondary` | #64748b | 次文字 |
| `--color-text-tertiary` | #94a3b8 | 辅助文字 |
| `--color-border-primary` | #e2e8f0 | 主边框 |
| `--color-border-secondary` | #cbd5e1 | 次边框 |

---

## 3. 字体系统

### 3.1 字体大小

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--font-size-xs` | 12px | 辅助文字 |
| `--font-size-sm` | 14px | 正文小号 |
| `--font-size-md` | 16px | 正文中号 |
| `--font-size-lg` | 18px | 正文大号 |
| `--font-size-xl` | 24px | 标题小号 |
| `--font-size-2xl` | 32px | 标题中号 |
| `--font-size-3xl` | 40px | 标题大号 |

### 3.2 字重

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--font-weight-regular` | 400 | 正文常规 |
| `--font-weight-medium` | 500 | 正文强调 |
| `--font-weight-semibold` | 600 | 标题常规 |
| `--font-weight-bold` | 700 | 标题强调 |

### 3.3 行高

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--line-height-tight` | 1.25 | 紧凑 |
| `--line-height-normal` | 1.5 | 常规 |
| `--line-height-relaxed` | 1.75 | 宽松 |

### 3.4 字体栈

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

---

## 4. 间距系统

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--spacing-xs` | 4px | 超小间距 |
| `--spacing-sm` | 8px | 小间距 |
| `--spacing-md` | 16px | 中间距 |
| `--spacing-lg` | 24px | 大间距 |
| `--spacing-xl` | 32px | 超大间距 |
| `--spacing-2xl` | 48px | 特大间距 |
| `--spacing-3xl` | 64px | 极大间距 |

---

## 5. 圆角系统

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--radius-sm` | 6px | 小按钮、输入框 |
| `--radius-md` | 10px | 卡片、弹窗 |
| `--radius-lg` | 16px | 大卡片、模态框 |
| `--radius-xl` | 24px | 特殊容器 |
| `--radius-full` | 9999px | 圆形按钮 |

---

## 6. 阴影系统

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--shadow-sm` | 0 1px 2px 0 rgba(0,0,0,0.05) | 小阴影 |
| `--shadow-md` | 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06) | 中阴影 |
| `--shadow-lg` | 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05) | 大阴影 |
| `--shadow-xl` | 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04) | 超大阴影 |

---

## 7. 过渡动画

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--transition-fast` | 0.15s ease | 快速过渡 |
| `--transition-normal` | 0.25s ease | 正常过渡 |
| `--transition-slow` | 0.35s ease | 慢速过渡 |

---

## 8. 组件设计规范

### 8.1 按钮

| 类型 | 样式 |
|------|------|
| 主按钮 | 渐变背景、白色文字、圆角 md |
| 次按钮 | 白色背景、灰色边框、灰色文字 |
| 文字按钮 | 透明背景、主色文字 |
| 危险按钮 | 红色背景、白色文字 |

### 8.2 输入框

- 高度：44px
- 边框：1px solid `--color-border-primary`
- 聚焦：边框变为主色，添加发光效果
- 圆角：`--radius-md`

### 8.3 卡片

- 背景：`--color-bg-primary`
- 边框：1px solid `--color-border-primary`
- 圆角：`--radius-lg`
- 阴影：`--shadow-sm`

### 8.4 徽章

- 高度：24px
- 圆角：`--radius-full`
- 内边距：4px 12px

### 8.5 弹窗

- 背景：`--color-bg-primary`
- 圆角：`--radius-lg`
- 阴影：`--shadow-xl`
- 宽度：90%（移动端），最大 500px（桌面端）

---

## 9. 图标系统

### 9.1 图标库

使用 Lucide React 图标库：
- 版本：^0.294.0
- 导入方式：按需导入

### 9.2 图标尺寸

| 尺寸 | 用途 |
|------|------|
| 12px | 辅助图标 |
| 14px | 小号图标 |
| 16px | 常规图标 |
| 18px | 按钮图标 |
| 20px | 导航图标 |
| 24px | 大号图标 |
| 32px | 超大图标 |

---

## 10. 响应式设计

### 10.1 断点定义

| 断点 | 尺寸 | 设备 |
|------|------|------|
| sm | ≥640px | 手机 |
| md | ≥768px | 平板 |
| lg | ≥1024px | 桌面 |
| xl | ≥1280px | 大屏幕 |

### 10.2 布局适配

- 侧边栏：小屏自动折叠
- 网格：小屏单列，大屏多列
- 字体：根据屏幕尺寸缩放

---

## 11. 编辑器组件规范

### 11.1 InkWeaverEditor

**Props：**
- `content`: string - 编辑器内容（HTML）
- `onChange`: (event) => void - 内容变化回调
- `imageUploader`: (file) => Promise<string> - 图片上传器
- `title`: string - 文档标题
- `onTitleChange`: (title) => void - 标题变化回调
- `placeholder`: string - 占位符文字
- `editable`: boolean - 是否可编辑
- `minHeight`: number - 最小高度
- `maxHeight`: number - 最大高度

**功能特性：**
- 富文本编辑
- 标题层级（H1-H3）
- 粗体、斜体、下划线、删除线
- 有序/无序/任务列表
- 引用块、代码块、分隔线
- 链接插入、图片上传
- 撤销/重做
- 目录大纲自动生成

---

## 12. 设计令牌对照表

| 设计令牌 | CSS 变量 | 值 |
|----------|----------|-----|
| Primary Color | `--color-primary-500` | #3b82f6 |
| Success Color | `--color-success-500` | #22c55e |
| Warning Color | `--color-warning-500` | #f59e0b |
| Error Color | `--color-error-500` | #ef4444 |
| Background | `--color-bg-primary` | #ffffff |
| Text Primary | `--color-text-primary` | #1e293b |
| Text Secondary | `--color-text-secondary` | #64748b |
| Border | `--color-border-primary` | #e2e8f0 |
| Font Size Base | `--font-size-md` | 16px |
| Font Weight Base | `--font-weight-regular` | 400 |
| Spacing Base | `--spacing-md` | 16px |
| Radius Base | `--radius-md` | 10px |

---

## 13. 代码约定

### 13.1 CSS 类命名

采用 BEM 命名规范：
```css
.block {}
.block__element {}
.block--modifier {}
```

### 13.2 变量命名

使用 kebab-case：
```css
--color-primary-500
--font-size-md
--spacing-lg
```

### 13.3 文件结构

```
src/
├── components/       # 组件
├── pages/           # 页面
├── styles/          # 全局样式
├── services/        # 服务
└── utils/           # 工具函数
```

---

## 14. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-05-26 | 初始版本 |

---

**文档结束**