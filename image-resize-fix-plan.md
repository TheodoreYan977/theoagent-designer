# 图片元素等比缩放修复方案

> 范围：`designer.html`（前端单文件）。只修图片元素的“宽高比”相关逻辑，不动文字/矩形/其它功能。

## 1. 结论（TL;DR）

两个独立问题，根因都是“没有使用图片的真实宽高比”：

| # | 现象 | 根因 | 位置 |
|---|------|------|------|
| A | 属性面板点🔗锁定宽高比后，改高 100 宽却变成 200 | `commitSize()` 用元素**当前框**的 `w/h` 算比例，而非图片真实比例 | `commitSize()` L977–991 |
| B | 画布拖右上角（角点）缩放不按比例、会拉伸变形 | `startResize()` 宽高各自独立跟随鼠标，无等比约束 | `startResize()` L483–503 |

深一层：元素上从未保存图片真实尺寸——`naturalSize` 只是布尔开关，没有 `naturalW/naturalH`，所以锁定/缩放时拿不到真实比例。

---

## 2. 根因分析

### 2.1 属性面板锁定比例用错来源

现有代码：

```js
function commitSize(key, value) {
  const el = selectedEl();
  if (!el || !(value > 0)) return;
  const ratio = (el.w && el.h) ? el.w / el.h : 1;   // ← 用当前框比例
  el[key] = value;
  if (el.ratioLock) {
    if (key === 'w') el.h = Math.max(1, Math.round(value / ratio));
    else el.w = Math.max(1, Math.round(value * ratio));
  }
  ...
}
```

`ratio` 取的是此刻 `el.w / el.h`。当前框一旦被自由拖过、或新建时的默认 400×120 与图片真实比例不符，锁定后就会锁住错误比例。

**你的例子复现推导**：高改 100 → 宽变 200，说明锁定的是 **2:1**，即当时框 ≈ 宽 750 / 高 375。真实图片 3936:936 ≈ **4.2:1**，宽本应 ≈ 420。

### 2.2 画布缩放无等比约束

现有代码：

```js
if (dir.includes('e')) w = o.w + dx;
if (dir.includes('s')) h = o.h + dy;
if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
if (dir.includes('n')) { h = o.h - dy; y = o.y + dy; }
```

宽、高完全独立，角点（nw/ne/sw/se）和四边（n/s/e/w）都不保比例，也没有 Shift 切换。

---

## 3. 修复方案

### 3.1 数据层：给图片元素记录真实尺寸

图片元素新增两个字段（随模板 JSON 自动持久化，`render.mjs` 只读 `w/h/fit` 等，忽略新字段，无兼容风险）：

```js
el.naturalW  // 图片真实像素宽
el.naturalH  // 图片真实像素高
```

**写入时机（5 处，全部顺带、不动既有逻辑）：**

1. `uploadImage()`（L791–809）：`naturalSize(file)` 已算出 `{w,h}`，拿到后存 `el.naturalW/naturalH`（无论“原始尺寸”开关是否勾选都存）。
2. `toggleNatural()`（L824–833）：`img.onload` 里存 `naturalW/naturalH`。
3. `cropApply()`（L867–897）：裁剪后新图就是 `sw×sh`，存 `naturalW=sw; naturalH=sh`；`restoreOriginal()`（L898–905）恢复后重新懒加载一次真实尺寸。
4. 拖拽图片到画布（L1484–1486）：已有 `w/h`，顺带存 `naturalW/naturalH`。
5. 兜底懒加载：新增 `ensureImageRatio(el, cb)`，选中/锁定/缩放时若图片元素缺 `naturalW/naturalH`，用 `new Image()` 读 `naturalWidth/naturalHeight` 异步补齐（老模板打开后也能自动补）。

**辅助函数：**

```js
function imageAspect(el) {
  if (el && el.naturalW && el.naturalH) return el.naturalW / el.naturalH;
  return null;
}
function ensureImageRatio(el, cb) {
  if (!el || el.type !== 'image' || !el.src || (el.naturalW && el.naturalH)) { cb && cb(); return; }
  const img = new Image();
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight) { el.naturalW = img.naturalWidth; el.naturalH = img.naturalHeight; }
    cb && cb();
  };
  img.onerror = () => cb && cb();
  img.src = resolveSrc(el.src);
}
```

### 3.2 修 `commitSize()`（属性面板锁定比例）

改为：图片元素用真实比例，其它元素沿用当前 `w/h`（它们没有“真实比例”）。

```js
function commitSize(key, value) {
  const el = selectedEl();
  if (!el || !(value > 0)) return;
  if (el.ratioLock) {
    const nat = imageAspect(el);
    const ratio = nat != null ? nat : ((el.w && el.h) ? el.w / el.h : 1);
    if (key === 'w') { el.w = value; el.h = Math.max(1, Math.round(value / ratio)); }
    else { el.h = value; el.w = Math.max(1, Math.round(value * ratio)); }
  } else {
    el[key] = value;
  }
  snapshot(key + ':' + el.id);
  const d = document.querySelector(`[data-id="${CSS.escape(el.id)}"]`);
  if (d) { d.style.width = el.w + 'px'; d.style.height = el.h + 'px'; }
  const pw = $('p-w'), phh = $('p-h');
  if (pw) pw.value = el.w; if (phh) phh.value = el.h;
}
```

要点：`ratio` 必须在赋值前算好（对图片取自然比例、与赋值无关；对非图片取旧 `w/h`，不能先赋值再算）。

### 3.3 修 `startResize()`（画布等比缩放）

**交互规则（已确认）：**
- 图片元素：角点/四边**默认等比**；按住 `Shift` 临时自由拉伸。
- 文字/矩形：保持现状（自由拉伸，本次不改）。

```js
function startResize(e, el, dir) {
  e.stopPropagation(); e.preventDefault();
  const s = scale();
  const sx = e.clientX, sy = e.clientY;
  const o = { x: el.x, y: el.y, w: el.w, h: el.h };
  const nat = el.type === 'image' ? imageAspect(el) : null;
  const r = nat || (o.h ? o.w / o.h : 1);
  const proportional = el.type === 'image' && nat && !e.shiftKey;   // Shift = 自由拉伸
  const move = (ev) => {
    const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
    let x = o.x, y = o.y, w = o.w, h = o.h;
    if (proportional) {
      if (dir.length === 1) {            // 四边：对边固定，垂直方向居中
        if (dir === 'e')      { w = o.w + dx; h = w / r; y = o.y + (o.h - h) / 2; }
        else if (dir === 'w') { w = o.w - dx; h = w / r; y = o.y + (o.h - h) / 2; }
        else if (dir === 's') { h = o.h + dy; w = h * r; x = o.x + (o.w - w) / 2; }
        else                 { h = o.h - dy; w = h * r; x = o.x + (o.w - w) / 2; }
      } else {                          // 角点：对角固定，按真实比例等比缩放
        const nw = dir.includes('e') ? o.w + dx : o.w - dx;
        const nh = dir.includes('s') ? o.h + dy : o.h - dy;
        w = Math.max(Math.abs(nw), Math.abs(nh) * r);   // 取指针主导方向
        h = w / r;
      }
    } else {
      if (dir.includes('e')) w = o.w + dx;
      if (dir.includes('s')) h = o.h + dy;
      if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
      if (dir.includes('n')) { h = o.h - dy; y = o.y + dy; }
    }
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    if (dir.includes('w')) x = Math.round(o.x + o.w - w);   // 右边缘固定
    if (dir.includes('n')) y = Math.round(o.y + o.h - h);   // 下边缘固定
    el.x = x; el.y = y; el.w = w; el.h = h;
    updateElementStyle(el); positionOverlay();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    snapshot('resize:' + el.id, true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
```

锚点说明：统一由最后两行保证——`w` 手柄固定右边缘、`n` 手柄固定下边缘，角点组合后即“对角固定”；四边缩放时另一轴由分支内居中，不会跑偏。最小尺寸 8px 与现状一致。

---

## 4. 兼容性与风险

- 新增 `naturalW/naturalH` 字段随模板 JSON 序列化，`render.mjs` 不校验额外字段，导出 PNG 不受影响。
- 老模板：图片元素缺字段时走 `ensureImageRatio` 懒加载，选中即补齐；补齐前锁定/缩放按当前 `w/h` 兜底，不报错。
- 本次不改文字/矩形缩放、不改裁剪、不改吸管/滤镜等，回归面小。

## 5. 验证清单

1. 用 3936×936 图：上传 → 点🔗 → 高改 100，宽 ≈ 420（不再是 200）。
2. 锁定后改宽，高按真实比例联动。
3. 画布拖右上角，宽高始终保持 3936:936；按住 Shift 可自由变形。
4. 画布拖四边，图片不拉扁（另一轴联动）。
5. 文字/矩形拖拽缩放行为不变；撤销/重做、保存模板、导出 PNG 正常。
6. 打开含图片的旧模板，选中后锁定/缩放比例正确。

## 6. 实施步骤（可回退）

1. 加 `imageAspect` / `ensureImageRatio` 两个辅助函数。
2. 在 5 处写入时机补存 `naturalW/naturalH`。
3. 改 `commitSize`（第 977 行起）。
4. 改 `startResize`（第 483 行起）。
5. `populatePanel` / `toggleRatio` 里调用 `ensureImageRatio` 补齐。
6. 本地 `node server.mjs` 起服务，按第 5 节清单逐项验证。
