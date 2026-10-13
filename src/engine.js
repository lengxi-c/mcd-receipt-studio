/*!
 * 麦门日记 · 渲染引擎  v0.3.0
 * ------------------------------------------------------------------
 * 设计原则：引擎与模板彻底解耦。
 *   模板只负责「长什么样」（HTML 结构 + CSS + data-field / data-block / data-slot 标注）；
 *   引擎负责「数据填充 / 就地编辑 / 金额联动 / 栏位开关 / 换皮肤 / 贴装饰 / 加头像 /
 *            明细行增删 / PNG 导出 / 工程 JSON 出入」。
 * 因此美术同学新增模板时，不需要改这一行引擎代码。
 *
 * 三层可换模型（详见 docs/小票编辑与装饰设计.md §4）：
 *   L1 骨架 = 模板 data-block 区块（可开关 / 可排序）
 *   L2 皮肤 = CSS 变量 var(--rct-*)（可换纸色）
 *   L3 装饰 = 模板 data-slot 槽位（从内置预设里挑，不提供上传）
 *
 * 浏览器端全局命名空间：window.McdReceipt
 * 数据契约见：src/receipt.schema.json　素材契约见：src/decor.schema.json
 */
(function (global) {
  'use strict';

  var VERSION = '0.3.0';

  /* ============================ 基础工具 ============================ */

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function get(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function set(obj, path, value) {
    if (!obj || !path) return;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (!isObj(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function clone(v) { return JSON.parse(JSON.stringify(v == null ? {} : v)); }

  /** 「这个值算不算有内容」—— 空数组 / 0 / 空串 / 全空白 都算没有（栏位灰锁判定，D-035） */
  function hasMeaning(v) {
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.replace(/\s/g, '') !== '';
    return !!v;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function money(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return '\u00a5' + n.toFixed(2);
  }

  function toDate(v) {
    if (v instanceof Date) return v;
    if (v == null || v === '') return null;
    var d = new Date(typeof v === 'string' ? v.replace(/-/g, '/') : v);
    if (isNaN(d.getTime())) d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(v, withTime) {
    var d = toDate(v);
    if (!d) return v == null ? '' : String(v);
    var s = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    if (withTime) s += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return s;
  }

  /** 格式化器：模板用 data-format="money" 等指定，未指定则原样输出 */
  var FORMATTERS = {
    money: money,
    date: function (v) { return fmtDate(v, false); },
    datetime: function (v) { return fmtDate(v, true); },
    monthday: function (v) {
      var s = fmtDate(v, false);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5, 7) + '.' + s.slice(8, 10) : s;
    },
    time: function (v) { var d = toDate(v); return d ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : ''; },
    qty: function (v) { return v == null || v === '' ? '1' : String(v); },
    number: function (v) { return v == null ? '' : String(v); },
    points: function (v) { return v == null || v === '' ? '\u79ef\u5206 \u2014' : '\u79ef\u5206 ' + v; },
    qty2: function (v) { return (v == null || v === '' ? '1' : String(v)) + ' \u4efd'; }
  };

  function formatValue(value, fmt) {
    if (fmt && FORMATTERS[fmt]) return FORMATTERS[fmt](value);
    if (value == null) return '';
    return String(value);
  }

  /** 文案库：麦门语录 / 碎碎念预设，全部原创、正面玩梗（F-06） */
  var PHRASES = [
    { group: '\u5FC3\u60C5', text: '\u4ECA\u5929\u4e5f\u662f\u88ab\u9EA6\u5F53\u52B3\u6CBB\u6108\u7684\u4E00\u5929\u3002' },
    { group: '\u5FC3\u60C5', text: '\u5FD9\u5230\u98DE\u8D77\u6765\uFF0C\u597D\u5728\u6709\u8FD9\u4E00\u987F\u3002' },
    { group: '\u5FC3\u60C5', text: '\u597D\u6D88\u8D39\u4E0D\u5982\u597D\u597D\u5403\u996D\u3002' },
    { group: '\u788E\u788E\u5FF5', text: '\u8FD9\u4E00\u987F\uFF0C\u503C\u5F97\u8BB0\u4E0B\u6765\u3002' },
    { group: '\u788E\u788E\u5FF5', text: '\u70B9\u5B8C\u5355\u5C31\u5F00\u5FC3\u4E86\u4E00\u534A\u3002' },
    { group: '\u788E\u788E\u5FF5', text: '\u4E0B\u6B21\u8FD8\u70B9\u8FD9\u4E2A\u3002' },
    { group: '\u9EA6\u95E8\u8BED\u5F55', text: '\u5C31\u559C\u6B22\u4F60\uFF0C\u6CA1\u9053\u7406\u3002' },
    { group: '\u9EA6\u95E8\u8BED\u5F55', text: '\u597D\u7684\u4E1C\u897F\u8981\u548C\u597D\u7684\u4EBA\u4E00\u8D77\u5403\u3002' },
    { group: '\u9EA6\u95E8\u8BED\u5F55', text: '\u4E00\u53E3\u4E0B\u53BB\uFF0C\u4E16\u754C\u90FD\u5B89\u9759\u4E86\u3002' }
  ];

  /* ============================ 引擎主体 ============================ */

  function Engine(options) {
    this.opts = options || {};
    this.container = this.opts.container;
    this.data = this.opts.data || {};
    this.templates = this.opts.templates || [];
    this.catalog = this.opts.catalog || { skins: [], deco: [], avatars: [] };
    this.currentId = this.opts.templateId || (this.templates[0] && this.templates[0].manifest.id);
    this.chrome = this.opts.chrome !== false;
    this.templateSwitch = this.opts.templateSwitch !== false;
    this.changed = false;
    this.origin = clone(this.data);
    this._listeners = {};
    if (!this.container) throw new Error('[McdReceipt] \u7f3a\u5c11 container');
    if (!this.templates.length) throw new Error('[McdReceipt] \u81f3\u5c11\u9700\u8981\u4e00\u4e2a\u6A21\u677F');
  }

  Engine.prototype.current = function () {
    for (var i = 0; i < this.templates.length; i++) {
      if (this.templates[i].manifest.id === this.currentId) return this.templates[i];
    }
    return this.templates[0];
  };

  /* ---------------------------- 渲染 ---------------------------- */

  Engine.prototype.render = function () {
    var tpl = this.current();
    var c = this.container;

    if (this.paperObserver) { this.paperObserver.disconnect(); this.paperObserver = null; }

    // 只清理上一次的「舞台」，保留工具条等常驻 UI
    if (this.styleEl && this.styleEl.parentNode) c.removeChild(this.styleEl);
    if (this.hostEl && this.hostEl.parentNode) c.removeChild(this.hostEl);
    var oldStyles = c.querySelectorAll('style[data-receipt-template]');
    for (var s = 0; s < oldStyles.length; s++) c.removeChild(oldStyles[s]);

    // 1) 模板样式隔离注入（切模板即重建，避免样式残留）
    var styleEl = document.createElement('style');
    styleEl.setAttribute('data-receipt-template', tpl.manifest.id);
    styleEl.textContent = tpl.css || '';
    c.appendChild(styleEl);

    // 2) 结构
    var host = document.createElement('div');
    host.className = 'rct-stage';
    var scope = document.createElement('div');
    scope.className = 'rct-scope rct-scope--' + tpl.manifest.id;
    scope.setAttribute('data-amount-mode', this.data.amounts && this.data.amounts.mode || 'items');
    scope.innerHTML = tpl.html;
    host.appendChild(scope);
    c.appendChild(host);

    this.styleEl = styleEl;
    this.hostEl = host;
    this.scopeEl = scope;

    // 3) 数据
    this._applyRepeats(scope);
    this._fill(scope);
    this._bind(scope);

    // 4) 三层可换模型
    this.renderDeco();
    this.applyAvatar();
    this.renderBlocks();
    this.applySkin(this.data.skin && this.data.skin.id);
    this.applyPaper(this.data.paper && this.data.paper.id, true);

    this._emit('render');
    return this;
  };

  Engine.prototype._applyRepeats = function (container) {
    var nodes = container.querySelectorAll('[data-repeat]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var list = get(this.data, node.getAttribute('data-repeat'));
      var itemTpl = node.querySelector('[data-repeat-item]') || node.firstElementChild;
      if (!itemTpl) continue;
      if (!Array.isArray(list)) list = [];
      var frag = document.createDocumentFragment();
      for (var j = 0; j < list.length; j++) {
        var row = itemTpl.cloneNode(true);
        row.removeAttribute('data-repeat-item');
        row.__scope = list[j];
        row.__index = j;
        frag.appendChild(row);
      }
      node.innerHTML = '';
      node.appendChild(frag);
    }
  };

  Engine.prototype._scopeOf = function (el) {
    var n = el;
    while (n && n !== this.scopeEl) {
      if (n.__scope) return n.__scope;
      n = n.parentElement;
    }
    return this.data;
  };

  Engine.prototype._rowIndexOf = function (el) {
    var n = el;
    while (n && n !== this.scopeEl) {
      if (typeof n.__index === 'number') return n.__index;
      n = n.parentElement;
    }
    return -1;
  };

  /** 解析路径：循环体内优先取行内字段（裸名），否则走全局路径 */
  Engine.prototype._resolve = function (path, scope) {
    if (!path) return '';
    if (scope && scope !== this.data && path.indexOf('.') === -1) return scope[path];
    return get(this.data, path);
  };

  Engine.prototype._fill = function (container) {
    var nodes = container.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var path = el.getAttribute('data-field');
      el.textContent = formatValue(this._resolve(path, this._scopeOf(el)), el.getAttribute('data-format'));
    }
    this._applyConds(container);
  };

  /**
   * 条件显隐（data-if）。单独抽出来，是因为它要能被三处复用：
   * _fill（首次渲染）、_refillAmounts（金额变动后）、renderBlocks（栏位重排后）。
   * 让 data-if 决定「有没有内容」，让 data-block 决定「用户开没开」，两者互不覆盖。
   */
  Engine.prototype._applyConds = function (container) {
    var scope = container || this.scopeEl;
    if (!scope) return this;
    var conds = scope.querySelectorAll('[data-if]');
    for (var i = 0; i < conds.length; i++) {
      var el = conds[i];
      var v = this._resolve(el.getAttribute('data-if'), this._scopeOf(el));
      el.style.display = (v === undefined || v === null || v === '' || v === false || v === 0) ? 'none' : '';
    }
    return this;
  };

  Engine.prototype._bind = function (container) {
    var self = this;
    var nodes = container.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      (function (el) {
        if (el.getAttribute('data-editable') === 'false') return;
        el.__scope = self._scopeOf(el);
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');

        el.addEventListener('input', function () { self._writeBack(el, el.textContent, false); });
        el.addEventListener('blur', function () { self._writeBack(el, el.textContent, true); });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && el.getAttribute('data-kind') !== 'note') {
            e.preventDefault();
            el.blur();
          }
        });
      })(nodes[i]);
    }
    var notes = container.querySelectorAll('[data-kind="note"]');
    for (var j = 0; j < notes.length; j++) notes[j].style.whiteSpace = 'pre-wrap';
  };

  Engine.prototype._writeBack = function (el, raw, normalize) {
    var path = el.getAttribute('data-field');
    var fmt = el.getAttribute('data-format');
    var scope = el.__scope || this.data;
    var value = raw == null ? '' : String(raw);

    if (fmt === 'money' || fmt === 'qty' || fmt === 'number' || fmt === 'qty2') {
      var num = parseFloat(value.replace(/[^\d.\-]/g, ''));
      value = isFinite(num) ? num : 0;
    }
    if (scope !== this.data && path.indexOf('.') === -1) scope[path] = value;
    else set(this.data, path, value);

    this.changed = true;
    if (normalize) el.textContent = formatValue(value, fmt);

    if (this._isAmountPath(path, scope)) {
      this.recalc();
      this._refillAmounts();
    }
    this._emit('change');
  };

  Engine.prototype._isAmountPath = function (path, scope) {
    if (/^(items|amounts|coupons)/.test(path)) return true;
    if (scope && scope !== this.data && /^(amount|unitPrice|qty)$/.test(path)) return true;
    return false;
  };

  /**
   * 金额重算。三种模式（amounts.mode）：
   *  · "items"（默认）：subtotal = Σ items.amount；实付 = 小计 − 优惠 + 运费
   *  · "order"：整单金额模式，品项不分摊金额（历史订单只有整单总价）
   *  · "detail"：明细版（品项有真实单价），另保留 listPrice 作原价合计
   *
   * ⚠️ detail 模式必须补上打包费/餐具费，否则对不齐真实账单：
   *   麦当劳账单恒等式 = 商品小计 + 配送费 + 打包费 + 餐具费 − 优惠 = 实付
   *   例：67.9 + 6 + 1.9 + 0 − 13.01 = 62.79（F-9，2026-10-12 实测发现）
   */
  Engine.prototype.recalc = function () {
    var d = this.data;
    if (!isObj(d.amounts)) d.amounts = {};
    var isDetail = d.amounts.mode === 'detail';
    var mode = d.amounts.mode === 'order' ? 'order' : 'items';
    var discount = Number(d.amounts.discount) || 0;
    var delivery = Number(d.amounts.delivery) || 0;

    if (mode === 'order') {
      if (d.amounts.subtotal === undefined || d.amounts.subtotal === null) {
        d.amounts.subtotal = Number(d.amounts.total) || 0;
      }
      var sub0 = Number(d.amounts.subtotal) || 0;
      d.amounts.total = Math.round((sub0 - discount + delivery) * 100) / 100;
      return d.amounts;
    }

    var items = Array.isArray(d.items) ? d.items : [];
    var itemSum = 0;
    for (var i = 0; i < items.length; i++) itemSum += Number(items[i] && items[i].amount) || 0;
    d.amounts.subtotal = Math.round(itemSum * 100) / 100;

    var extra = 0;
    if (isDetail) {
      var f = isObj(d.fees) ? d.fees : {};
      extra = (Number(f.packing) || 0) + (Number(f.tableware) || 0);
    }
    d.amounts.total = Math.round((d.amounts.subtotal + delivery + extra - discount) * 100) / 100;
    return d.amounts;
  };

  Engine.prototype._refillAmounts = function () {
    var nodes = this.scopeEl.querySelectorAll('[data-field]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (document.activeElement === el) continue;
      var path = el.getAttribute('data-field');
      var scope = this._scopeOf(el);
      if (!this._isAmountPath(path, scope)) continue;
      el.textContent = formatValue(this._resolve(path, scope), el.getAttribute('data-format'));
    }
    // 条件行可能在金额变化后需要重新显隐
    this._applyConds(this.scopeEl);
  };

  /* ======================== L1 骨架：栏位（blocks） ======================== */

  /** 扫描当前模板里声明的栏位 */
  Engine.prototype.scanBlocks = function () {
    var out = [];
    if (!this.scopeEl) return out;
    var nodes = this.scopeEl.querySelectorAll('[data-block]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var id = el.getAttribute('data-block');
      if (!id) continue;
      out.push({
        id: id,
        name: el.getAttribute('data-block-name') || id,
        optional: el.getAttribute('data-block-optional') === 'true',
        lock: el.getAttribute('data-block-lock') === 'true',
        require: el.getAttribute('data-block-require') || '',
        order: i
      });
    }
    return out;
  };

  /**
   * 栏位是否有数据支撑（D-035）：模板用 data-block-require="a.b,c.d" 声明依赖，
   * 逗号分隔、任一有值即算可用；没声明的一律可用。没有数据支撑的栏位在右栏灰锁，
   * 且票面上自动隐藏 —— 避免「打开一个永远空着的栏位」。
   */
  Engine.prototype._blockActive = function (b) {
    if (!b.require) return true;
    var paths = String(b.require).split(',');
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i].replace(/\s/g, '');
      if (!p) continue;
      if (hasMeaning(get(this.data, p))) return true;
    }
    return false;
  };

  /** 右栏「栏位」面板的数据源：模板声明 + 当前状态（含默认值） */
  Engine.prototype.getBlocks = function () {
    var self = this;
    var declared = this.scanBlocks();
    var cfg = this.data.blocks;
    var map = {};
    if (Array.isArray(cfg)) cfg.forEach(function (b) { if (b && b.id) map[b.id] = b; });
    return declared.map(function (b) {
      var c = map[b.id] || {};
      var active = self._blockActive(b);
      return {
        id: b.id,
        name: b.name,
        optional: b.optional,
        lock: b.lock,
        require: b.require,
        active: active,
        // 无数据支撑 → 强制不可见（右栏同步灰锁）
        visible: b.lock ? true : (!active ? false : (c.visible === undefined ? true : !!c.visible)),
        order: c.order === undefined ? b.order : c.order
      };
    });
  };

  Engine.prototype.renderBlocks = function () {
    if (!this.scopeEl) return this;
    var blocks = this.getBlocks();
    var cfg = {};
    blocks.forEach(function (b) { cfg[b.id] = b; });

    // 先让 data-if 决定「有没有内容」，再让栏位开关只做「关」这一件事。
    // 顺序很重要：否则「用户手动打开一个有 data-if 的空栏位」会把它强行显示成空白块。
    this._applyConds(this.scopeEl);

    var nodes = this.scopeEl.querySelectorAll('[data-block]');
    var groups = {};   // parent → [el]
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var id = el.getAttribute('data-block');
      var c = cfg[id];
      if (!c) continue;
      if (!c.visible) el.style.display = 'none';
      // 可见时：没有 data-if 就显式显示；有 data-if 的交给 _applyConds 的判定结果
      else if (!el.hasAttribute('data-if')) el.style.display = '';
      el.setAttribute('data-block-visible', c.visible ? 'true' : 'false');
      var p = el.parentElement;
      if (!p) continue;
      if (!p.__rctBlockKey) p.__rctBlockKey = 'p' + (Object.keys(groups).length + 1);
      (groups[p.__rctBlockKey] = groups[p.__rctBlockKey] || []).push({ el: el, order: c.order, i: i });
    }
    Object.keys(groups).forEach(function (k) {
      var arr = groups[k];
      var parent = arr[0].el.parentElement;
      arr.sort(function (a, b) { return (a.order - b.order) || (a.i - b.i); });

      var sorted = arr.map(function (it) { return it.el; });
      var kids = Array.prototype.slice.call(parent.children);
      var others = kids.filter(function (el) { return sorted.indexOf(el) === -1; });

      // F-20：parent 下可能还有「不带 data-block 的普通子元素」（如票尾装饰容器 rcpt__foot）。
      // 它们不参与栏位排序，位置必须原位保留 —— 若直接用 appendChild 把栏位逐个挪到末尾，
      // 这些元素会「相对上浮」到最前面，与票头重叠（v0.4.1 实测踩到）。
      // 正确做法：others 保持原索引不动，排序后的栏位按序填回其余位置。
      if (others.length + sorted.length === kids.length) {
        var si = 0;
        var seq = kids.map(function (el) {
          return sorted.indexOf(el) === -1 ? el : sorted[si++];
        });
        seq.forEach(function (el) { parent.appendChild(el); });
      } else {
        sorted.forEach(function (el) { parent.appendChild(el); });
      }
    });

    this.data.blocks = blocks.map(function (b) {
      return { id: b.id, visible: b.visible, order: b.order };
    });
    return this;
  };

  Engine.prototype.setBlockVisible = function (id, visible) {
    var list = this.getBlocks();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        if (list[i].lock) return this;        // 锁定栏位不可关
        if (!list[i].active) return this;     // 数据里没有这项内容 → 不可开启（D-035）
        list[i].visible = !!visible;
      }
    }
    this.data.blocks = list.map(function (b) { return { id: b.id, visible: b.visible, order: b.order }; });
    this.renderBlocks();
    this.changed = true;
    this._emit('change');
    return this;
  };

  Engine.prototype.moveBlock = function (id, dir) {
    var list = this.getBlocks();
    list.sort(function (a, b) { return a.order - b.order; });
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) idx = i;
    if (idx < 0) return this;
    var target = idx + (dir < 0 ? -1 : 1);
    if (target < 0 || target >= list.length) return this;
    var tmp = list[idx];
    list[idx] = list[target];
    list[target] = tmp;
    list.forEach(function (b, i) { b.order = i; });
    this.data.blocks = list.map(function (b) { return { id: b.id, visible: b.visible, order: b.order }; });
    this.renderBlocks();
    this.changed = true;
    this._emit('change');
    return this;
  };

  /* ======================== L2 皮肤：CSS 变量 ======================== */

  Engine.prototype.listSkins = function () { return (this.catalog.skins || []).slice(); };

  Engine.prototype.applySkin = function (skinId) {
    if (!this.scopeEl) return this;
    var skins = this.catalog.skins || [];
    var skin = null;
    for (var i = 0; i < skins.length; i++) if (skins[i].id === skinId) skin = skins[i];
    if (!skin && skins.length) skin = skins[0];
    if (!skin) return this;

    // 清除旧的皮肤变量
    var old = (this.data.skin && this.data.skin.vars) || {};
    Object.keys(old).forEach(function (k) { this.scopeEl.style.removeProperty(k); }, this);

    Object.keys(skin.vars || {}).forEach(function (k) {
      this.scopeEl.style.setProperty(k, skin.vars[k]);
    }, this);
    this.scopeEl.setAttribute('data-skin', skin.id);

    this.data.skin = { id: skin.id, vars: clone(skin.vars || {}) };
    this.changed = true;
    this._emit('change');
    return this;
  };

  /* ======================== 纸型：仅历史点单小票 ======================== */

  var PAPERS = [
    { id: 'strip', name: '\u6807\u51c6\u957f\u6761' },
    { id: 'scallop', name: '\u534a\u5706\u952f\u9f7f\u8fb9' },
    { id: 'tearoff', name: '\u53ef\u6495\u7968\u6839' }
  ];

  /** 一份路径供屏幕裁切与 PNG 透明裁切共用。反向子路径挖出可撕票根的圆孔。 */
  function paperPath(width, height, tearY) {
    var w = Math.max(1, width), h = Math.max(1, height);
    var edge = 8, notch = 28, count = Math.max(1, Math.floor((w - edge * 2) / 32));
    var pitch = (w - edge * 2) / count;
    var gap = pitch - notch;
    var k = 0.55228475, r = notch / 2;
    var sideR = 14, hasTear = typeof tearY === 'number' && tearY > sideR && tearY < h - sideR;
    var f = function (n) { return Number(n.toFixed(2)); };
    var d = ['M 0 0', 'L', f(edge), '0'];
    for (var i = 0; i < count; i++) {
      var x = edge + i * pitch;
      d.push('C', f(x), f(k * r), f(x + r - k * r), f(r), f(x + r), f(r));
      d.push('C', f(x + r + k * r), f(r), f(x + notch), f(k * r), f(x + notch), '0');
      if (gap > 0) d.push('L', f(x + pitch), '0');
    }
    d.push('L', f(w), '0');
    if (hasTear) {
      d.push('L', f(w), f(tearY - sideR),
        'C', f(w - k * sideR), f(tearY - sideR), f(w - sideR), f(tearY - k * sideR), f(w - sideR), f(tearY),
        'C', f(w - sideR), f(tearY + k * sideR), f(w - k * sideR), f(tearY + sideR), f(w), f(tearY + sideR));
    }
    d.push('L', f(w), f(h), 'L', f(w - edge), f(h));
    for (var j = count - 1; j >= 0; j--) {
      var bx = edge + j * pitch;
      d.push('L', f(bx + notch), f(h));
      d.push('C', f(bx + notch), f(h - k * r), f(bx + r + k * r), f(h - r), f(bx + r), f(h - r));
      d.push('C', f(bx + r - k * r), f(h - r), f(bx), f(h - k * r), f(bx), f(h));
    }
    d.push('L', '0', f(h));
    if (hasTear) {
      d.push('L', '0', f(tearY + sideR),
        'C', f(k * sideR), f(tearY + sideR), f(sideR), f(tearY + k * sideR), f(sideR), f(tearY),
        'C', f(sideR), f(tearY - k * sideR), f(k * sideR), f(tearY - sideR), '0', f(tearY - sideR));
    }
    d.push('Z');
    if (hasTear) {
      var holeR = 3.2, inset = 24;
      var intervals = Math.max(1, Math.round((w - inset * 2) / 9.7));
      for (var n = 0; n <= intervals; n++) {
        var cx = inset + n * (w - inset * 2) / intervals;
        // 外轮廓顺时针，圆孔逆时针；CSS path() 与 Canvas Path2D 都按非零环绕规则镂空。
        d.push('M', f(cx + holeR), f(tearY),
          'C', f(cx + holeR), f(tearY - k * holeR), f(cx + k * holeR), f(tearY - holeR), f(cx), f(tearY - holeR),
          'C', f(cx - k * holeR), f(tearY - holeR), f(cx - holeR), f(tearY - k * holeR), f(cx - holeR), f(tearY),
          'C', f(cx - holeR), f(tearY + k * holeR), f(cx - k * holeR), f(tearY + holeR), f(cx), f(tearY + holeR),
          'C', f(cx + k * holeR), f(tearY + holeR), f(cx + holeR), f(tearY + k * holeR), f(cx + holeR), f(tearY), 'Z');
      }
    }
    return d.join(' ');
  }

  Engine.prototype.listPapers = function () { return PAPERS.slice(); };
  Engine.prototype.currentPaper = function () {
    if (this.currentId !== 'order-receipt') return 'strip';
    var id = this.data.paper && this.data.paper.id;
    return id === 'scallop' || id === 'tearoff' ? id : 'strip';
  };
  Engine.prototype._paperTearY = function (paperRect) {
    if (this.currentPaper() !== 'tearoff' || !this.paperEl) return null;
    var line = this.paperEl.querySelector('.rcpt__perforation');
    if (!line) return null;
    var rect = line.getBoundingClientRect();
    return rect.top - paperRect.top + rect.height / 2;
  };
  Engine.prototype._updatePaperPath = function () {
    if (!this.paperEl || this.currentPaper() === 'strip') return;
    var rect = this.paperEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var value = 'path("' + paperPath(rect.width, rect.height, this._paperTearY(rect)) + '")';
    this.paperEl.style.clipPath = value;
    this.paperEl.style.webkitClipPath = value;
  };
  Engine.prototype.applyPaper = function (id, quiet) {
    if (this.currentId !== 'order-receipt' || !this.scopeEl) return this;
    var chosen = id === 'scallop' || id === 'tearoff' ? id : 'strip';
    this.data.paper = { id: chosen };
    var paper = this.scopeEl.querySelector('.rcpt');
    if (!paper) return this;
    if (this.paperObserver) { this.paperObserver.disconnect(); this.paperObserver = null; }
    this.paperEl = paper;
    this.scopeEl.setAttribute('data-paper', chosen);
    paper.style.clipPath = '';
    paper.style.webkitClipPath = '';
    if (chosen !== 'strip') {
      this._updatePaperPath();
      if (global.ResizeObserver) {
        var self = this;
        this.paperObserver = new global.ResizeObserver(function () { self._updatePaperPath(); });
        this.paperObserver.observe(paper);
      }
    }
    if (!quiet) { this.changed = true; this._emit('change'); }
    return this;
  };

  /* ======================== L3 装饰：槽位（slots） ======================== */

  Engine.prototype.listDeco = function (slot) {
    var all = this.catalog.deco || [];
    return slot ? all.filter(function (d) { return d.slot === slot; }) : all.slice();
  };

  Engine.prototype.listDecoSolts = function () { return (this.catalog.slots || []).slice(); };

  Engine.prototype.listAvatars = function () { return (this.catalog.avatars || []).slice(); };

  var SAFE_SVG = /^<svg[\s\S]*<\/svg>$/i;
  function safeSvg(svg) {
    if (!svg || !SAFE_SVG.test(svg.trim())) return '';
    if (/<script|foreignObject|<image|<use\b/i.test(svg)) return '';
    return svg;
  }

  /** 把内联 SVG 里的 id / url(#id) 加上唯一后缀。
   *  同名槽位（如 band 头尾各一处）会注入同一份素材，pattern id 重复会导致 url(#…) 引用错乱。 */
  function uniquifySvg(svg, seed) {
    var ids = [];
    svg.replace(/\sid="([^"]+)"/g, function (m, id) {
      if (ids.indexOf(id) === -1) ids.push(id);
      return m;
    });
    for (var i = 0; i < ids.length; i++) {
      var nu = ids[i] + '__' + seed + '_' + i;
      svg = svg.split('id="' + ids[i] + '"').join('id="' + nu + '"');
      svg = svg.split('url(#' + ids[i] + ')').join('url(#' + nu + ')');
    }
    return svg;
  }

  /** 生效中的装饰：数据里没有 deco 字段时回落到模板 manifest 的 defaultDeco（D-032）。
   *  用户一旦动手（选中或清空任一槽位），data.deco 变为数组，就不再回落 —— 尊重"我全都不要"。 */
  Engine.prototype._effectiveDeco = function () {
    if (Array.isArray(this.data.deco)) return this.data.deco;
    var tpl = this.current();
    var dd = (tpl && tpl.manifest && tpl.manifest.defaultDeco) || null;
    if (!dd) return [];
    var out = [];
    for (var k in dd) if (dd[k]) out.push({ slot: k, id: dd[k] });
    return out;
  };

  Engine.prototype.currentDeco = function () { return this._effectiveDeco().slice(); };

  /** 把装饰素材注入到模板的 data-slot 槽位 */
  Engine.prototype.renderDeco = function () {
    if (!this.scopeEl) return this;
    var self = this;
    var decos = this._effectiveDeco();
    var map = {};
    decos.forEach(function (d) { if (d && d.slot) map[d.slot] = d.id; });

    var slots = this.scopeEl.querySelectorAll('[data-slot]');
    for (var i = 0; i < slots.length; i++) {
      (function (slotEl, idx) {
        var name = slotEl.getAttribute('data-slot');
        if (name === 'avatar') return;        // 头像槽归 applyAvatar 管，别在这里清掉
        var id = map[name];
        var svg = '';
        var bitmap = '';
        var found = null;
        if (id) {
          var pool = (self.catalog.deco || []);
          for (var k = 0; k < pool.length; k++) if (pool[k].id === id) found = pool[k];
          if (found) {
            svg = safeSvg(found.svg);
            if (name === 'header-art' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(found.png || '')) bitmap = found.png;
          }
        }
        if (svg) svg = uniquifySvg(svg, name + '-' + idx);
        slotEl.innerHTML = svg;
        if (bitmap) {
          var img = document.createElement('img');
          img.src = bitmap;
          img.alt = '';
          img.loading = 'eager';
          img.decoding = 'sync';
          img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
          slotEl.appendChild(img);
        }
        slotEl.style.opacity = bitmap ? '1' : '';
        // 插画头图需要留出画面空间；切回普通纹样时恢复模板原有高度。
        slotEl.style.height = (svg || bitmap) && name === 'header-art' && found && found.displayHeight ? found.displayHeight + 'px' : '';
        slotEl.style.display = (svg || bitmap) ? '' : 'none';
      })(slots[i], i);
    }
    return this;
  };

  Engine.prototype.setDeco = function (slot, decoId) {
    var decos = this._effectiveDeco().slice();   // 首次操作时把 manifest 默认值落成显式数据
    var replaced = false;
    for (var i = 0; i < decos.length; i++) {
      if (decos[i] && decos[i].slot === slot) {
        if (decoId) { decos[i].id = decoId; replaced = true; }
        else decos.splice(i, 1);
        break;
      }
    }
    if (!replaced && decoId) decos.push({ slot: slot, id: decoId });
    this.data.deco = decos;
    this.renderDeco();
    this.changed = true;
    this._emit('change');
    return this;
  };

  /* ============== 头像（内置预设，不提供上传；v0.3.4 起默认关闭，见 D-030） ============== */

  /**
   * 头像渲染。
   * v0.3.4 起**界面不再提供头像入口**（决策 D-030），因此这里**默认不注入任何头像**：
   * 只有数据里显式写了 `avatar.kind === "builtin"` 且有匹配素材时才渲染，
   * 其余情况（未声明 / kind:"none" / 素材缺失）一律清空并隐藏槽位。
   *
   * 之所以保留本方法与 `listAvatars` / `setAvatar`：① 旧工程包仍能正确回放；
   * ② 美术若日后要启用头像位，引擎侧无需改动，接回右栏一段即可。
   */
  Engine.prototype.applyAvatar = function () {
    if (!this.scopeEl) return this;
    var av = isObj(this.data.avatar) ? this.data.avatar : {};
    var svg = '';
    if (av.kind === 'builtin') {
      var pool = this.catalog.avatars || [];
      var id = av.id || (pool[0] && pool[0].id);
      for (var i = 0; i < pool.length; i++) if (pool[i].id === id) svg = safeSvg(pool[i].svg);
      this.data.avatar = svg ? { kind: 'builtin', id: id } : { kind: 'none' };
    } else {
      this.data.avatar = { kind: 'none' };
    }
    var slots = this.scopeEl.querySelectorAll('[data-slot="avatar"]');
    for (var j = 0; j < slots.length; j++) {
      slots[j].innerHTML = svg;
      slots[j].style.display = svg ? '' : 'none';
    }
    var layers = this.scopeEl.querySelectorAll('[data-avatar]');
    for (var k = 0; k < layers.length; k++) {
      layers[k].innerHTML = svg;
      layers[k].style.display = svg ? '' : 'none';
    }
    return this;
  };

  Engine.prototype.setAvatar = function (id) {
    this.data.avatar = id ? { kind: 'builtin', id: id } : { kind: 'none' };
    this.applyAvatar();
    this.changed = true;
    this._emit('change');
    return this;
  };

  /* ======================== 明细行增删移（F-05） ======================== */

  Engine.prototype.addItem = function (afterIndex) {
    if (!Array.isArray(this.data.items)) this.data.items = [];
    var item = { name: '\u65b0\u54C1\u9879', spec: '', qty: 1, unitPrice: 0, amount: 0, tag: '' };
    var at = (typeof afterIndex === 'number' && afterIndex >= 0 && afterIndex < this.data.items.length)
      ? afterIndex + 1 : this.data.items.length;
    this.data.items.splice(at, 0, item);
    this.recalc();
    this.render();
    this._emit('change');
    return this;
  };

  Engine.prototype.removeItem = function (index) {
    if (!Array.isArray(this.data.items)) return this;
    if (index < 0 || index >= this.data.items.length) return this;
    this.data.items.splice(index, 1);
    this.recalc();
    this.render();
    this._emit('change');
    return this;
  };

  Engine.prototype.moveItem = function (index, dir) {
    var items = this.data.items;
    if (!Array.isArray(items)) return this;
    var target = index + (dir < 0 ? -1 : 1);
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return this;
    var tmp = items[index];
    items[index] = items[target];
    items[target] = tmp;
    this.render();
    this._emit('change');
    return this;
  };

  /* ======================== 文案库（F-06） ======================== */

  Engine.prototype.listPhrases = function () { return PHRASES.slice(); };

  /** 把一段文案追加到碎碎念（note） */
  Engine.prototype.appendNote = function (text) {
    if (!text) return this;
    if (!isObj(this.data.journal)) this.data.journal = {};
    var cur = this.data.journal.note || '';
    this.data.journal.note = cur ? (cur.replace(/\s+$/, '') + '\n' + text) : text;
    var nodes = this.scopeEl ? this.scopeEl.querySelectorAll('[data-field="journal.note"]') : [];
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = this.data.journal.note;
    this.changed = true;
    this._emit('change');
    return this;
  };

  /* ---------------------------- 工具条 ---------------------------- */

  Engine.prototype.mountChrome = function () {
    if (!this.chrome) return this;
    var self = this;

    var groups = [];
    if (this.templateSwitch) {
      var themes = this.templates.map(function (t) {
        return '<option value="' + t.manifest.id + '">' + (t.manifest.name || t.manifest.id) + '</option>';
      }).join('');
      groups.push(
        '<div class="rct-toolbar__group">' +
          '<label class="rct-toolbar__label">\u6A21\u677F</label>' +
          '<select class="rct-toolbar__select" data-role="template">' + themes + '</select>' +
        '</div>'
      );
    }

    var bar = document.createElement('div');
    bar.className = 'rct-toolbar';
    bar.innerHTML = groups.join('') +
      '<div class="rct-toolbar__group rct-toolbar__group--grow">' +
        '<button type="button" class="rct-btn rct-btn--primary" data-role="png">\u4E0B\u8F7D PNG</button>' +
        '<button type="button" class="rct-btn" data-role="print">\u6253\u5370 / PDF</button>' +
        '<button type="button" class="rct-btn" data-role="export">\u5BFC\u51FA\u5DE5\u7A0B</button>' +
        '<button type="button" class="rct-btn" data-role="import">\u5BFC\u5165\u5DE5\u7A0B</button>' +
        '<button type="button" class="rct-btn rct-btn--ghost" data-role="reset">\u91CD\u7F6E</button>' +
        '<input type="file" accept="application/json,.json" hidden data-role="file">' +
      '</div>' +
      '<div class="rct-toolbar__hint">\u70B9\u4EFB\u610F\u6587\u5B57\u5373\u53EF\u4FEE\u6539 \u00B7 \u70B9\u5FC3\u60C5\u53EF\u6362\u8868\u60C5 \u00B7 \u53F3\u4FA7\u53EF\u5F00\u5173\u680F\u4F4D / \u6362\u7EB8\u8272 / \u8D34\u88C5\u9970</div>';

    this.container.insertBefore(bar, this.container.firstChild);
    this.chromeEl = bar;

    if (this.templateSwitch) {
      var sel = bar.querySelector('[data-role="template"]');
      sel.value = this.currentId;
      sel.addEventListener('change', function () { self.setTemplate(sel.value); });
    }

    bar.querySelector('[data-role="png"]').addEventListener('click', function () { self.exportPng(); });
    bar.querySelector('[data-role="print"]').addEventListener('click', function () { self.print(); });
    bar.querySelector('[data-role="export"]').addEventListener('click', function () { self.exportJson(); });
    var file = bar.querySelector('[data-role="file"]');
    bar.querySelector('[data-role="import"]').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () { if (file.files[0]) self.importJson(file.files[0]); });
    bar.querySelector('[data-role="reset"]').addEventListener('click', function () { self.reset(); });
    return this;
  };

  /* ---------------------------- 导出 ---------------------------- */

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

/** 导出前把克隆文档里「html2canvas 会画错」的样式摘掉。
 *
 *  为什么需要：html2canvas 1.4.1 不解析 box-shadow 的模糊半径与偏移，
 *  而是把投影当成**一块半透明的实心矩形直接叠在元素身上**。实测（2026-10-13 探针）：
 *  模板 CSS 里那句 `box-shadow: 0 14px 34px rgba(47,42,36,.16)` 会让整张票面
 *  从 `#fdfdfa` 被递归成 `#d4d4d1`（纸色 × 0.84，即叠了 16% 黑），
 *  5×5 网格采样整片一致 —— 导出的 PNG 比页面深一大截。
 *  导出图本来也不需要投影（它是裁下来的纸面本身，不是摆在桌面上的纸），
 *  所以一律抹平，代价为零、确定性最高。
 */
function stripUnsupportedForExport(doc) {
  const els = doc.querySelectorAll('*');
  for (let i = 0; i < els.length; i++) {
    // 带 !important 兜底：万一模板把投影写成 !important，普通内联声明压不住它
    els[i].style.setProperty('box-shadow', 'none', 'important');
    els[i].style.setProperty('-webkit-box-shadow', 'none', 'important');
  }
}

Engine.prototype.exportPng = function (opts) {
  var m = this.current().manifest || {};
  var options = opts || {};
  var scale = options.scale || (m.export && m.export.scale) || 3;
  var shaped = this.currentPaper() !== 'strip' && this.currentId === 'order-receipt';
  var bg = shaped ? null : (options.background || (m.export && m.export.background) || (this.opts.background || '#ffffff'));
  var scopeRect = this.scopeEl.getBoundingClientRect();
  var paperRect = shaped && this.paperEl ? this.paperEl.getBoundingClientRect() : null;
  var tearY = paperRect ? this._paperTearY(paperRect) : null;
  if (shaped) this._updatePaperPath();

  if (!global.html2canvas) {
    global.alert('\u56fe\u7247\u7EC4\u4EF6\u672A\u52A0\u8F7D\uFF08\u53EF\u80FD\u662F\u79BB\u7EBF\u73AF\u5883\uFF09\u3002\n\u8BF7\u6539\u7528\u300C\u6253\u5370 / PDF\u300D\u5BFC\u51FA\uFF0C\u6548\u679C\u76F8\u540C\u3002');
    return Promise.resolve(null);
  }
  return global.html2canvas(this.scopeEl, {
    scale: scale,
    backgroundColor: bg,
    useCORS: true,
    logging: false,
    onclone: function (doc) {
      stripUnsupportedForExport(doc);
      if (shaped) {
        var clonedPaper = doc.querySelector('.rct-scope--order-receipt .rcpt');
        if (clonedPaper) {
          clonedPaper.style.setProperty('clip-path', 'none', 'important');
          clonedPaper.style.setProperty('-webkit-clip-path', 'none', 'important');
        }
      }
    }
  }).then(function (canvas) {
      if (shaped && paperRect) {
        var ctx = canvas.getContext('2d');
        var sx = canvas.width / scopeRect.width, sy = canvas.height / scopeRect.height;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';
        ctx.setTransform(sx, 0, 0, sy,
          (paperRect.left - scopeRect.left) * sx, (paperRect.top - scopeRect.top) * sy);
        ctx.fill(new Path2D(paperPath(paperRect.width, paperRect.height, tearY)));
        ctx.restore();
      }
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          download(blob, 'mcd-receipt-studio-' + (m.id || 'tpl') + '-' + Date.now() + '.png');
          resolve(canvas);
        }, 'image/png');
      });
    });
  };

  Engine.prototype.print = function () { global.print(); };

  /** 工程 JSON = 数据 + 栏位 + 皮肤 + 装饰 + 头像（可原样导回，F-07） */
  Engine.prototype.toJson = function () {
    var out = clone(this.data);
    out.blocks = this.getBlocks().map(function (b) { return { id: b.id, visible: b.visible, order: b.order }; });
    return out;
  };

  Engine.prototype.serialize = function () {
    return { templateId: this.currentId, receipt: this.toJson() };
  };

  Engine.prototype.exportJson = function () {
    var blob = new Blob([JSON.stringify(this.toJson(), null, 2)], { type: 'application/json' });
    download(blob, 'mcd-receipt-studio-project-' + Date.now() + '.json');
  };

  Engine.prototype.importJson = function (file) {
    var self = this;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        if (obj && obj.receipt && obj.templateId) {
          self.currentId = obj.templateId;
          self.loadJson(obj.receipt);
        } else {
          self.loadJson(obj);
        }
      } catch (e) {
        global.alert('JSON \u89E3\u6790\u5931\u8D25\uFF1A' + e.message);
      }
    };
    reader.readAsText(file);
  };

  Engine.prototype.loadJson = function (obj) {
    this.data = obj || {};
    this.recalc();
    this.render();
    return this;
  };

  Engine.prototype.reset = function () {
    this.data = clone(this.origin);
    this.render();
    this._emit('change');
    return this;
  };

  Engine.prototype.setTemplate = function (id) {
    this.currentId = id;
    if (this.chromeEl) {
      var sel = this.chromeEl.querySelector('[data-role="template"]');
      if (sel) sel.value = id;
    }
    // 换模板时重置栏位状态（各模板栏位不同）
    this.data.blocks = [];
    this.render();
    this._emit('change');
    return this;
  };

  /* ---------------------------- 事件 ---------------------------- */

  Engine.prototype.on = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
    return this;
  };

  Engine.prototype._emit = function (name) {
    var list = this._listeners[name] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](this); } catch (e) { /* 监听器异常不影响主流程 */ }
    }
  };

  /* ---------------------------- 对外接口 ---------------------------- */

  function create(options) { return new Engine(options); }

  global.McdReceipt = {
    version: VERSION,
    create: create,
    Engine: Engine,
    PHRASES: PHRASES,
    formatters: FORMATTERS,
    formatValue: formatValue,
    money: money
  };

})(typeof window !== 'undefined' ? window : this);
