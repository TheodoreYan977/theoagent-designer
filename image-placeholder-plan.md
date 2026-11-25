# 图片占位符 + 按占位符添加元素 · 执行计划

> 分支：`feature/image-placeholder`（基于 `origin/main`）
> 范围：仅 `designer.html`（前端）。`render.mjs` / `server.mjs` 无需改动（占位符渲染链路已支持）。

## 1. 背景与目标

现在占位符只有“文字”一种形态：左侧「内容/占位符」里每个占位符都是一个文本框，内容值存进 `sample[key]`，文字元素用 `content: "{key}"` 引用。

要新增两件事：

1. **占位符区分类型**：添加占位符时可选择「文字占位符」或「图片占位符」。图片占位符的内容值是一张图（路径 / dataURL），在面板里提供上传+预览，而不是文本框。
2. **添加元素时基于占位符**：工具栏点「文字 / 图片」时，除了“新建空白”，还能直接从现有占位符里选一个来新建元素，自动把 `content` / `src` 绑成 `{key}`。

## 2. 现状梳理（关键位置）

| 机制 | 位置（`designer.html`） | 说明 |
|---|---|---|
| 占位符列表来源 | `pagePlaceholderKeys()` L1263 | = 全局 `template.globalKeys` + 页面 `pg.placeholders` + 元素里出现的 `{key}`，再按 `pg.order` 排序 |
| 从元素里收集占位符 | `elementPlaceholderKeys()` L1255 | 扫 `el.content` 和 `el.src` 里的 `{key}` |
| 内容面板渲染 | `renderContentPanel()` L1277 | 每个 key 渲染：备注 input + 内容值 input（都是文本框） |
| 添加占位符 | `addPlaceholder()` L1307 | 现在用 `prompt()` 只填名称，无类型 |
| 内容值存储 | `sample[key]`，`setContent()` L1427 | 全局共享，存到 `sample.json` |
| 备注存储 | `template.placeholders["{key}"]` = 备注字符串 | 注意：这个字段叫 placeholders 但存的是“备注”，不是类型 |
| 占位符替换 | `substitute()` L245 | `{key}` → `sample[key]` |
| 图片元素引用占位符 | `el.src = "{key}"`，`resolveSrc()` L246 | 已经支持，`{image}` 就是例子 |
| 添加元素 | `addElement()` L1045；工具栏按钮 L178-180 | 现在直接 `addElement('text'/'image'/'rect')`，不绑定占位符 |
| 上传图片 | `uploadImage(file)` L825 | 目标固定是 `selectedEl()`，占位符场景需新增变体 |
| 文字属性面板插入占位符下拉 | `insertDropdownKeys()` L1420 | 列出所有 key，未区分类型 |

导出链路已通：`render.mjs` 的 `elementHtml()` 用 `substitute(el.src, content)` 解析图片占位符，`resolveFile()` 再定位本地文件——所以图片占位符在导出 PNG 时无需改后端。

## 3. 需求拆解

- **R1 占位符类型**：占位符有 `text` / `image` 两种类型；添加时可选择；面板按类型渲染。
- **R2 基于占位符添加元素**：文字→文字占位符、图片→图片占位符，创建时自动绑定 `{key}`。
- **R3 兼容老模板**：现有模板没有类型信息，需自动推断/默认，不能破坏已有排版。

## 4. 设计方案

### 4.1 数据模型（最小改动）

新增一个类型表（不改 `template.placeholders` 的“备注”语义，也不改 `sample`）：

```js
template.phTypes = { [key]: 'text' | 'image' }   // 缺省视为 'text'
```

- 读类型：`phType(key) => (template.phTypes && template.phTypes[key]) || 'text'`
- 好处：老模板 `phTypes` 缺失时零成本兼容；保存模板时随 `template` 一起写回 `template.json`。
- 元素绑定记录（可选，便于将来“改绑”）：元素上记 `el.ph = key`。绑定本身仍靠 `content`/`src` 里的 `{key}` 生效，`el.ph` 只是元数据，本次可作为可选项。

### 4.2 R1：添加占位符时选类型

把 `addPlaceholder()` 的 `prompt()` 换成一个小弹窗（复用现有 `.pm-box` / `#page-modal` 的弹窗样式）：

- 字段：名称（沿用现有校验：`^[A-Za-z_][A-Za-z0-9_]*$`、不可重名）+ 类型下拉（文字 / 图片）。
- 确认后：写入 `ab.placeholders`、`template.placeholders["{key}"]`、`sample[key] = ''`、`template.phTypes[key] = type`。
- 新增 HTML：`#ph-modal`（结构与 `#page-modal` 类似）。

### 4.3 R1：内容面板按类型渲染

`renderContentPanel()` 里按 `phType(k)` 分支：

- **文字占位符**：保持现状（备注 input + 内容值文本框）。
- **图片占位符**：
  - 名称旁加类型角标「图片」；
  - 内容区换成：缩略图（有值才显示）+「⬆ 上传」按钮 + 路径/dataURL 输入框（类似元素图片行 L725-729）。
  - 上传走 `/api/upload`，成功后 `sample[key] = j.path` 并刷新预览；新增 `uploadPhImage(key, file)`（区别于 `uploadImage` 面向 `selectedEl`）。

### 4.4 R2：添加文字/图片时基于占位符

工具栏「文字 / 图片」点击后弹出选择弹窗 `#add-el-modal`（按点击的 type 决定内容）：

- 「新建空白文字 / 图片」→ 走现有 `addElement(type)`。
- 「基于占位符」：列出**当前页可用且类型匹配**的占位符（文字按钮列文字占位符，图片按钮列图片占位符，复用 `pagePlaceholderKeys()` + `phType` 过滤）；点某个 key → `addElementBound(type, key)`。
- 图片按钮额外保留「上传图片并添加」入口（对应现有拖拽上传能力，补一个按钮）。

```js
function addElementBound(type, key) {
  const ab = activeBoard();
  const el = { id: type + '-' + Date.now().toString(36), type, x: 100, y: 100, w: 400, h: 120, /* 其它默认同 addElement */ };
  if (type === 'text') { el.content = '{' + key + '}'; }
  else {
    el.src = '{' + key + '}';
    el.fit = 'cover'; el.radius = 12;
    // 若 sample[key] 是图片路径，异步读取真实宽高写入 naturalW/naturalH，
    // 这样等比缩放（上一轮已修）对图片占位符元素也生效
    ensureImageRatio(el);
  }
  el.ph = key;
  ab.elements.push(el);
  snapshot('add:' + el.id, true);
  render(); select(el.id);
}
```

- 「矩形」按钮保持直接 `addElement('rect')`（本次不动）。
- 文字属性面板里的「插入占位符」下拉（`insertDropdownKeys()`）：可选地把文字元素的候选列表过滤成 `text` 类型（小改进，避免把图片占位符插进文字）。

### 4.5 R3：老模板兼容

`init()`（L1237）加载完模板后调用一次 `ensurePhTypes()`：

- 对每个已知 key：若 `phTypes[key]` 已存在则跳过；
- 否则**推断**：如果该 key 只出现在图片元素的 `src` 里 → `image`；否则 → `text`。
- 推断规则写成一个纯函数 `inferPhTypes()`，供 init 调用；`template.phTypes = { ...inferred, ...existing }`（已有显式类型优先）。

这样现有模板里的 `{image}`（photo 元素引用）会自动标成图片占位符，用户打开即可用，无需手工改。

## 5. 具体改动清单（`designer.html`）

| # | 位置 | 改动 |
|---|---|---|
| 1 | CSS / body | 加 `#ph-modal`、`#add-el-modal` 弹窗样式（复用 `.pm-*`） |
| 2 | 工具栏 L178-180 | 文字/图片按钮 `onclick` 改为 `openAddEl('text')` / `openAddEl('image')` |
| 3 | `addElement()` L1045 | 抽出公共“默认元素对象”逻辑，供 `addElementBound` 复用 |
| 4 | 新增 `phType()` / `phKeysOfType()` / `inferPhTypes()` / `ensurePhTypes()` | 类型读取与推断 |
| 5 | `addPlaceholder()` L1307 | 改为弹窗，增加类型选择，写入 `phTypes` |
| 6 | `renderContentPanel()` L1277 | 按类型渲染文字/图片两种内容区；新增类型角标 |
| 7 | 新增 `uploadPhImage(key, file)` | 占位符图片上传，写 `sample[key]` |
| 8 | 新增 `openAddEl(type)` / `addElementBound(type, key)` / 关闭弹窗 | 添加元素选择弹窗与绑定创建 |
| 9 | `insertDropdownKeys()` L1420（可选） | 文字插入下拉按 `text` 类型过滤 |
| 10 | `init()` L1237 | 末尾调用 `ensurePhTypes()` |

## 6. 验证清单

1. 添加占位符：弹窗选「图片」→ 面板出现「图片」角标 + 上传按钮（而非文本框）；选「文字」→ 仍是文本框。
2. 图片占位符上传图片后：出现缩略图，`sample[key]` = `uploads/...`；保存内容后重开仍在。
3. 工具栏「文字」→ 选一个文字占位符 → 画布新增文字元素，内容自动为 `{key}` 并实时替换。
4. 工具栏「图片」→ 选一个图片占位符 → 画布新增图片元素，`src = {key}` 正常显示；锁定宽高比时按图片真实比例（上一轮修复）生效。
5. 老模板：打开后 `{image}` 被自动推断为图片占位符，内容面板显示为图片形态。
6. 保存模板 / 导出 PNG：图片占位符正常渲染出图；新字段 `phTypes` 写回 `template.json`。
7. 撤销/重做、删除占位符（会清掉元素里的 `{key}`）、重命名占位符（同步更新 `phTypes` key）均正常。

## 7. 实施步骤（可回退）

1. 数据层：加 `phType` / `inferPhTypes` / `ensurePhTypes`，`init` 里调用。
2. 弹窗 UI：`#ph-modal` 与 `#add-el-modal` 的 HTML/CSS。
3. `addPlaceholder` 改造 + 写 `phTypes`。
4. `renderContentPanel` 按类型渲染 + `uploadPhImage`。
5. 工具栏 `openAddEl` + `addElementBound`。
6. 本地 `node server.mjs` 逐项过第 6 节清单；用 puppeteer 冒烟测试关键路径（可选）。
7. 提交并推送 `feature/image-placeholder` 分支。

## 8. 风险与边界

- `template.placeholders` 语义不变（仍是备注），只新增 `phTypes`，不迁移旧数据、不回写破坏。
- 推断类型仅在“无显式类型”时生效；用户手动改类型以显式为准。
- 图片占位符的内容值仍是 `sample[key]`（图片路径/dataURL），与文字占位符共用同一份 `sample`，导出链路不变。
- 本次不改矩形、不改裁剪/滤镜等；回归面集中在占位符与添加元素两条路径。
