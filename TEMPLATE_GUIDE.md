# 模板开发指南 · TEMPLATE_GUIDE

> 本文是**模板与引擎之间的接口契约**。任何人在不改动引擎代码的前提下，
> 都能新增一套小票模板。规范稳定后，模板即可独立迭代（含视觉重做）。
> 版本：v0.4.1（2026-10-12）　适用范围：`src/engine.js` 0.4.x
> （栏位 `data-block` / 装饰槽 `data-slot` / **头尾分层** / **`manifest.defaultDeco` 默认装饰回落** /
> 　**`data-block-require` 空值灰锁** 已生效）

---

## 1. 一套模板 = 一个目录

```
templates/<模板id>/
├─ manifest.json     # 元信息（必需）
├─ template.html     # 结构（必需，文件名由 manifest.entry 指定）
├─ template.css      # 视觉（必需，文件名由 manifest.styles 指定）
└─ assets/           # ⚠️ 可选，当前构建器**不会**内联处理（见 §4 注）
```

新建后，在 `templates/index.json` 的 `templates` 数组里追加一条并给出 `order` 排序值。

当前正式注册 7 套：3 套常用来源模板与 4 套兜底模板。已退役的活动 / 联名周边 / 战利品模板已移到 `archive/retired-data-sources/templates/`，不会被加载或构建。

| 档位 | 模板 | 用途 |
|---|---|---|
| **专属（1:1 绑定左栏数据源）** | `order-receipt` / `points-passbook` / `fun-resume` | 三类启用来源各有自己的版式，用户不用在下拉框里挑 |
| **兜底（契约示例）** | `starter-classic` / `starter-retro` / `starter-note` / `starter-stub-stats` | 保留作极简风选项与契约样例（去留见决策 DP-5） |

> 新增专属模板时，请同步在 `src/panel.js` 的 `SOURCES` 常量里登记（`template` 字段），
> 左栏入口才会指向它。

---

## 2. manifest.json 字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 必须与目录名完全一致 |
| `name` | string | ✅ | 在模板下拉里显示的名字 |
| `version` | string | ✅ | 模板自身的版本号（视觉改动请递增） |
| `author` | string | — | 设计者署名 |
| `status` | string | — | `placeholder` 占位 / `ready` 正式可用。**引擎与页面对 `ready` 模板不做任何降级提示** |
| `description` | string | — | 一句话描述 |
| `entry` | string | ✅ | HTML 入口文件名，默认 `template.html` |
| `styles` | string[] | — | CSS 文件列表，默认 `["template.css"]`，按顺序拼接 |
| `size.width` | number | — | 设计稿宽度（px），供导出与预览参考 |
| `size.bleed` | number | — | 出血/留边（px），供打印参考 |
| `export.scale` | number | — | 导出 PNG 的倍率，默认 3（3 倍约 300dpi，适合打印） |
| `export.background` | string | — | 导出图片底色，默认 `#ffffff`；透明底请用 `null` |
| `capabilities` | object | — | `editable` / `repeat` / `blocks` / `slots`，声明支持的能力 |
| `defaultDeco` | object | — | **默认装饰（v0.4.0 / D-032）**：`{ "<槽位id>": "<素材id>" }`。数据里没有 `deco` 字段时引擎回落到它 —— 保证**占位状态下票面就有层次**，不必等美术 |
| `tokens` | object | — | 主题色等设计令牌，仅供文档与后续换肤参考 |

### `defaultDeco` 回落规则（v0.4.0）

```
数据层有 deco 数组（用户动过任一槽位）  → 用数据层的，不再回落（尊重"我全都不要"）
数据层没有 deco 字段                    → 用 manifest.defaultDeco
manifest 也没有 defaultDeco             → 槽位全空（旧行为）
```

- 每个默认值**依然是可换槽位**：用户在右栏「装饰」里挑一下，就把默认值换成显式选择。
- 换模板时默认装饰跟着换，**当前七套模板各有自己的默认组合**（如 `points-passbook` 走 `band-stripe + hdr-arch + rule-double + wm-grid`，`fun-resume` 走其履历主题组合）。已退役模板的原组合仅在归档目录保留。
- 素材 id 必须存在于 `src/decos/deco.json`，槽位必须与模板里 `data-slot` 的取值一致；否则 `cli.js check` 会报。

---

## 3. 结构标注（template.html）

模板**不要**自己写 `.rct-scope` 容器，也**不要**包含 `<script>` —— 这两项由引擎负责。
你只需要写小票内部的结构，并加上下面的标注：

| 标注 | 作用 | 示例 |
|---|---|---|
| `data-field="<路径>"` | 从数据里取数并填入该元素 | `<span data-field="amounts.total">` |
| `data-repeat="<数组路径>"` | 循环容器 | `<ul data-repeat="items">` |
| `data-repeat-item` | 标记循环体内被复制的元素（**必需**，否则引擎取第一个子元素） | `<li data-repeat-item>` |
| `data-format="money\|date\|datetime\|time\|qty\|qty2\|number\|points"` | 输出格式化 | `data-format="money"` → `¥13.90` |
| `data-if="<路径>"` | 值为空/0/false 时隐藏该元素 | `data-if="amounts.discount"` |
| `data-kind="note"` | 该字段允许多行（回车不结束编辑） | 碎碎念 |
| `data-editable="false"` | 锁定，用户不可编辑 | 会员编号、字标、装饰元素 |
| `data-block="<id>"` | **栏位**：用户可在右栏开关 / 上下移 | 见下方 §3.2 |
| `data-slot="<slotId>"` | **装饰槽**：留给装饰素材的空容器 | 见下方 §3.3 |

### 循环体内的字段用「裸名」

```html
<ul data-repeat="items">
  <li data-repeat-item>
    <span data-field="name">品项</span>        <!-- 取当前行的 items[i].name -->
    <span data-field="qty" data-format="qty">1</span>
    <span data-field="amount" data-format="money">0.00</span>
  </li>
</ul>
```

带点的路径（如 `store.name`）始终从数据根开始解析；裸名优先取当前循环行。

### 数据路径速查

| 路径 | 含义 |
|---|---|
| `meta.receiptNo` | 小票单号（已脱敏 `F-` + 后 6 位） |
| `meta.title` | 小票主标题（非点单类小票用，如「麦门履历小票」） |
| `meta.kind` | 当前启用：`order` / `points` / `fun`；`activity` / `collectible` / `loot` 是已退役旧类型，仅供旧工程兼容 |
| `meta.badge` | 票头徽标（如「取餐码 35391」）；**留空即不渲染** |
| `meta.brand` | 票头字标（品牌名），默认「麦门日记」 |
| `meta.slogan` | ⛔ **已废弃**（D-034，v0.4.1）：票尾 slogan 横条整体移除，`mappers` 不再产出。字段保留仅为旧工程包回放 |
| `store.name` / `store.address` / `store.code` / `store.phone` | 门店信息 |
| `order.datetime` / `order.takeWay` / `order.orderType` | 时间与取餐方式 |
| `order.pickupCode` / `order.remark` / `order.address` | 取餐码 / 用户备注 / 配送地址（明细版才有） |
| `items[].name` / `.spec` / `.qty` / `.unitPrice` / `.amount` / `.tag` / `.obtained` | 品项（循环体内用裸名） |
| `items[].image` | 🚫 **模板禁止引用**。它确实存在于数据里（MCP 的 `productImage`），但只供左栏数据实例辨认订单。`checkTemplate()` 会**静态拦截** `data-field="…image"` 与 `<img>` 标签，写了直接 `check` 失败（D-021 合规红线） |
| `fees.productPrice` / `.packing` / `.delivery` / `.tableware` | 费用拆分（明细版才有） |
| `amounts.subtotal` / `.discount` / `.delivery` / `.total` / `.listPrice` | 金额汇总 |
| `amounts.mode` | `items`（默认，小计 = Σ 品项金额）/ `order`（整单金额模式，品项不分摊）/ `detail`（明细版，品项有真实单价） |
| `coupons[].name` / `.amount` | 优惠明细（可选） |
| `member.points` / `.level` | 会员信息（可选） |
| `member.no` | **会员编号**（`No.XXXX-XXXX`）—— 由真实 `accountId` 前 8 位十六进制裁出，签名区用；**是真实数据，非编造** |
| `journal.moodLabel` / `.note` / `.signature` | 手账区（`journal.mood` 已废弃，见下）|
| `journal.mood` | 🚫 **模板禁止引用**。v0.3.5 起「心情 emoji」特性整体移除（D-031）—— 彩色 emoji 与手绘 / 票据版式不兼容，也没有真实数据支撑。`checkTemplate()` 会**静态拦截** `data-kind="mood"`，写了直接 `check` 失败 |
| `summary[].label` / `.value` | 摘要行（非点单类小票用，如积分存折的可用/累计/已用） |
| `stats[].label` / `.value` / `.hint` | 统计行（趣味数据小票用，如门店足迹/最贵一单） |
| `blocks[]` / `deco[]` / `skin` | 由引擎维护，模板**不需要**标注（见 §3.2 / §3.3） |

**非点单类小票的写法**（当前启用：积分存折 / 趣味统计）：

```html
<dl data-repeat="summary">
  <div data-repeat-item>
    <dt data-field="label">名目</dt>
    <dd data-field="value">—</dd>
  </div>
</dl>

<ul data-repeat="stats">
  <li data-repeat-item>
    <span data-field="label">统计</span>
    <span data-field="value">—</span>
    <span data-field="hint"></span>
  </li>
</ul>
```

参考实现：`templates/starter-stub-stats/`。

完整契约见 [`src/receipt.schema.json`](./src/receipt.schema.json)。

### 3.2 栏位标注 `data-block`（已生效）

标在「一个可以被用户开关的区块」上。引擎会把它们收进右栏「栏位」面板：

```html
<div class="receipt">
  <header  data-block="head"   data-block-name="抬头"     data-block-lock="true">…</header>
  <section data-block="lines"  data-block-name="出品单">…</section>
  <section data-block="amount" data-block-name="金额区">…</section>
  <section data-block="disc"   data-block-name="优惠明细" data-block-optional="true"
           data-block-require="coupons">…</section>
  <section data-block="journal" data-block-name="手账区"  data-block-optional="true">…</section>
  <section data-block="sign"   data-block-name="签名区"   data-block-optional="true">…</section>
  <footer class="rcpt__foot">…</footer>   <!-- 票尾：分割线 + 尾图（装饰槽，不是"栏位"） -->
</div>
```

> **v0.4.0 新增「签名区」栏位** `sign`：会员编号（真实 `accountId`）+ 落款 + 日期，给票尾一个仪式感收束。
> **v0.4.1 起印章 / 贴纸槽位并入签名区**，页脚只剩「分割线 + 尾图」两个装饰槽，不再是栏位。
> 只读的会员编号请加 `data-editable="false"`；落款走 `journal.signature`，用户可改。

| 属性 | 必需 | 作用 |
|---|---|---|
| `data-block="<id>"` | ✅ | 栏位唯一 id（英文短横线命名） |
| `data-block-name="中文名"` | ✅ | 右栏「栏位」面板里显示的名字 |
| `data-block-optional="true"` | — | 用户**可以关闭**；不写则默认必显 |
| `data-block-lock="true"` | — | **不可关闭**（抬头这类身份栏位必须加） |
| `data-block-require="a.b,c.d"` | — | **空值灰锁**（v0.4.1 · D-035）：逗号分隔字段路径，**任一有值**才算「有数据」；不写则一律可用 |

> ⚠️ **三条硬规则**
> 1. **所有 `data-block` 元素必须同级**（同一个父容器内）—— 引擎靠「同级重排」实现上下移；
>    跨层级嵌套时排序会失效。
> 2. **「本来就可能没数据」的栏位必须写 `data-block-require`** —— 否则用户会看到一个永远空着的开关。
> 3. **票尾不要写成 `data-block`** —— 它只剩版式（分割线 + 尾图），不是可开关的内容。
>
> ✅ **版式元素是安全的（F-20 修复后的契约保证）**：同一父容器下，**不带 `data-block` 的普通子元素
> 不会被栏位重排挪动**，始终停在原来的位置上。所以水印、票尾装饰容器、打孔线这类「不是内容、
> 只是版式」的元素，尽管放在栏位之外，不必为了「不被挪走」而硬塞一个 `data-block` 进去。
> （v0.4.1 曾因引擎用 `appendChild` 逐个挪栏位、导致无 `data-block` 的票尾容器"相对上浮"到票头
> 前面并与票头重叠，即 F-20；现已按「others 原位保留、栏位按序回填」实现。）

> **`data-if` / `data-block` / `data-block-require` 的分工**
>
> | 声明 | 回答的问题 | 谁说了算 |
> |---|---|---|
> | `data-if="x"` | 这块**内容**有没有？ | 数据 |
> | `data-block="id"` | 用户**开没开**？ | 用户 |
> | `data-block-require="x"` | 这份数据**配不配**有这个栏位？ | 数据优先，**否掉用户的开关** |
>
> 渲染顺序：先 `_applyConds()`（`data-if`）→ 再套栏位开关。`require` 判定「无数据」时：
> 票面自动隐藏，右栏开关**灰显 + 禁用 + 标注「无数据」**，用户点不动（`_blockActive()`）。
> 典型例子：订单本来就没有优惠 → `disc` 栏位灰锁，而不是留一个空白块。

参考实现：`templates/order-receipt/template.html`（9 个栏位，仅 1 个 lock）。

### 3.3 装饰槽标注 `data-slot`（已生效）

标在「留给装饰素材的空容器」上，用户在右栏「装饰」面板里挑素材：

```html
<div data-slot="watermark"></div>     <!-- 水印：铺满整票，引擎置于内容之下 -->
<div data-slot="band"></div>          <!-- 装饰条：横贯票面的纹样带，头尾通用 -->
<div data-slot="header-art"></div>    <!-- 创意头图 logo -->
<div data-slot="rule"></div>          <!-- 分割线：头尾通用 -->
<div data-slot="stamp"></div>         <!-- 印章（盖在签名区） -->
<div data-slot="sticker"></div>       <!-- 贴纸 -->
```

| 槽位 id | 中文名 | 内置素材数 | 说明 |
|---|---|---|---|
| `band` | 装饰条 | 7 | 横贯票面的纹样带，高度约 10px，宽度自适应；头尾通用 |
| `header-art` | 头图 | 16 | 创意头图 logo（内置透明 PNG / 拱门 / 横幅 / 边框 / 印章 / 桂冠…） |
| `rule` | 分割线 | 9 | 波线 / 浪线 / 虚线 / 点线 / 双线 / 锯齿 / 扇贝 / 菱形 / 十字；头尾通用 |
| `watermark` | 水印 | 6 | 网格 / 圆点 / 斜纹 / 十字 / 弧线 / 星形；引擎把它放在内容之下 |
| `stamp` | 印章 | 5 | 印章（v0.4.1 起建议放在签名区） |
| `sticker` | 贴纸 | 6 | 贴纸 |
| `avatar` ⛔ | 头像 | — | **已停用**（D-030，v0.3.4）：界面无头像入口，引擎默认不注入、槽位自动隐藏。模板里可以留、也可以不留 |

| 约定 | 说明 |
|---|---|
| 空槽 | 引擎自动 `display:none`，**不占位、不留空洞** |
| 默认有料 | 模板应在 `manifest.defaultDeco` 里给每个槽位一个默认素材 —— 占位状态下就有层次（D-032） |
| 只渲染存在的槽 | 右栏只显示「当前模板真的有的槽位」；模板没标 `sticker` 就不会出现贴纸面板 |
| 素材来源 | `src/decos/deco.json` 中的内置 SVG，以及 `header-art` 可选的内置透明 PNG；**页面不提供任何上传**（D-022） |
| 内联 id 唯一 | 同一素材可能被注入多个同名槽位（如 band 头尾各一处），模板里写内联 SVG `pattern` 时**不用自己操心 id** —— 引擎会 `uniquifySvg()` 自动加后缀 |

> 如果需要新的槽位，先在 `src/decos/deco.json` 的 `slots` 数组里登记，再在模板里使用；
> 否则 `cli.js check` 会给出提示。

### 3.4 头尾分层（v0.4.1 · D-032 / D-034）

用户反馈「票头/票尾层次太少」，随后又给出**目标架构**。v0.4.1 起，正式模板统一按下面切开，
**占位状态下就有 7 层以上**，美术只需替换视觉，不必再造结构：

```
票头：band 装饰条 → header-art 头图 → rule 分割线 → meta.brand 字标 → store.name 门店
     → store.address 地址 → meta.badge 徽标
正文：meta 单号时间 → lines 出品单 → fees 费用 → amount 金额 → disc 优惠 → remark 备注 → journal 手账
签名：sign 栏位（stamp 印章 / 会员编号 / 落款 / 日期 / member.points 积分）
票尾：rule--foot 分割线 → band--foot 尾图收边
全局：watermark 水印铺满整票（引擎置于内容之下）
```

> **v0.4.1 两处关键调整（D-034，用户拍板）**
> 1. **抬头挪到分割线下面**：原来是「头图 → 字标 → 门店 → 分割线」，现在是
>    「头图 → **分割线** → 字标 → 门店」。分割线成为「主视觉区 / 信息区」的分界。
> 2. **页脚压平**：删掉 **免责声明** 与 **slogan 横条**，印章 / 积分并入签名区，
>    票尾只剩「分割线 + 尾图」。此外全项目移除 **胶带槽位**（`tape-top`）——
>    它突出票面之外，影响导出且不好看。

两条实现要点：

1. **`watermark` 用绝对定位铺满** —— 模板需给票根容器建立层叠上下文（`.rcpt { isolation: isolate; }`），
   水印 `position:absolute; inset:0; z-index:-1`，否则会盖住正文。
2. **`band` / `rule` 头尾各有一处，同名槽位** —— 引擎注入时会自动做 id 唯一化，模板无需区分命名。

### 3.5 颜色必须走 CSS 变量（否则"换纸色"失效）

```css
.rct-scope--my-design .receipt {
  background: var(--rct-paper, #fafaf8);
  background-image: var(--rct-texture, none);
  color: var(--rct-ink, #26282a);
  border-color: var(--rct-line, #c9c9c4);
}
.rct-scope--my-design .receipt__total { color: var(--rct-accent, #d7261e); }
```

可用变量（由`src/decos/skins.json`的皮肤写入 `.rct-scope` 行内样式）：

| 变量 | 含义 |
|---|---|
| `--rct-paper` | 纸张底色 |
| `--rct-ink` | 主文字色 |
| `--rct-ink-weak` | 次要文字色 |
| `--rct-accent` | 强调色 |
| `--rct-line` | 分隔线色 |
| `--rct-texture` | 纸纹（CSS `background-image` 值，可为 `none`） |

> **对已有美术稿的影响**：以上都是**叠加标注 / 变量替换**，**不改变版式的视觉结果**。
> 风格探索稿无需返工，落地成模板时补上标注即可。

**另需交付**：`templates/<id>/thumb.png`（缩略图，宽 120–160px）——用于左栏卡片，
是「取消下拉框、改可见卡片」的关键素材。

---

## 4. 样式约定（template.css）

1. **必须**以 `.rct-scope--<模板id>` 作为作用域根，例如：

```css
.rct-scope--my-design .receipt { width: 320px; /* ... */ }
.rct-scope--my-design .receipt__total { font-weight: 700; }
```

   （引擎渲染时会自动生成 `<div class="rct-scope rct-scope--my-design">` 包裹你的 HTML。）

2. **不要**使用 `:root`、`body`、`*` 等全局选择器。
3. 字体请使用**系统字体栈**，且**每一条 `font-family` 都必须显式列出中文字体名兜底**。
   > 🔴 **硬约束（D-037 · 门禁强制）**：字体栈末尾**不能只有泛型**（`serif` / `sans-serif` / `monospace`）。
   > PNG 导出走 `html2canvas`，它会把字体栈的**每一段都加引号**再交给 canvas；
   > 泛型一旦被引号化，canvas 就不再把它当泛型解析 → 中文回退到**另一套字体**、单字宽改变，
   > 导出图就会「字距被拉开、笔画变细、断行点位移」，与页面版式不一致。
   >
   > ```css
   > /* ✗ 错：中文只能靠泛型兜底 */
   > font-family: Arial, Helvetica, sans-serif;
   > /* ✓ 对：显式列出中文字体 */
   > font-family: Arial, Helvetica, "PingFang SC", "Microsoft YaHei", sans-serif;
   > ```
   >
   > 常用中文字体名：`"PingFang SC"`（macOS）、`"Microsoft YaHei"`（Windows）、`SimSun` / `SimHei` / `KaiTi` / `"Songti SC"`。
   > `node cli.js check` 第 ⑤ 段会逐条校验 `template.css` 与内联 `style` 里的 `font-family`，不满足直接失败。
   >
   > ⚠️ **重要（当前限制）**：`builder.js` 只读取 `manifest.entry` 的 HTML 与 `manifest.styles` 的 CSS，
   > **不会**处理 `assets/` 目录（无 base64 内联）。因此相对路径引用的图片/字体在**单文件产物与 PNG 导出中会失效**。
   > 头图可以在 `src/decos/deco.json` 中登记 `pngFile`，由构建器将 `src/decos/images/` 里的透明 PNG 内联进单文件产物；其它模板图片仍需内联 SVG 或 `data:` URI，不要依赖 `assets/` 相对路径。
4. 尺寸建议：宽度 300–420px（手账 A6 友好）；长边过长时注意分页打印效果。
5. 打印适配：引擎已统一处理 `@media print`（隐藏工具条）；模板只需保证自身无固定定位元素即可。

---

## 5. 编辑与导出行为（引擎提供，无需你实现）

| 行为 | 说明 |
|---|---|
| 就地编辑 | 所有 `data-field` 元素自动变为可编辑；hover 显示虚线提示、focus 高亮 |
| 金额联动 | 修改品项或金额后自动重算。`amounts.mode="items"` / `"detail"` 时 小计 = Σ 品项金额；`mode="order"` 时只做 `total = subtotal - discount + delivery`，**不会把整单金额算成 0**（历史订单场景必需） |
| 多行文本 | `data-kind="note"` 允许换行，按 `white-space: pre-wrap` 渲染 |
| 栏位开关 | 模板里标了 `data-block` 的区块，用户可在右栏开关 / 上下移 |
| 换纸色 | 换 `src/decos/skins.json` 里的皮肤 = 换 `.rct-scope` 上的 `--rct-*` 变量 |
| 贴装饰 | 模板里标了 `data-slot` 的槽位，用户可从内置素材里挑一个贴上去；**不挑也有 `manifest.defaultDeco` 的默认层次**（D-032） |
| 签名区 | `sign` 栏位展示会员编号（真实 `accountId`）+ 落款 + 日期；会员编号只读 |
| 头像 ⛔ | **已停用**（D-030）：界面上没有头像入口，槽位默认空且隐藏。保留 `listAvatars/setAvatar` 仅供旧工程包回放 |
| 明细行增删 | 订单类小票可在右栏增 / 删 / 上下移明细行，金额自动重算 |
| 文案库 | 右栏「文案库」一键把预设文案追加到 `journal.note` |
| 导出 PNG | 按 `export.scale` 倍率栅格化导出 |
| 打印 | 隐藏工具条后调用浏览器打印 |
| 工程出入 | 可导出/导入工程 JSON（数据 + 栏位 + 皮肤 + 装饰），实现「页面改一半 → 回到对话继续改」 |

> ⚠️ 若某字段你希望**不可编辑**（例如印在纸张上的装饰文字），请加 `data-editable="false"`。
> 否则用户点击时会出现编辑高亮，影响观感。

### 占位与美术接入

本项目当前所有视觉均为**占位级**。待设计位置统一带 `data-placeholder="<占位id>"`：

- **左栏数据源层**（3 个启用入口图标 / 缩略图 / 空状态插画）见 [`PLACEHOLDERS.md`](./PLACEHOLDERS.md)
- **右栏编辑装饰层**（分段标题 / 皮肤色卡 / 装饰素材位 / 面包屑）见同上
- **模板层**：6 套专属模板 + 4 套 `starter-*` 兜底模板均为结构占位（`manifest.status = "placeholder"`），可直接替换或另建新模板
- 替换时请**保留 `data-placeholder` / `data-block` / `data-slot` 属性、类名与 DOM 结构**，只改样式与素材

---

## 6. 自检与验收

```bash
node cli.js check            # 检查全部模板 + 示例数据
node cli.js selftest         # 一键自检（推荐提交前跑）
node cli.js build --all      # 构建产物，打开 index.html 肉眼验收
```

`check` / `selftest` 会自动校验：

- manifest 必填字段是否齐全、`id` 与目录名是否一致
- 模板是否误含 `<script>`、是否自建 `.rct-scope` 容器
- `data-repeat` 内是否有 `data-repeat-item`
- 所有 `data-field` 路径是否能在示例数据里解析（避免"标了字段但数据没有"的空显示）
- CSS 是否以正确的作用域根开头
- **素材包**：皮肤变量是否以 `--rct-` 开头、装饰是否为合法内联 SVG 或内置透明 PNG 头图、槽位是否已登记
- **数据源映射**：三类启用来源（订单明细 / 积分 / 履历）是否都能映射出符合契约的小票

### 交付清单（美术同学每套模板请附上）

- [ ] `templates/<id>/`（manifest + html + css，可选 assets）
- [ ] 已在 `templates/index.json` 登记
- [ ] 票头 / 票尾按 §3.4 切好层次，`manifest.defaultDeco` 为每个槽位给了默认素材
- [ ] `node cli.js selftest` 全部通过
- [ ] 在 `examples/output/<id>.html` 里肉眼验收：编辑、切栏位 / 贴装饰、导出 PNG 都正常
- [ ] `status` 从 `placeholder` 改为 `ready`
- [ ] 在 `docs/版本记录.md` 记录一次模板版本（由项目负责人统一登记）
