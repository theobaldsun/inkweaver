> 笔记 #8：PostgreSQL 数组与 jsonb 操作符语义边界。本笔记关联项目代码 `apps/server/src/modules/search/search.service.ts` 的 searchExact / searchRelated / searchFuzzy 三条 SQL 通道，记录 jsonb 与 array 两类操作符的语义边界、跨域类型转换与 `.catch(() => [])` 静默吞错根因。

## 笔记 #8：PostgreSQL 数组与 jsonb 操作符语义边界

**日期**：2026-08-31
**关联代码**：[apps/server/src/modules/search/search.service.ts](file:///d:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/search/search.service.ts) 的 `searchExact` / `searchRelated` / `searchFuzzy`

**核心问题**：TypeORM entity 将列声明为 jsonb，但 SQL 写成了数组操作符，导致运行时类型错误被 `.catch(() => [])` 静默吞掉，三路搜索通道长期返回空结果而前端无报错。

---

### 一、核心问题：跨域操作符导致静默失败

InkWeaver 的搜索服务把 `documents.tags` 列以 TypeORM `jsonb` 类型声明（实体层契约），但 SQL 层混用了 PostgreSQL 的 array 域操作符（`@>`、`&&`）与 jsonb 域操作符（`?|`）。两类操作符同名但不同域、语义不可互换：

- `tags` 实际列类型是 `jsonb`（不是 `varchar[]`），用 `&&`（array 域"有交集"操作符）会直接抛 "operator does not exist: jsonb && character varying[]"。
- 服务端在 `searchRelated` / `searchFuzzy` 通道外层套了 `.catch(() => [])` 降级，把这类 SQL 类型错误也一起吞掉，导致通道永远返回空数组，前端看到"搜索无结果"但无任何错误信息。

**关键结论**：`.catch(() => [])` 是双刃剑——它本意是"查询失败时降级为空结果"，但把 SQL 语法错误、类型错误一并吞掉，让真正的 bug 变成"功能静默失效"。必须为这类降级配对 `logger.warn`，让失败可见。

---

### 二、三操作符语义对照表

| 操作符 | 类型域 | 语义 | 集合论 | 返回类型 |
|--------|--------|------|--------|----------|
| `@>` | array | 左包含右的所有元素 | A ⊇ B | boolean |
| `@>` | jsonb | 左 JSON 结构包含右 | 结构包含 | boolean |
| `?|` | jsonb | 左存在右指定的任一 key | A ∩ B ≠ ∅ | boolean |
| `&&` | array | 左与右有任一共同元素 | A ∩ B ≠ ∅ | boolean |

关键结论：

- `?|` 和 `&&` 是**跨类型域同义**（都判断"有交集"，OR 语义）：前者用于 jsonb 的顶层 key，后者用于 array 的元素。语义相同，但类型域不同，不能互换。
- `@>` 是**独立语义**（判断"包含全部"，AND 语义），且它在 array 域与 jsonb 域同名但行为不同：array 域是元素包含，jsonb 域是结构包含（含嵌套路径）。
- 三者不能互换：把 `@>` 误当 `&&` 用会从"全部命中"变成"任一命中"，反之亦然；把 `&&`（array 域）误用在 jsonb 列上会直接抛类型错误。

**记忆口诀**：`@>` 是 AND（全包含），`?|` / `&&` 是 OR（有交集）；`?|` 走 jsonb 域，`&&` 走 array 域，`@>` 两域都有但语义不同。

---

### 三、跨域类型转换

当列是 jsonb 但右操作数是 array，必须显式跨域转换：

```sql
-- varchar[] → jsonb 数组（用于 @> 跨域匹配，保留 @> 的 AND 语义）
tags @> to_jsonb($3::varchar[])

-- tsvector → text[]（用于集合操作，先把全文检索向量拆成词元数组）
tsvector_to_array("docTsv")

-- text[] → 多行（用于 INTERSECT，把数组拆成集合）
unnest(text[])

-- 多行交集 → text[]（重新聚合为数组）
ARRAY(SELECT unnest(...) INTERSECT SELECT unnest(...))

-- text[] → int（计数，空数组返回 0，比 array_length(x,1) 返回 NULL 更安全）
cardinality(text[])
```

**坑点 1**：`array_length(arr, 1)` 对空数组返回 `NULL` 而不是 0，在 `CASE WHEN array_length(...) > 0` 这类条件里会因为 `NULL > 0` 为 `NULL`（falsy）而走错分支。应统一用 `cardinality(arr)`（空数组返回 0）。

**坑点 2**：`tsvector_to_array` 严格期望 `tsvector` 入参。`plainto_tsquery('hello world')` 返回的是 `tsquery`（带位置权重的查询对象），不是 `tsvector`，混用会抛类型错误。若需要把 tsquery 拆成词元数组，应先 `unnest(tsquery::tsvector)` 或直接用 `to_tsvector('word')` 构造。

---

### 四、项目代码关联

引用 [search.service.ts](file:///d:/Codex_Workspaces/software-development/projects/SyncBox-AI/apps/server/src/modules/search/search.service.ts) 的三段 SQL 通道：

#### 4.1 searchExact（L183, L188）

```sql
-- 现状（错误）
tags @> $3::varchar[]
```

`tags` 是 jsonb 列，`$3::varchar[]` 是 array，`@>` 跨域同名但右操作数类型决定走哪个域——右操作数是 array 时 PostgreSQL 会尝试按 array 域解析，但左操作数是 jsonb，类型不匹配直接抛错。

**修复**：把右操作数显式转成 jsonb 数组，保留 `@>` 的 AND 语义（exact 通道要求"全部命中"）：

```sql
-- 修复
tags @> to_jsonb($3::varchar[])
```

#### 4.2 searchRelated（L252）

```sql
-- 现状（错误）
tags && $5::varchar[]
```

`&&` 是 array 域操作符，jsonb 列直接抛类型错误。需要换成 jsonb 域的"有交集"操作符 `?|`。

**修复**：把不存在的 `&&` 替换为 jsonb 域同义的 `?|`（OR 语义）：

```sql
-- 修复
tags ?| $5::varchar[]
```

注意 `?|` 的右操作数期望是 `text[]`（key 名数组），这里正好与 `$5::varchar[]` 类型对齐，无需额外转换。

#### 4.3 searchFuzzy（L208-214）

```sql
-- 现状（双重错误）
tsvector_to_array(...) && tsvector_to_array(plainto_tsquery(...))
```

双重错误：

1. `plainto_tsquery(...)` 返回 `tsquery`，不是 `tsvector`，传入 `tsvector_to_array` 会抛类型错误。
2. `&&` 是 array 域操作符，且返回 `boolean`，不能用于"计算交集数量"的场景——它只能判断"是否有交集"，不能给出"有几个共同元素"。

**修复**：改为"先 unnest 拆集合 → INTERSECT 取交集 → ARRAY 重新聚合 → cardinality 计数"：

```sql
-- 修复：计算查询词与文档词元的交集数量
cardinality(
  ARRAY(
    SELECT unnest(tsvector_to_array("docTsv"))
    INTERSECT
    SELECT unnest(to_tsvector('query text'))
  )
)
```

注意把 `plainto_tsquery` 换成 `to_tsvector`（构造 tsvector），再用 `tsvector_to_array` 拆词元，避免 tsquery/tsvector 混用。

---

### 五、为什么 exact 用 @>、related 用 ?|

开发者有意区分语义，不是疏忽：

- **exact 通道**：要求 tags **全部包含** tokens（AND，精确匹配）。用户搜 "vue react" 时，只有 tags 同时含 vue 和 react 的文档才进 exact 候选。用 `@>` 保持 AND 语义。
- **related 通道**：tags **任一重叠** 即加分（OR，宽松关联）。tags 含 vue 或 react 之一的文档都可作为相关结果。用 `?|` 表达 OR 语义。

如果统一用 `?|`，exact 通道会过度召回——搜 "vue react" 时只要 tags 有 vue 或 react 之一就进 exact 候选，破坏精确匹配语义，用户搜出大量半相关结果。

如果统一用 `@>`，related 通道会过严——只有 tags 完全包含 tokens 的文档才算相关，丢失"部分相关"的召回能力。

**设计原则**：搜索系统的多路通道通过操作符语义天然区分召回边界，exact 用 AND（`@>`）、related 用 OR（`?|`）、fuzzy 用交集计数（`cardinality(INTERSECT)`），三路语义互补。

---

### 六、性能注意

`@>` 和 `?|` 走索引需要 GIN 索引：

```sql
CREATE INDEX IF NOT EXISTS idx_documents_tags_gin
  ON documents USING GIN (tags);
```

未建索引时：

- `@>` / `?|` 会全表扫，对大表（万级以上文档）会显著拖慢搜索。
- GIN 索引支持 `@>`、`?`、`?|`、`?&` 等 jsonb 域操作符，也支持 array 域的 `@>`、`&&`。

`tsvector` 列的全文检索应建 GIN 索引：

```sql
CREATE INDEX IF NOT EXISTS idx_documents_doctsv_gin
  ON documents USING GIN ("docTsv");
```

`unnest + INTERSECT` 的集合操作不走 GIN，但在 tags 规模小（通常 < 20 词）的场景下成本可忽略。若 fuzzy 通道性能不足，可考虑预计算词元重叠列或换用 `ts_rank` 排序。

**索引策略**：jsonb 列上的 GIN 索引同时服务 `@>` 和 `?|`，无需为每个操作符单独建索引；但要注意 GIN 索引的 `fastupdate` 在高写入场景下会累积待合并条目，需定期 `VACUUM` 或关闭 `fastupdate` 保证查询稳定性。

---

### 七、通用教训

1. **TypeORM entity 的列类型与 SQL 操作符必须严格对齐**：声明 jsonb 就只能用 jsonb 域操作符（`@>`、`?`、`?|`、`?&`）；声明 array 才能用 `@>`、`&&`、`<@`。entity 层契约与 SQL 层操作符分属两层，但运行时必须对齐。
2. **`@>` 跨域同名但语义不同**：array 域是元素包含，jsonb 域是结构包含。右操作数类型决定 PostgreSQL 走哪个域，跨域时必须显式 `to_jsonb()` 转换。
3. **`.catch(() => [])` 式降级会把 SQL 类型错误也吞掉**：这类降级本意是"查询失败时返回空结果"，但会让真正的 bug 变成静默失效。应配对 `logger.warn`，让失败可见、可追踪。InkWeaver 的搜索通道在修复后已加上 `logger.warn` 记录失败原因。
4. **`tsvector_to_array` 严格期望 tsvector 入参**：不能用 `tsquery`（`plainto_tsquery`、`to_tsquery` 的返回值）替代。混淆 pg 全文检索两类核心类型会导致静默错误。需要把查询文本拆词时，应先 `to_tsvector(text)` 构造 tsvector，再 `tsvector_to_array`。
5. **`array_length(x, 1)` 对空数组返回 NULL**：在条件分支里会被当 falsy 走错路径。统一用 `cardinality(x)`（空数组返回 0）做计数判断。
6. **搜索多路通道靠操作符语义区分召回边界**：exact 用 AND（`@>` 全包含）、related 用 OR（`?|` 任一重叠）、fuzzy 用交集计数。不要为了"统一"而把三路操作符合并，那会破坏语义边界。

---

### 八、相关 Issue

- Issue #41：searchFuzzy 通道 `tsvector_to_array(... && plainto_tsquery(...))` 双重类型错误，被 `.catch(() => [])` 吞掉导致 fuzzy 通道长期返回空。
- Issue #42：searchExact / searchRelated 通道 `@>` / `&&` 跨域类型不匹配，被降级吞掉导致 tags 过滤完全失效。

两条 Issue 的修复均以本笔记为根因参考：把 array 域操作符换成 jsonb 域同义操作符，并把降级路径加上 `logger.warn` 让失败可见。

---
