/*!
 * 麦门日记 · 产物构建器（Node 端 · 零依赖）
 * ------------------------------------------------------------------
 * 职责：把「引擎 + 模板 + 数据」合成一个自包含的单文件 HTML 产物。
 * 产物特点：双击即可打开、可编辑、可导出 PNG / 打印，离线亦可用（图片导出依赖
 *          html2canvas，优先使用 src/vendor 下的本地副本，缺失时回退 CDN）。
 *
 * 用法见 cli.js：node cli.js build --all
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');            // skill/
const SRC_DIR = __dirname;                              // skill/src/
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const EXAMPLES_DIR = path.join(ROOT, 'examples');
const DECOS_DIR = path.join(SRC_DIR, 'decos');
const VENDOR_FILE = path.join(SRC_DIR, 'vendor', 'html2canvas.min.js');
const CDN_HTML2CANVAS = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
const mappers = require('./mappers.js');

/* ------------------------------ 小工具 ------------------------------ */

function readText(file) { return fs.readFileSync(file, 'utf8'); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function exists(p) { try { fs.accessSync(p); return true; } catch (e) { return false; } }
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/** 内联到 <script> 里的 JSON 必须转义 </，否则会提前闭合脚本标签 */
function safeJson(obj) { return JSON.stringify(obj).replace(/<\//g, '<\\/'); }

function get(obj, p) {
  if (!obj || !p) return undefined;
  const parts = String(p).split('.');
  let cur = obj;
  for (const k of parts) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/* ------------------------------ 模板加载 ------------------------------ */

function listTemplateIds() {
  const index = readJSON(path.join(TEMPLATES_DIR, 'index.json'));
  const list = (index.templates || []).slice();
  list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  return list.map(function (t) { return t.id; });
}

function loadTemplate(id) {
  const dir = path.join(TEMPLATES_DIR, id);
  if (!exists(dir)) throw new Error('模板目录不存在：templates/' + id);
  const manifestFile = path.join(dir, 'manifest.json');
  if (!exists(manifestFile)) throw new Error('模板缺少 manifest.json：templates/' + id);

  const manifest = readJSON(manifestFile);
  const entry = manifest.entry || 'template.html';
  if (!exists(path.join(dir, entry))) throw new Error('模板缺少入口文件：templates/' + id + '/' + entry);

  const html = readText(path.join(dir, entry));
  const styles = manifest.styles || ['template.css'];
  const css = styles.filter(function (f) { return exists(path.join(dir, f)); })
    .map(function (f) { return readText(path.join(dir, f)); })
    .join('\n');

  return { manifest, html, css, dir };
}

function loadAllTemplates() {
  return listTemplateIds().map(function (id) {
    const t = loadTemplate(id);
    return { manifest: t.manifest, html: t.html, css: t.css };
  });
}

/* ------------------------- 素材包（L2 皮肤 / L3 装饰） ------------------------- */

function inlineSkinTexture(skin) {
  if (!skin.textureFile) return skin;
  if (!/^textures\/[a-z0-9-]+\.png$/.test(skin.textureFile)) {
    throw new Error('纸张纹理路径不合法：' + skin.textureFile);
  }
  const file = path.join(DECOS_DIR, skin.textureFile);
  const png = fs.readFileSync(file);
  if (!png.length || png.length > 64 * 1024) {
    throw new Error('纸张纹理须为不超过 64KB 的 PNG：' + skin.textureFile);
  }
  return {
    ...skin,
    vars: {
      ...skin.vars,
      '--rct-texture': 'url("data:image/png;base64,' + png.toString('base64') + '")'
    }
  };
}

function inlineDecoPng(deco) {
  if (!deco.pngFile) return deco;
  if (deco.slot !== 'header-art' || deco.svg || !/^images\/[a-z0-9-]+\.png$/.test(deco.pngFile)) {
    throw new Error('位图头图配置不合法：' + deco.id);
  }
  const png = fs.readFileSync(path.join(DECOS_DIR, deco.pngFile));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 33 || png.length > 2 * 1024 * 1024 || !png.subarray(0, 8).equals(signature) ||
      png.toString('ascii', 12, 16) !== 'IHDR' || png[25] !== 6) {
    throw new Error('位图头图须为不超过 2MB 的透明 RGBA PNG：' + deco.pngFile);
  }
  return { ...deco, png: 'data:image/png;base64,' + png.toString('base64') };
}

/**
 * 三层可换模型的素材清单。全部为内置预设，页面不提供任何用户上传（D-022）。
 * 返回值直接喂给引擎的 catalog 选项。
 */
function loadCatalog() {
  const skinsFile = path.join(DECOS_DIR, 'skins.json');
  const decoFile = path.join(DECOS_DIR, 'deco.json');
  const avatarsFile = path.join(DECOS_DIR, 'avatars.json');
  const skins = exists(skinsFile) ? (readJSON(skinsFile).skins || []).map(inlineSkinTexture) : [];
  const decoPack = exists(decoFile) ? readJSON(decoFile) : { slots: [], deco: [] };
  const avatars = exists(avatarsFile) ? (readJSON(avatarsFile).avatars || []) : [];
  return {
    skins: skins,
    slots: decoPack.slots || [],
    deco: (decoPack.deco || []).map(inlineDecoPng),
    avatars: avatars,
    thumbs: loadThumbs()
  };
}

/** 入口卡横条缩略的尺寸上限：超过就不内联，免得单文件产物被撑爆 */
const THUMB_MAX_BYTES = 64 * 1024;

/** 左栏 3 个启用入口 ↔ 各自专属模板（与 panel.js 的 SOURCES 对应） */
const SOURCE_TEMPLATE = {
  orders: 'order-receipt',
  points: 'points-passbook',
  fun: 'fun-resume'
};

/**
 * 入口卡的横条缩略（`rail.thumb.<source>`）——**有素材才显示**。
 *
 * 美术把成品小票缩略图放成 `templates/<id>/thumb.png`，构建时自动 base64 内联进
 * payload（保持单文件自包含），左栏那一行就会出现；**没放就完全不渲染**，
 * 不留空框、不占高度。
 *
 * 之所以改成「有才显示」，是因为原先无条件渲染 6 个写着「缩略」的虚线空框，
 * 既没有信息量（用户选数据源时不关心小票长什么样），
 * 又把真正要点的展开区（订单卡）挤到屏幕外去了。
 */
function loadThumbs() {
  const out = {};
  Object.keys(SOURCE_TEMPLATE).forEach(function (sourceId) {
    const file = path.join(TEMPLATES_DIR, SOURCE_TEMPLATE[sourceId], 'thumb.png');
    if (!exists(file)) return;
    const buf = fs.readFileSync(file);
    if (!buf.length || buf.length > THUMB_MAX_BYTES) return;
    out[sourceId] = 'data:image/png;base64,' + buf.toString('base64');
  });
  return out;
}

/* ------------------------------ 页面合成 ------------------------------ */

function pageCss() {
  return [
    'html,body{margin:0;padding:0;background:#f4f1ec;}',
    'body{-webkit-text-size-adjust:100%;}',
    '.rct-app{padding-top:22px;}'
  ].join('\n');
}

function vendorTag() {
  if (exists(VENDOR_FILE)) return '<script>\n' + readText(VENDOR_FILE) + '\n</script>';
  return '<script src="' + CDN_HTML2CANVAS + '" crossorigin="anonymous"></script>';
}

/**
 * 生成一个完整的单文件页面。
 * @param {{title:string, templates:Array, data:object, templateId:string, chrome?:boolean}} opts
 */
function buildPage(opts) {
  const engineJs = readText(path.join(SRC_DIR, 'engine.js'));
  const engineCss = readText(path.join(SRC_DIR, 'engine.css'));
  const catalog = opts.catalog || loadCatalog();
  const multi = (opts.templates || []).length > 1;
  const payload = {
    templates: opts.templates,
    data: opts.data,
    catalog: catalog,
    templateId: opts.templateId,
    templateSwitch: multi,          // 只有一套模板就不给用户一个只有一项的下拉框
    chrome: opts.chrome !== false
  };

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(opts.title) + '</title>',
    '<style>',
    pageCss(),
    engineCss,
    '</style>',
    '</head>',
    '<body>',
    '<div id="receipt-app" class="rct-app"></div>',
    vendorTag(),
    '<script>window.__RECEIPT__ = ' + safeJson(payload) + ';</script>',
    '<script>',
    engineJs,
    '</script>',
    '<script>',
    '(function () {',
    '  var cfg = window.__RECEIPT__;',
    '  var engine = window.McdReceipt.create({',
    '    container: document.getElementById("receipt-app"),',
    '    templates: cfg.templates,',
    '    catalog: cfg.catalog,',
    '    data: cfg.data,',
    '    templateId: cfg.templateId,',
    '    chrome: cfg.chrome !== false,',
    '    templateSwitch: cfg.templateSwitch !== false',
    '  });',
    '  engine.mountChrome();',
    '  engine.render();',
    '  window.__engine = engine;',
    '})();',
    '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

/** 单个模板 → 单文件产物 */
function buildProduct(templateId, data) {
  const t = loadTemplate(templateId);
  return buildPage({
    title: '麦门日记 · ' + (t.manifest.name || t.manifest.id),
    templates: [{ manifest: t.manifest, html: t.html, css: t.css }],
    data: data,
    templateId: t.manifest.id
  });
}

/** 全模板 → 模板工作台（含模板切换下拉） */
function buildGallery(data, templateId) {
  const templates = loadAllTemplates();
  if (!templates.length) throw new Error('templates/index.json 中没有登记任何模板');
  return buildPage({
    title: '麦门日记 · 模板画廊',
    templates: templates,
    data: data,
    templateId: templateId || templates[0].manifest.id
  });
}

/* ------------------- 工作台（左数据源 + 中小票 + 右编辑装饰） ------------------- */

/**
 * 主入口产物：三栏工作台。
 *   ① 左栏「数据源」：3 类常用数据入口（每类 1:1 绑定一套专属模板，不用下拉框）
 *   ② 中栏「小票舞台」：面包屑 + 小票
 *   ③ 右栏「编辑与装饰」：栏位 / 纸色 / 装饰 / 头像 / 明细行 / 文案库
 * Agent 把 MCP 数据集传进来，用户在前端挑数据 → 生成小票 → 就地编辑与装饰。
 */
function buildWorkspace(dataset, opts) {
  const options = opts || {};
  const templates = loadAllTemplates();
  if (!templates.length) throw new Error('templates/index.json 中没有登记任何模板');
  const catalog = loadCatalog();

  const engineJs = readText(path.join(SRC_DIR, 'engine.js'));
  const engineCss = readText(path.join(SRC_DIR, 'engine.css'));
  const panelJs = readText(path.join(SRC_DIR, 'panel.js'));
  const panelCss = readText(path.join(SRC_DIR, 'panel.css'));
  const mappersJs = readText(path.join(SRC_DIR, 'mappers.js'));

  // 首屏默认展示：最近一单「有效」订单（跳过已取消，与左栏默认落点同源），
  // 没有订单则展示趣味统计。
  // ⚠️ 这里必须用 mappers.defaultOrderIndex，不能图省事写 orders[0]：
  //    左栏（panel）跳过废单、首屏（这里）不跳，用户就会看到
  //    「票面是已取消那单（无取餐码）、左栏高亮的是另一单」的错配。
  const orders = (dataset.sections && dataset.sections.orders) || [];
  const oi = mappers.defaultOrderIndex(orders);
  const initial = orders.length
    ? mappers.mapOrderDetail(orders[oi], orders[oi].detail, dataset.account)
    : mappers.mapFun(dataset, {});
  const defaultTpl = options.templateId || (orders.length ? 'order-receipt' : 'fun-resume');
  const templateId = templates.some(t => t.manifest.id === defaultTpl)
    ? defaultTpl : templates[0].manifest.id;

  const payload = {
    mode: 'workspace',
    templates,
    dataset,
    catalog,
    initialReceipt: initial,
    templateId,
    chrome: options.chrome !== false
  };

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(options.title || '麦门日记 · 文创小票生成器') + '</title>',
    '<style>',
    pageCss(),
    engineCss,
    panelCss,
    '</style>',
    '</head>',
    '<body>',
    '<div class="rct-workspace">',
    '  <aside id="data-rail" class="rct-rail" data-role="data-rail"></aside>',
    '  <div class="rct-main">',
    '    <div class="rct-crumb" data-role="crumb"></div>',
    '    <main id="receipt-app" class="rct-app"></main>',
    '  </div>',
    '  <aside id="deco-editor" class="rct-editor" data-role="deco-editor"></aside>',
    '</div>',
    vendorTag(),
    '<script>window.__RECEIPT__ = ' + safeJson(payload) + ';</script>',
    '<script>',
    engineJs,
    '</script>',
    '<script>',
    mappersJs,
    '</script>',
    '<script>',
    panelJs,
    '</script>',
    '<script>',
    '(function () {',
    '  var cfg = window.__RECEIPT__;',
    '  var engine = window.McdReceipt.create({',
    '    container: document.getElementById("receipt-app"),',
    '    templates: cfg.templates,',
    '    catalog: cfg.catalog,',
    '    data: cfg.initialReceipt,',
    '    templateId: cfg.templateId,',
    '    chrome: cfg.chrome !== false,',
    '    templateSwitch: false',        // 三栏模式下不用下拉框选模板，由左栏数据源决定
    '  });',
    '  engine.mountChrome();',
    '  var panel = window.McdPanel.create({',
    '    railEl: document.getElementById("data-rail"),',
    '    editorEl: document.getElementById("deco-editor"),',
    '    crumbEl: document.querySelector("[data-role=crumb]"),',
    '    dataset: cfg.dataset,',
    '    templates: cfg.templates,',
    '    mappers: window.McdMappers,',
    '    catalog: cfg.catalog,          // 入口卡横条缩略（有素材才有）走这里',
    '    engine: engine,',
    '    active: "orders",',
    '    onSelect: function (result) {',
    '      if (result.templateId) engine.setTemplate(result.templateId);',
    '      engine.loadJson(result.receipt);',
    '      panel.renderCrumb();',
    '      panel.renderEditor();          // 新模板的栏位 / 装饰槽会变，右栏必须重画',
    '    }',
    '  });',
    '  // 引擎侧的任何改动（换纸色 / 开关栏位 / 贴装饰）都同步回右栏高亮',
    '  var syncing = false;',
    '  engine.on("change", function () {',
    '    if (syncing) return;',
    '    syncing = true;',
    '    try { panel.renderEditor(); panel.renderCrumb(); } finally { syncing = false; }',
    '  });',
    '  engine.render();',
    '  panel.render();',
    '  window.__engine = engine;',
    '  window.__panel = panel;',
    '})();',
    '</script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

/** 一键构建：工作台（index.html）+ 各模板产物 + 模板画廊 */
function buildAll(dataFile, datasetFile) {
  const dataPath = dataFile || path.join(EXAMPLES_DIR, 'demo-data.json');
  const datasetPath = datasetFile || path.join(EXAMPLES_DIR, 'demo-dataset.json');
  const data = readJSON(dataPath);
  const dataset = readJSON(datasetPath);
  const written = [];

  // ① 主入口：工作台（数据面板 + 小票）
  written.push(writeFile(path.join(ROOT, 'index.html'), buildWorkspace(dataset)));
  // ② 单模板产物：用于模板验收
  listTemplateIds().forEach(function (id) {
    written.push(writeFile(path.join(EXAMPLES_DIR, 'output', id + '.html'), buildProduct(id, data)));
  });
  // ③ 模板画廊
  written.push(writeFile(path.join(EXAMPLES_DIR, 'output', 'gallery.html'), buildGallery(data)));
  return { data: dataPath, dataset: datasetPath, files: written };
}

/* ------------------------------ 数据校验 ------------------------------ */

const REQUIRED_TOP = ['meta', 'store', 'order', 'items', 'amounts', 'journal'];
const NUMBER_KEYS = ['qty', 'unitPrice', 'amount'];

function validateData(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['数据不是对象'], warnings: warnings };
  }
  REQUIRED_TOP.forEach(function (k) {
    if (data[k] === undefined) errors.push('缺少必填顶层字段：' + k);
  });
  if (!Array.isArray(data.items)) {
    errors.push('items 必须是数组');
  } else {
    data.items.forEach(function (it, i) {
      if (!it || typeof it !== 'object') { errors.push('items[' + i + '] 不是对象'); return; }
      if (!it.name) errors.push('items[' + i + '].name 缺失');
      if (it.amount === undefined) errors.push('items[' + i + '].amount 缺失');
      NUMBER_KEYS.forEach(function (k) {
        if (it[k] !== undefined && typeof it[k] !== 'number') warnings.push('items[' + i + '].' + k + ' 建议为数字');
      });
    });
  }
  if (data.amounts && typeof data.amounts !== 'object') errors.push('amounts 必须是对象');
  if (data.journal && typeof data.journal !== 'object') errors.push('journal 必须是对象');
  if (data.paper !== undefined && (!data.paper || ['strip', 'scallop', 'tearoff'].indexOf(data.paper.id) === -1)) {
    errors.push('paper.id 必须是 strip、scallop 或 tearoff');
  }
  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

/* ------------------------------ 模板契约检查 ------------------------------ */

/** 提取模板中的字段路径标注 */
function collectFields(html) {
  const out = [];
  const re = /data-field\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * 模板 QA：
 *  - 结构契约：data-repeat 内必须有 data-repeat-item
 *  - 安全契约：模板不得包含 <script>
 *  - 数据契约：带点的路径应能在示例数据中解析（裸名属循环体内字段，跳过）
 */
function checkTemplate(id, demoData) {
  const problems = [];
  const notes = [];
  let t;
  try { t = loadTemplate(id); } catch (e) { return { id: id, ok: false, problems: [e.message], notes: [] }; }

  const m = t.manifest;
  // 剥离 HTML 注释后再做契约检查：注释里可能写着「禁止 <script>」这类说明文字
  const markup = t.html.replace(/<!--[\s\S]*?-->/g, '');
  ['id', 'name', 'version', 'entry'].forEach(function (k) {
    if (!m[k]) problems.push('manifest.json 缺少字段：' + k);
  });
  if (m.id && m.id !== id) problems.push('manifest.id（' + m.id + '）与目录名（' + id + '）不一致');
  if (/<script[\s>]/i.test(markup)) problems.push('模板 HTML 不得包含 <script>（脚本由引擎统一管理）');
  if (!/data-field/.test(markup)) problems.push('模板没有任何 data-field 标注，无法取数');
  if (/class\s*=\s*"[^"]*\brct-scope\b/.test(markup)) problems.push('模板内不要自己写 rct-scope 容器（引擎会自动包裹）');

  // 合规红线自动守卫：官方商品图只允许出现在左栏数据实例里帮用户辨认订单，
  // **绝不能进小票**（决策 D-021）。静态拦截比事后 review 可靠。
  if (/data-(field|repeat)[^>]*=[^>]*\b(image|productImage)\b/i.test(markup)) {
    problems.push('模板不得引用商品图字段（image / productImage）—— 官方商品图只出现在左栏，不进小票（D-021 合规红线）');
  }
  if (/<img[\s>]/i.test(markup)) {
    problems.push('模板不得使用 <img> 标签 —— 小票保持纯文字版式，装饰一律用内联 SVG（D-021 合规红线）');
  }

  // 心情 emoji 已从产品里移除（决策 D-031）：彩色 emoji 与手绘/票据版式不兼容，
  // 也没有真实数据支撑。静态拦截，防止模板或美术版式把它加回来。
  if (/data-kind\s*=\s*"mood"/i.test(markup)) {
    problems.push('模板不得再出现心情 emoji（data-kind="mood"）—— 该特性已于 v0.3.5 整体移除（D-031）');
  }

  // repeat 契约
  const repeatRe = /<([a-zA-Z0-9-]+)[^>]*data-repeat\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  let rm;
  let repeatCount = 0;
  while ((rm = repeatRe.exec(markup))) {
    repeatCount++;
    if (!/data-repeat-item/.test(rm[3])) problems.push('data-repeat="' + rm[2] + '" 内缺少 data-repeat-item 标记');
  }
  if (m.capabilities && m.capabilities.repeat === false && repeatCount) notes.push('manifest 声明不支持循环，但模板里有 data-repeat');

  // 数据契约：可解析性
  const fields = collectFields(markup);
  fields.forEach(function (p) {
    if (p.indexOf('.') === -1) return;                                   // 循环体内字段
    if (!/^[a-zA-Z0-9_.]+$/.test(p)) return;                             // 非常规路径，跳过
    if (get(demoData, p) === undefined) notes.push('示例数据中无此字段（模板里写了但数据没给，会显示为空）：' + p);
  });

  // 样式作用域
  if (t.css && !new RegExp('\\.rct-scope--' + id).test(t.css)) {
    notes.push('template.css 建议以 .rct-scope--' + id + ' 作为作用域根（避免影响其它模板）');
  }

  // 字体栈硬约束（D-037）：PNG 导出走 html2canvas，它会把 font-family 的**每一段都加引号**
  // 再交给 canvas。泛型家族（serif / sans-serif / monospace）一旦被加引号，canvas 就不再把它
  // 当泛型解析，找不到对应字体 → 中文回退到另一套字体，单字宽随之改变。
  // 现象：导出 PNG 后票面文字「字距被拉开、笔画变细、断行点位移」，与页面不一致。
  // 因此每条 font-family 都必须显式列出至少一个真实存在的中文字体名兜底。
  const CJK_FONT = /(PingFang\s*SC|Hiragino\s+Sans\s+GB|Heiti\s*SC|Songti\s*SC|STSong|STKaiti|STHeiti|STFangsong|SimSun|NSimSun|SimHei|SimKai|KaiTi|Microsoft\s+YaHei|Microsoft\s+JhengHei|Noto\s+Sans\s+(?:CJK\s+)?SC|Source\s+Han\s+Sans|WenQuanYi|MiSans|HarmonyOS\s+Sans)/i;
  const inlineStyles = [];
  markup.replace(/style\s*=\s*"([^"]*)"/gi, function (all, s) { inlineStyles.push(s); return all; });
  const ffSource = (t.css || '') + '\n' + inlineStyles.join(';\n');
  const ffRe = /font-family\s*:\s*([^;}]+)/gi;
  let ffm;
  while ((ffm = ffRe.exec(ffSource))) {
    const decl = ffm[1].trim();
    if (decl && !CJK_FONT.test(decl)) {
      problems.push('font-family 必须以显式中文字体名兜底（如 "PingFang SC" / "Microsoft YaHei" / SimSun），' +
        '否则导出 PNG 时中文会回退到别的字体、与页面排版不一致（D-037）：' + decl);
    }
  }

  // 导出安全硬约束（D-039）：PNG 导出走 html2canvas 1.4.1，它**不认识 mask / clip-path**，
  // 会静默忽略（不报错、不警告）——页面看着轮廓剪得好好的，导出的图却回到矩形硬边。
  // 这类缺陷在页面上完全看不出来，只能靠静态拦截 + 第 6 段门禁。
  // 替代手法：圆角用 border-radius（html2canvas 支持）；异形轮廓用**内联 SVG**（实测可保留）。
  const MASK_SOURCE = (t.css || '') + '\n' + inlineStyles.join(';\n');
  const maskRe = /(?:^|[;{\s])(?:-webkit-|-moz-|-ms-)?(mask|mask-image|mask-border|clip-path)\s*:/gi;
  let mm;
  const maskHits = [];
  while ((mm = maskRe.exec(MASK_SOURCE))) {
    if (maskHits.indexOf(mm[1]) === -1) maskHits.push(mm[1]);
  }
  if (maskHits.length) {
    problems.push('模板不得使用 ' + maskHits.join(' / ') + ' 做轮廓或裁切 —— html2canvas 会静默忽略，' +
      '页面正常但导出 PNG 丢轮廓（D-039）。圆角改用 border-radius；异形轮廓改用内联 SVG（path / pattern）');
  }

  // 手账体验
  if (!/data-kind\s*=\s*"note"/.test(t.html)) notes.push('建议为碎碎念字段标注 data-kind="note"（支持多行）');

  return { id: id, ok: problems.length === 0, problems: problems, notes: notes, fields: fields.length, status: m.status || '待标注' };
}

function checkAllTemplates(demoData) {
  return listTemplateIds().map(function (id) { return checkTemplate(id, demoData); });
}

/* ------------------------------ 数据集校验 ------------------------------ */

// 活动 / 联名周边 / 战利品分区已退役；旧数据集仍可带这些字段，但不再强制拉取。
const REQUIRED_SECTIONS = ['orders'];

function validateDataset(ds) {
  const errors = [];
  const warnings = [];
  if (!ds || typeof ds !== 'object' || Array.isArray(ds)) return { ok: false, errors: ['数据集不是对象'], warnings };
  if (ds.version === undefined) errors.push('缺少 version');
  if (!ds.generatedAt) errors.push('缺少 generatedAt');
  if (['mcp', 'demo'].indexOf(ds.source) === -1) errors.push('source 必须是 mcp 或 demo');
  if (!isObj(ds.sections)) {
    errors.push('缺少 sections 对象');
    return { ok: false, errors, warnings };
  }
  REQUIRED_SECTIONS.forEach(function (k) {
    if (ds.sections[k] === undefined) errors.push('sections 缺少分区：' + k + '（空数组也要保留）');
    else if (!Array.isArray(ds.sections[k])) errors.push('sections.' + k + ' 必须是数组');
  });
  (ds.sections.orders || []).forEach(function (o, i) {
    ['id', 'datetime', 'storeName'].forEach(function (k) {
      if (!o[k]) errors.push('orders[' + i + '] 缺少 ' + k);
    });
    if (o.total === undefined) warnings.push('orders[' + i + '] 缺少 total（小票金额会为 0）');
  });
  // 敏感信息哨兵：数据集不得携带完整订单号
  (ds.sections.orders || []).forEach(function (o, i) {
    if (typeof o.id === 'string' && /^\d{15,}$/.test(o.id)) {
      errors.push('orders[' + i + '].id 疑似完整订单号，请脱敏为 F- + 后 6 位');
    }
  });
  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------ 映射器校验 ------------------------------ */

/**
 * 对三类启用来源各跑一遍映射，确保「选择数据 → 生成小票」链路畅通，
 * 且产出的 receipt 依然符合数据契约。这是左栏数据源与专属模板之间的兼容性门禁。
 */
function checkMappers(ds) {
  const reports = [];
  const orders = (ds.sections && ds.sections.orders) || [];
  const oi = mappers.defaultOrderIndex(orders);
  const primary = orders[oi] || {};
  const cases = [
    { kind: 'order', run: function () { return mappers.mapOrderDetail(primary, primary.detail, ds.account); } },
    { kind: 'points', run: function () { return mappers.mapPoints(ds.account || {}, orders); } },
    { kind: 'fun', run: function () { return mappers.mapFun(ds, {}); } }
  ];
  cases.forEach(function (c) {
    const problems = [];
    let receipt = null;
    try { receipt = c.run(); } catch (e) { problems.push('映射抛错：' + e.message); }
    if (receipt) {
      const v = validateData(receipt);
      v.errors.forEach(function (e) { problems.push(e); });
      if (receipt.meta.kind !== c.kind) problems.push('meta.kind 应为 ' + c.kind + '，实际 ' + receipt.meta.kind);
      if (!receipt.items.length && !(receipt.summary || []).length && !(receipt.stats || []).length) {
        problems.push('没有产出任何内容（items / summary / stats 全为空）');
      }
    }
    reports.push({ kind: c.kind, ok: problems.length === 0, problems: problems });
  });

  /* 首屏落点一致性（F-22）：工作台首屏（builder）与左栏默认选中（panel）必须同源，
     否则会出现「票面渲染 A 单、左栏高亮 B 单」——用户看到的取餐码就这样丢的。 */
  const ws = [];
  if (orders.length) {
    if (mappers.isVoidOrder(primary) && orders.some(function (o) { return !mappers.isVoidOrder(o); })) {
      ws.push('默认落到了废单「' + String(primary.status || '') + '」，但存在有效订单可选（应跳过废单）');
    }
    if (!primary.detail && orders.some(function (o) { return o.detail && !mappers.isVoidOrder(o); })) {
      ws.push('默认落点订单（索引 ' + oi + '）没有 detail，但存在带明细的有效订单：' +
        '首屏会静默降级为整单版式，取餐码 / 单价 / 优惠明细全部缺失');
    }
    const receipt = mappers.mapOrderDetail(primary, primary.detail, ds.account);
    const code = primary.detail && primary.detail.pickupCode;
    if (code && String(receipt.meta.badge || '').indexOf(code) === -1) {
      ws.push('该单有取餐码 ' + code + '，但首屏 badge 未带出（实际 ' + JSON.stringify(receipt.meta.badge) + '）');
    }
    if (String(primary.status || '') === '已完成' && code && !receipt.meta.badge) {
      ws.push('已完成订单缺取餐码徽标，票头会少一行');
    }
  }
  reports.push({ kind: '首屏落点（工作台默认单 / 取餐码）', ok: ws.length === 0, problems: ws });

  return reports;
}

/* ------------------------------ 素材包校验 ------------------------------ */

/** 内联 SVG 安全白名单：与引擎 safeSvg() 保持一致 */
const SAFE_SVG = /^<svg[\s\S]*<\/svg>$/i;
const UNSAFE_SVG = /<script|foreignObject|<image|<use\b/i;

/** 校验皮肤 / 装饰 / 头像三类素材是否符合 decor.schema.json 的硬约束 */
function checkCatalog(catalog) {
  const cat = catalog || loadCatalog();
  const problems = [];
  const notes = [];

  if (!cat.skins.length) problems.push('皮肤素材为空（skins.json 未加载或没有条目）');
  cat.skins.forEach(function (s, i) {
    if (!s.id || !s.name) problems.push('skins[' + i + '] 缺少 id 或 name');
    Object.keys(s.vars || {}).forEach(function (k) {
      if (k.indexOf('--rct-') !== 0) problems.push('skins[' + i + '] 变量名须以 --rct- 开头：' + k);
    });
    if (!s.vars || !s.vars['--rct-paper']) problems.push('skins[' + i + '] 缺少 --rct-paper');
  });

  if (!cat.slots.length) problems.push('装饰槽位为空（deco.json 缺少 slots）');
  const slotIds = cat.slots.map(function (s) { return s.id; });
  if (!cat.deco.length) problems.push('装饰素材为空（deco.json 缺少 deco）');
  cat.deco.forEach(function (d, i) {
    if (!d.id || !d.name || !d.slot) problems.push('deco[' + i + '] 缺少 id / name / slot');
    if (slotIds.indexOf(d.slot) === -1) problems.push('deco[' + i + '] 的 slot 未在 slots 中登记：' + d.slot);
    if (d.pngFile) {
      if (d.slot !== 'header-art' || d.svg || !/^images\/[a-z0-9-]+\.png$/.test(d.pngFile) ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(d.png || '')) {
        problems.push('deco[' + i + ']（' + d.id + '）不是合法的内置 PNG 头图');
      }
    } else if (!SAFE_SVG.test(String(d.svg || '').trim())) problems.push('deco[' + i + ']（' + d.id + '）不是合法的内联 <svg>');
    else if (UNSAFE_SVG.test(d.svg)) problems.push('deco[' + i + ']（' + d.id + '）含禁用标签（script/foreignObject/image/use）');
  });

  // 头像素材：v0.3.4 起界面已移除头像入口（D-030），故**不再要求素材包必须存在**；
  // 有则校验其合法性，没有就跳过（不再判红）。
  cat.avatars.forEach(function (a, i) {
    if (!a.id || !a.name) problems.push('avatars[' + i + '] 缺少 id 或 name');
    if (!SAFE_SVG.test(String(a.svg || '').trim())) problems.push('avatars[' + i + ']（' + a.id + '）不是合法的内联 <svg>');
    else if (UNSAFE_SVG.test(a.svg)) problems.push('avatars[' + i + ']（' + a.id + '）含禁用标签');
  });

  // 模板里的 data-slot 必须在 slots 里登记，否则右栏找不到素材
  listTemplateIds().forEach(function (id) {
    let t;
    try { t = loadTemplate(id); } catch (e) { return; }
    const found = {};
    const re = /data-slot\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(t.html))) found[m[1]] = true;
    Object.keys(found).forEach(function (s) {
      if (s === 'avatar') return;                       // 头像走 catalog.avatars 专用通道
      if (slotIds.indexOf(s) === -1) notes.push('模板 ' + id + ' 用了未登记的槽位 data-slot="' + s + '"');
    });
  });

  return { ok: problems.length === 0, problems: problems, notes: notes };
}

function demoDataset() { return readJSON(path.join(EXAMPLES_DIR, 'demo-dataset.json')); }
function demoData() { return readJSON(path.join(EXAMPLES_DIR, 'demo-data.json')); }

module.exports = {
  ROOT: ROOT,
  TEMPLATES_DIR: TEMPLATES_DIR,
  EXAMPLES_DIR: EXAMPLES_DIR,
  DECOS_DIR: DECOS_DIR,
  mappers: mappers,
  listTemplateIds: listTemplateIds,
  loadTemplate: loadTemplate,
  loadAllTemplates: loadAllTemplates,
  loadCatalog: loadCatalog,
  buildPage: buildPage,
  buildProduct: buildProduct,
  buildGallery: buildGallery,
  buildWorkspace: buildWorkspace,
  buildAll: buildAll,
  validateData: validateData,
  validateDataset: validateDataset,
  checkMappers: checkMappers,
  checkCatalog: checkCatalog,
  checkTemplate: checkTemplate,
  checkAllTemplates: checkAllTemplates,
  demoData: demoData,
  demoDataset: demoDataset,
  writeFile: writeFile
};
