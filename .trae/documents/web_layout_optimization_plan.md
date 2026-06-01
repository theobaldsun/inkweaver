# Web项目布局优化计划

## 需求分析

根据用户提供的截图和需求描述，需要进行以下两项优化：

### 1. 红色区域（Header）水平对齐
- 当前Header包含三部分：左侧Logo、中间搜索框、右侧按钮组
- 需要确保三者在垂直方向上居中对齐
- 搜索框需要占据合适的中间空间

### 2. 侧边栏和导航栏固定
- 当前侧边栏设置了 `overflow-y: auto`，会导致侧边栏自身滚动
- 需要将侧边栏和导航栏固定定位
- 只有主体内容区域（main-area）在内容过多时滚动

## 现有布局问题

当前布局结构（`index.css`）：
```css
.app-container {
  display: flex;
  min-height: 100vh;
}

.main-content-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100vh;
}

.main-area {
  flex: 1;
  overflow-y: auto;
}
```

当前侧边栏样式（`main.css`）：
```css
.sidebar {
  width: var(--sidebar-width);
  background: var(--color-bg-primary);
  border-right: 1px solid var(--color-border-primary);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100vh;
  overflow-y: auto;  /* 问题所在：侧边栏自身会滚动 */
}
```

## 优化方案

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/styles/main.css` | 修改.sidebar样式，移除overflow-y: auto |
| `src/styles/main.css` | 修改.header样式，确保垂直居中对齐 |
| `src/index.css` | 调整.app-container和.main-content-wrapper布局 |

### CSS修改详情

#### 1. 侧边栏固定
移除 `.sidebar` 的 `overflow-y: auto`，改为固定高度：

```css
.sidebar {
  width: var(--sidebar-width);
  background: var(--color-bg-primary);
  border-right: 1px solid var(--color-border-primary);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100vh;
  position: sticky;  /* 新增：固定定位 */
  top: 0;           /* 新增 */
}
```

#### 2. Header对齐优化
确保Header内三个区域垂直居中对齐：

```css
.header {
  height: var(--header-height);
  display: flex;
  align-items: center;    /* 确保垂直居中 */
  justify-content: space-between;
  padding: 0 var(--spacing-xl);
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border-primary);
  position: sticky;
  top: 0;
  z-index: 100;
}
```

#### 3. 主内容区域布局调整
确保主体区域正确滚动：

```css
.app-container {
  display: flex;
  height: 100vh;      /* 修改：固定高度 */
  overflow: hidden;    /* 新增：隐藏溢出 */
}

.main-content-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100vh;      /* 修改：固定高度 */
  overflow: hidden;    /* 新增 */
}

.main-area {
  flex: 1;
  overflow-y: auto;    /* 主体区域滚动 */
}
```

## 实施步骤

1. 修改 `src/index.css` 中的布局样式
2. 修改 `src/styles/main.css` 中的侧边栏样式
3. 验证修改效果

## 风险评估

- 低风险：仅修改CSS样式，不涉及逻辑代码
- 需要验证侧边栏内容过多时的处理方式（内部滚动区域仍可用）
