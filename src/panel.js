/*!
 * 麦门日记 · 工作台  v0.3.1
 * ------------------------------------------------------------------
 * 三栏结构：
 *   ① 左栏「数据源」：固定 3 个常用数据入口（1:1 绑定专属模板，不用下拉框）
 *   ② 中栏「小票舞台」：面包屑 + 小票（由引擎渲染）
 *   ③ 右栏「编辑与装饰」：栏位 / 皮肤 / 装饰 / 头像 / 文案 / 明细行
 *
 * 当前工作台入口：历史点单、积分存折、趣味统计；装饰与头像只用预设（D-022）。
 * ⚠️ 美术占位：所有待设计位置带 data-placeholder="<占位id>"，清单见 PLACEHOLDERS.md。
 */
(function (global) {
  'use strict';

  /** 当前启用的三类数据入口（= 页面主功能菜单），每类 1:1 绑定一套专属模板 */
  var SOURCES = [
    { id: 'orders', name: '\u5386\u53F2\u70B9\u5355', icon: '\uD83E\uDDFE', kind: 'order', template: 'order-receipt' },
    { id: 'points', name: '\u79EF\u5206\u5B58\u6298', icon: '\uD83C\uDFE6', kind: 'points', template: 'points-passbook' },
    { id: 'fun', name: '\u8DA3\u5473\u7EDF\u8BA1', icon: '\uD83D\uDCCA', kind: 'fun', template: 'fun-resume' }
  ];

  var KIND_NAME = {
    order: '\u5386\u53F2\u70B9\u5355\u5C0F\u7968',
    points: '\u79EF\u5206\u5B58\u6298',
    fun: '\u9EA6\u95E8\u5C65\u5386'
  };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function listOf(dataset, key) {
    var s = dataset && dataset.sections ? dataset.sections[key] : null;
    return Array.isArray(s) ? s : [];
  }
  function ph(node, id) { node.setAttribute('data-placeholder', id); return node; }

  /* ============================== 工作台 ============================== */

  function Panel(options) {
    this.opts = options || {};
    this.railEl = this.opts.railEl;
    this.editorEl = this.opts.editorEl;
    this.crumbEl = this.opts.crumbEl;
    this.dataset = this.opts.dataset || { sections: {} };
    this.templates = this.opts.templates || [];
    this.mappers = this.opts.mappers || global.McdMappers;
    this.catalog = this.opts.catalog || {};
    this.engine = this.opts.engine || null;
    this.onSelect = this.opts.onSelect || function () {};
    this.active = this.opts.active || 'orders';
    this.mealFilter = '\u5168\u90E8';
    this.showUnowned = false;
    this.orderIndex = this._defaultOrderIndex();
    this.orderPaperId = this.engine && this.engine.currentPaper ? this.engine.currentPaper() : 'strip';
    if (!this.railEl) throw new Error('[McdPanel] \u7F3A\u5C11 railEl');
  }

  Panel.prototype.render = function () {
    this.renderRail();
    this.renderCrumb();
    this.renderEditor();
    return this;
  };

  Panel.prototype.activeSource = function () {
    for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === this.active) return SOURCES[i];
    return SOURCES[0];
  };

  /** \u5DF2\u53D6\u6D88 / \u5DF2\u9000\u5355\u7684\u8BA2\u5355\uFF1A\u53EF\u4EE5\u770B\uFF0C\u4F46\u4E0D\u8BE5\u5360\u9996\u5C4F\u3002\u89C4\u5219\u6536\u655B\u5728 mappers\uFF0C\u907F\u514D\u4E0E\u9996\u5C4F\u6F02\u79FB */
  Panel.prototype._isVoid = function (o) {
    var m = this.mappers;
    if (m && typeof m.isVoidOrder === 'function') return m.isVoidOrder(o);
    return /\u53D6\u6D88|\u9000\u5355|\u4F5C\u5E9F/.test(String((o && o.status) || ''));
  };

  /** \u9ED8\u8BA4\u843D\u70B9\uFF1A\u4E0E\u5DE5\u4F5C\u53F0\u9996\u5C4F\u540C\u6E90\uFF08mappers.defaultOrderIndex\uFF09\uFF1B\u5168\u5E9F\u5219\u9000\u56DE\u7B2C\u4E00\u5355 */
  Panel.prototype._defaultOrderIndex = function () {
    var orders = listOf(this.dataset, 'orders');
    var m = this.mappers;
    if (m && typeof m.defaultOrderIndex === 'function') return m.defaultOrderIndex(orders);
    for (var i = 0; i < orders.length; i++) if (!this._isVoid(orders[i])) return i;
    return 0;
  };

  /**
   * \u8DA3\u5473\u7EDF\u8BA1\u7684\u6307\u6807\u5B9A\u4E49\uFF08\u5DE6\u680F\u5C55\u5F00\u533A\u4E0E\u5FBD\u6807\u5171\u7528\uFF0C\u907F\u514D\u4E24\u5904\u5404\u5199\u4E00\u4EFD\uFF09
   */
  Panel.prototype._funCells = function () {
    var f = this.mappers.computeFun(this.dataset);
    return [
      { k: '\u70B9\u5355\u603B\u6570', v: f.orderCount + ' \u5355', h: f.spanDays ? '\u8DE8\u8D8A ' + f.spanDays + ' \u5929' : '' },
      { k: '\u7D2F\u8BA1\u82B1\u8D39', v: '\u00A5' + f.totalSpend.toFixed(2), h: '\u5DF2\u6263\u9664\u53D6\u6D88\u5355' },
      { k: '\u95E8\u5E97\u8DB3\u8FF9', v: f.storeCount + ' \u5BB6', h: f.storeNames.slice(0, 2).join('\u3001') },
      { k: '\u5E38\u70B9 TOP', v: f.topItems.length ? f.topItems[0].name : '\u2014', h: f.topItems.map(function (t) { return t.name + '\u00D7' + t.count; }).join('\u3001') },
      { k: '\u6700\u8D35\u4E00\u5355', v: f.maxOrder ? '\u00A5' + Number(f.maxOrder.total).toFixed(2) : '\u2014', h: f.maxOrder ? String(f.maxOrder.storeName || '').slice(0, 12) : '' },
      { k: '\u79EF\u5206\u6298\u7B97', v: '\u2248 ' + Math.round(f.accumulativePoint / 25.5), h: '\u4E2A\u5DE8\u65E0\u9738' }
    ];
  };

  /**
   * \u5DE6\u680F\u5FBD\u6807\uFF1A\u663E\u793A\u300C\u4E00\u773C\u80FD\u61C2\u300D\u7684\u6458\u8981\uFF0C\u800C\u4E0D\u662F\u4E00\u4E2A\u5149\u79C3\u79C3\u7684\u6570\u5B57\u3002
   * \u6BCF\u4E2A\u5165\u53E3\u90FD\u5E26\u5355\u4F4D\u6216\u5206\u6BCD\uFF0C\u675C\u7EDD"\u8FD9\u4E2A 1 \u662F\u4EC0\u4E48"\u7684\u6B67\u4E49\uFF1A
   *   \u5386\u53F2\u70B9\u5355 4 \u5355 \uFF5C \u79EF\u5206\u5B58\u6298 114 \u5206 \uFF5C \u8DA3\u5473\u7EDF\u8BA1 6 \u9879
   * tip \u4F1A\u5199\u8FDB title \u5C5E\u6027\uFF0C\u9F20\u6807\u60AC\u505C\u53EF\u770B\u5230\u5B8C\u6574\u53E3\u5F84\u3002
   */
  Panel.prototype._badgeOf = function (id) {
    var orders = listOf(this.dataset, 'orders');
    var account = this.dataset.account || {};
    var show = function (v) { return v == null ? '\u2014' : String(v); };

    if (id === 'orders') {
      var voids = 0;
      for (var i = 0; i < orders.length; i++) if (this._isVoid(orders[i])) voids++;
      return {
        n: String(orders.length), u: '\u5355',
        tip: '\u5171 ' + orders.length + ' \u6761\u70B9\u5355\u8BB0\u5F55' + (voids ? '\uFF0C\u5176\u4E2D ' + voids + ' \u6761\u5DF2\u53D6\u6D88' : '')
      };
    }
    if (id === 'points') {
      return {
        n: show(account.availablePoint), u: '\u5206',
        tip: '\u5F53\u524D\u53EF\u7528\u79EF\u5206\uFF08\u7D2F\u8BA1 ' + show(account.accumulativePoint) + '\uFF0C\u5DF2\u7528 ' + show(account.usedPoint) + '\uFF09'
      };
    }
    if (id === 'fun') {
      var kf = this._funCells().length;
      return { n: String(kf), u: '\u9879', tip: '\u4F1A\u6C47\u603B\u51FA ' + kf + ' \u9879\u8DA3\u5473\u6307\u6807' };
    }
    return { n: '0', u: '', tip: '' };
  };

  /**
   * \u8BA2\u5355\u5361\u5DE6\u4FA7\u7684\u9910\u54C1\u56FE\u3002\u51B3\u7B56 D-021\uFF1A\u5B98\u65B9\u5546\u54C1\u56FE**\u53EA\u51FA\u73B0\u5728\u5DE6\u680F**\uFF0C\u5E2E\u7528\u6237\u8BA4\u6570\u636E\uFF0C
   * \u4E0D\u53C2\u4E0E\u5BFC\u51FA\uFF0C\u56E0\u6B64\u4E0D\u5B58\u5728 canvas \u8DE8\u57DF\u95EE\u9898\uFF08\u5B9E\u6D4B CDN \u65E0 CORS \u5934\uFF0C\u4F46\u4E5F\u4E0D\u9700\u8981\uFF09\u3002
   * \u53D6\u7B2C\u4E00\u4E2A\u300C\u6709\u56FE\u300D\u7684\u54C1\u9879\uFF1B\u5957\u9910\u5B50\u9879\uFF08combo\uFF09\u901A\u5E38\u4E0D\u5E26\u56FE\uFF0C\u53EA\u6709\u9876\u5C42\u54C1\u9879\u6709\u3002
   */
  Panel.prototype._orderThumbOf = function (o) {
    if (!o) return '';
    var pools = [o.detail && o.detail.lines, o.items];
    for (var p = 0; p < pools.length; p++) {
      var list = pools[p];
      if (!Array.isArray(list)) continue;
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var u = it && (it.image || it.productImage);
        if (u) return String(u);
      }
    }
    return '';
  };

  /* ---------------------------- 左栏 · 数据源 ---------------------------- */

  Panel.prototype.renderRail = function () {
    var self = this;
    var box = this.railEl;
    box.innerHTML = '';

    var head = el('div', 'rct-rail__head');
    head.appendChild(el('div', 'rct-rail__title', '\u6570\u636E\u6E90'));
    var src = this.dataset.source === 'mcp' ? '\u5B9E\u65F6\u62C9\u53D6' : '\u793A\u4F8B\u6570\u636E';
    head.appendChild(el('div', 'rct-rail__sub', esc(src) + ' \u00B7 ' + esc(this.dataset.generatedAt || '')));
    box.appendChild(head);

    var list = el('div', 'rct-rail__list');
    SOURCES.forEach(function (s) {
      var on = self.active === s.id;
      var card = el('button', 'rct-src' + (on ? ' is-active' : ''));
      card.type = 'button';
      card.setAttribute('data-role', 'source-' + s.id);
      var ic = ph(el('span', 'rct-ph rct-ph--icon', s.icon), 'rail.icon.' + s.id);
      card.appendChild(ic);
      var main = el('div', 'rct-src__main');
      main.appendChild(el('div', 'rct-src__name', esc(s.name)));
      var t = self._templateName(s.template);
      main.appendChild(el('div', 'rct-src__tpl', esc(t ? '\u2192 ' + t : '\u2192 \uFF08\u672A\u5165\u7ED3\u7EDF\u6A21\u677F\uFF09')));
      card.appendChild(main);
      var bd = self._badgeOf(s.id);
      var badge = el('span', 'rct-src__count');
      if (bd.tip) badge.setAttribute('title', bd.tip);
      badge.appendChild(el('span', 'rct-src__count-n', esc(bd.n)));
      if (bd.u) badge.appendChild(el('span', 'rct-src__count-u', esc(bd.u)));
      card.appendChild(badge);
      // \u6A2A\u6761\u7F29\u7565\uFF1A**\u53EA\u6709\u7F8E\u672F\u4EA4\u4ED8\u4E86 templates/<id>/thumb.png \u624D\u6E32\u67D3**\u3002
      // \u6CA1\u7D20\u6750\u65F6\u5B8C\u5168\u4E0D\u7559\u4F4D\uFF0C\u628A\u9AD8\u5EA6\u8BA9\u7ED9\u771F\u6B63\u8981\u70B9\u7684\u5C55\u5F00\u533A\u3002
      var thumbUrl = self.catalog.thumbs ? self.catalog.thumbs[s.id] : '';
      if (thumbUrl) {
        var thumb = el('div', 'rct-src__thumb');
        thumb.setAttribute('data-placeholder', 'rail.thumb.' + s.id);
        var tim = document.createElement('img');
        tim.src = thumbUrl;
        tim.alt = '';
        tim.setAttribute('loading', 'lazy');
        thumb.appendChild(tim);
        card.appendChild(thumb);
      }
      card.addEventListener('click', function () { self.select(s.id); });
      list.appendChild(card);
    });
    box.appendChild(list);

    // 展开区：当前入口的二级交互
    var detail = el('div', 'rct-rail__detail');
    box.appendChild(detail);
    var render = {
      orders: this._detailOrders,
      points: this._detailPoints,
      fun: this._detailFun,
    }[this.active];
    if (render) render.call(this, detail);
  };

  Panel.prototype._templateName = function (id) {
    for (var i = 0; i < this.templates.length; i++) {
      if (this.templates[i].manifest.id === id) return this.templates[i].manifest.name;
    }
    return '';
  };

  Panel.prototype.select = function (id) {
    this.active = id;
    this.showUnowned = false;
    this.orderIndex = this._defaultOrderIndex();
    this.renderRail();
    this.generate(true);      // 选中即出小票（订单类默认取最近一单）
    return this;
  };

  Panel.prototype._tips = function (text) { return el('p', 'rct-tip', esc(text)); };

  /* ① 历史点单 */
  Panel.prototype._detailOrders = function (box) {
    var self = this;
    var orders = listOf(this.dataset, 'orders');
    box.appendChild(el('h4', 'rct-rail__sub-title', '\u70B9\u4E00\u5355\uFF0C\u5373\u523B\u51FA\u5C0F\u7968'));
    if (!orders.length) return void box.appendChild(this._empty('\u8FD8\u6CA1\u6709\u62FF\u5230\u70B9\u5355\u8BB0\u5F55', 'rail.empty.orders'));

    var meals = ['\u5168\u90E8'];
    orders.forEach(function (o) {
      var m = o.meal || self.mappers.mealOf(o.datetime);
      if (m && meals.indexOf(m) === -1) meals.push(m);
    });
    var bar = el('div', 'rct-rail__filter');
    meals.forEach(function (m) {
      var b = el('button', 'rct-chip' + (self.mealFilter === m ? ' is-active' : ''), esc(m));
      b.type = 'button';
      b.addEventListener('click', function () { self.mealFilter = m; self.renderRail(); });
      bar.appendChild(b);
    });
    box.appendChild(bar);

    var shown = orders.filter(function (o) {
      if (self.mealFilter === '\u5168\u90E8') return true;
      return (o.meal || self.mappers.mealOf(o.datetime)) === self.mealFilter;
    });

    var wrap = el('div', 'rct-cards');
    shown.forEach(function (o) {
      var idx = orders.indexOf(o);
      var isVoid = self._isVoid(o);
      var card = el('button', 'rct-card' + (idx === self.orderIndex ? ' is-picked' : '') + (isVoid ? ' is-void' : ''));
      card.type = 'button';
      card.setAttribute('data-role', 'order-card');
      card.setAttribute('data-void', isVoid ? 'true' : 'false');
      var meal = o.meal || self.mappers.mealOf(o.datetime);
      var imgUrl = self._orderThumbOf(o);
      var thumb;
      if (imgUrl) {
        thumb = el('div', 'rct-thumb');
        thumb.setAttribute('data-placeholder', 'rail.card.thumb.order');
        var im = document.createElement('img');
        im.src = imgUrl;
        im.alt = '';
        im.setAttribute('loading', 'lazy');
        im.setAttribute('referrerpolicy', 'no-referrer');   // CDN \u4E0D\u6821\u9A8C\u6765\u6E90\uFF0C\u4F46\u663E\u5F0F\u4E0D\u53D1\u9001\u66F4\u7A33\u59A5
        im.addEventListener('error', function () {
          // \u56FE\u6302\u4E86\u5C31\u9000\u56DE\u9996\u5B57\u65B9\u5757\uFF0C\u522B\u7559\u4E00\u4E2A\u7834\u56FE
          thumb.className = 'rct-thumb is-broken';
          thumb.innerHTML = '';
          thumb.appendChild(el('span', 'rct-thumb__fallback', esc(String(o.storeName || '\u9EA6').charAt(0))));
        });
        thumb.appendChild(im);
      } else {
        thumb = ph(el('div', 'rct-ph rct-ph--thumb', '\u9910\u54C1\u56FE'), 'rail.card.thumb.order');
      }
      card.appendChild(thumb);
      var main = el('div', 'rct-card__main');
      main.appendChild(el('div', 'rct-card__title', esc(String(o.datetime || '').slice(0, 16))));
      main.appendChild(el('div', 'rct-card__meta', esc(meal + ' \u00B7 ' + (o.status || ''))));
      main.appendChild(el('div', 'rct-card__desc', esc(o.storeName || '\u9EA6\u5F53\u52B3')));
      card.appendChild(main);
      var side = el('div', 'rct-card__side');
      side.appendChild(el('div', 'rct-card__amount', '\u00A5' + (Number(o.total) || 0).toFixed(2)));
      side.appendChild(el('div', 'rct-card__cta', o.detail ? '\u660E\u7EC6\u7248' : '\u6574\u5355\u7248'));
      card.appendChild(side);
      card.addEventListener('click', function () {
        self.orderIndex = idx;
        self.generate();
      });
      wrap.appendChild(card);
    });
    box.appendChild(wrap);
    box.appendChild(this._tips('\u5E26\u300C\u660E\u7EC6\u7248\u300D\u7684\u5355\u6709\u5355\u54C1\u5355\u4EF7\u4E0E\u4F18\u60E0\u660E\u7EC6\uFF1B\u5176\u4F59\u4E3A\u6574\u5355\u91D1\u989D\u7248\uFF08\u63A5\u53E3\u672A\u53D6\u5230\u660E\u7EC6\uFF0C\u4E0D\u81C6\u9020\u5355\u4EF7\uFF09\u3002'));
  };

  /* ② 积分存折 */
  Panel.prototype._detailPoints = function (box) {
    var a = this.dataset.account || {};
    var card = el('div', 'rct-stat-card');
    card.setAttribute('data-role', 'points-card');
    card.appendChild(el('div', 'rct-stat-card__label', '\u53EF\u7528\u79EF\u5206'));
    card.appendChild(el('div', 'rct-stat-card__value', esc(String(a.availablePoint == null ? '\u2014' : a.availablePoint))));
    card.appendChild(el('div', 'rct-stat-card__hint',
      '\u7D2F\u8BA1 ' + esc(String(a.accumulativePoint == null ? '\u2014' : a.accumulativePoint)) +
      ' \u00B7 \u5DF2\u7528 ' + esc(String(a.usedPoint == null ? '\u2014' : a.usedPoint))));
    box.appendChild(card);
    box.appendChild(this._tips('\u79EF\u5206\u6570\u636E\u6765\u81EA\u9EA6\u5F53\u52B3\u8D26\u6237\uFF0C\u672C\u5DE5\u5177\u53EA\u8BFB\u53D6\u3002'));
  };

  /* ③ 趣味统计 */
  Panel.prototype._detailFun = function (box) {
    var grid = el('div', 'rct-stat-grid');
    this._funCells().forEach(function (c) {
      var card = el('div', 'rct-stat-card rct-stat-card--mini');
      card.appendChild(el('div', 'rct-stat-card__label', esc(c.k)));
      card.appendChild(el('div', 'rct-stat-card__value', esc(c.v)));
      if (c.h) card.appendChild(el('div', 'rct-stat-card__hint', esc(c.h)));
      grid.appendChild(card);
    });
    box.appendChild(grid);
    box.appendChild(this._tips('\u5168\u90E8\u4E3A\u57FA\u4E8E\u771F\u5B9E\u6570\u636E\u7684\u7EAF\u8BA1\u7B97\uFF0C\u672A\u4F7F\u7528\u4EFB\u4F55\u63A8\u6D4B\u503C\u3002'));
  };

  Panel.prototype._empty = function (text, slot) {
    var box = el('div', 'rct-rail__empty');
    box.appendChild(ph(el('div', 'rct-ph rct-ph--illus', '\u5360\u4F4D'), slot));
    box.appendChild(el('div', 'rct-rail__empty-text', esc(text)));
    return box;
  };

  /* ------------------------- 生成（数据 → 小票） ------------------------- */

  Panel.prototype._receiptOf = function (id) {
    var d = this.dataset;
    var m = this.mappers;
    if (id === 'orders') {
      var orders = listOf(d, 'orders');
      var o = orders[this.orderIndex] || orders[0];
      return o ? m.mapOrderDetail(o, o.detail, d.account) : null;
    }
    if (id === 'points') return m.mapPoints(d.account || {}, listOf(d, 'orders'));
    if (id === 'fun') return m.mapFun(d, {});
    return null;
  };

  Panel.prototype.generate = function (quiet) {
    var s = this.activeSource();
    if (this.engine && this.engine.data && this.engine.data.meta && this.engine.data.meta.kind === 'order') {
      this.orderPaperId = this.engine.currentPaper();
    }
    var receipt = this._receiptOf(s.id);
    if (!receipt) {
      if (!quiet) this.renderRail();
      return this;
    }
    // 沿用当前皮肤/装饰，让"换纸色"在下一张上依然生效
    var cur = this.engine && this.engine.data ? this.engine.data : {};
    if (cur.skin && cur.skin.id) receipt.skin = JSON.parse(JSON.stringify(cur.skin));
    if (Array.isArray(cur.deco) && cur.deco.length) receipt.deco = JSON.parse(JSON.stringify(cur.deco));
    if (s.id === 'orders') receipt.paper = { id: this.orderPaperId };

    var ids = this.templates.map(function (t) { return t.manifest.id; });
    var tpl = ids.indexOf(s.template) !== -1 ? s.template : ids[0];
    this.onSelect({ receipt: receipt, templateId: tpl, source: s.id });
    if (!quiet) this.renderRail();
    return this;
  };

  /* ---------------------------- 中栏 · 面包屑 ---------------------------- */

  Panel.prototype.renderCrumb = function () {
    if (!this.crumbEl) return this;
    var s = this.activeSource();
    var kind = this.engine && this.engine.data && this.engine.data.meta ? this.engine.data.meta.kind : s.kind;
    var tpl = this.engine ? this.engine.current().manifest : null;
    var desc = '';
    if (this.active === 'orders') {
      var o = listOf(this.dataset, 'orders')[this.orderIndex];
      if (o) desc = String(o.datetime || '').slice(0, 16) + ' \u00B7 ' + (o.meal || this.mappers.mealOf(o.datetime));
    } else {
      desc = this._badgeOf(this.active).tip;
    }
    this.crumbEl.innerHTML = '';
    this.crumbEl.setAttribute('data-placeholder', 'editor.crumb');
    this.crumbEl.appendChild(el('span', 'rct-crumb__now', esc(KIND_NAME[kind] || '\u5C0F\u7968')));
    this.crumbEl.appendChild(el('span', 'rct-crumb__sep', '\u00B7'));
    this.crumbEl.appendChild(el('span', 'rct-crumb__data', esc(s.name + '\uFF1A' + desc)));
    this.crumbEl.appendChild(el('span', 'rct-crumb__sep', '\u00B7'));
    this.crumbEl.appendChild(el('span', 'rct-crumb__tpl', esc(tpl ? tpl.name : '')));
    return this;
  };

  /* --------------------- 右栏 · 编辑与装饰（四段，明细行仅点单类） --------------------- */

  Panel.prototype.renderEditor = function () {
    var self = this;
    var box = this.editorEl;
    if (!box || !this.engine) return this;
    box.innerHTML = '';

    box.appendChild(el('div', 'rct-editor__title', '\u7F16\u8F91\u4E0E\u88C5\u9970'));
    // 所有分段装进 .rct-editor__body：窄屏时它可切成两列 / 单列
    var body = el('div', 'rct-editor__body');

    /* 段1 栏位 */
    var sec1 = el('section', 'rct-sec');
    sec1.appendChild(ph(el('h4', 'rct-sec__title', '\u25B8 \u680F\u4F4D'), 'editor.sec.blocks'));
    var blocks = this.engine.getBlocks();
    var bl = el('div', 'rct-sec__body');
    if (!blocks.length) bl.appendChild(el('p', 'rct-tip', '\u672C\u6A21\u677F\u672A\u58F0\u660E\u53EF\u5F00\u5173\u680F\u4F4D\u3002'));
    blocks.forEach(function (b, i) {
      // 无数据支撑的栏位（D-035）：灰显 + 开关禁用 + 标注「无数据」，且不可排序
      var row = el('div', 'rct-block-row' + (b.active ? '' : ' is-locked'));
      var cb = el('button', 'rct-check' + (b.visible ? ' is-on' : ''), b.visible ? '\u2714' : '');
      cb.type = 'button';
      cb.setAttribute('data-role', 'block-toggle');
      cb.setAttribute('data-block-id', b.id);
      if (b.lock || !b.active) cb.setAttribute('disabled', 'disabled');
      if (!b.active) cb.setAttribute('title', '\u5F53\u524D\u8FD9\u4EFD\u6570\u636E\u91CC\u6CA1\u6709\u300C' + b.name + '\u300D\u7684\u5185\u5BB9');
      cb.addEventListener('click', function () { self.engine.setBlockVisible(b.id, !b.visible); });
      row.appendChild(cb);
      row.appendChild(el('span', 'rct-block-name', esc(b.name) + (b.lock ? ' \uD83D\uDD12' : '')));
      if (!b.active) row.appendChild(el('span', 'rct-block-hint', '\u65E0\u6570\u636E'));
      var up = el('button', 'rct-mini', '\u2191'); up.type = 'button';
      up.addEventListener('click', function () { self.engine.moveBlock(b.id, -1); });
      var dn = el('button', 'rct-mini', '\u2193'); dn.type = 'button';
      dn.addEventListener('click', function () { self.engine.moveBlock(b.id, 1); });
      if (b.lock || !b.active || i === 0) up.setAttribute('disabled', 'disabled');
      if (i === blocks.length - 1) dn.setAttribute('disabled', 'disabled');
      row.appendChild(up); row.appendChild(dn);
      bl.appendChild(row);
    });
    sec1.appendChild(bl);
    body.appendChild(sec1);

    /* 段2 皮肤 */
    var sec2 = el('section', 'rct-sec');
    sec2.appendChild(ph(el('h4', 'rct-sec__title', '\u25B8 \u7EB8\u8272\uFF08\u76AE\u80A4\uFF09'), 'editor.sec.skin'));
    var sw = el('div', 'rct-swatches');
    var curSkin = (this.engine.data.skin && this.engine.data.skin.id) || '';
    this.engine.listSkins().forEach(function (s) {
      var b = el('button', 'rct-swatch' + (curSkin === s.id ? ' is-active' : ''));
      b.type = 'button';
      b.setAttribute('data-role', 'skin');
      b.setAttribute('data-skin-id', s.id);
      b.setAttribute('title', s.name);
      var chip = el('span', 'rct-swatch__chip');
      chip.style.background = s.vars['--rct-paper'];
      chip.style.borderColor = s.vars['--rct-line'];
      b.appendChild(chip);
      b.appendChild(el('span', 'rct-swatch__name', esc(s.name)));
      b.addEventListener('click', function () { self.engine.applySkin(s.id); });
      sw.appendChild(b);
    });
    sec2.appendChild(sw);
    body.appendChild(sec2);

    /* 纸型只用于历史点单小票 */
    if (this.engine.currentId === 'order-receipt' && this.engine.data.meta && this.engine.data.meta.kind === 'order') {
      this.orderPaperId = this.engine.currentPaper();
      var paperSec = el('section', 'rct-sec');
      paperSec.appendChild(el('h4', 'rct-sec__title', '\u25B8 \u7EB8\u578B'));
      var paperGrid = el('div', 'rct-paper-grid');
      this.engine.listPapers().forEach(function (p) {
        var b = el('button', 'rct-paper' + (self.orderPaperId === p.id ? ' is-active' : ''));
        b.type = 'button';
        b.setAttribute('data-role', 'paper');
        b.setAttribute('data-paper-id', p.id);
        b.appendChild(el('span', 'rct-paper__sample rct-paper__sample--' + p.id));
        b.appendChild(el('span', 'rct-paper__name', esc(p.name)));
        b.addEventListener('click', function () {
          self.orderPaperId = p.id;
          self.engine.applyPaper(p.id);
        });
        paperGrid.appendChild(b);
      });
      paperSec.appendChild(paperGrid);
      body.appendChild(paperSec);
    }

    /* 段3 装饰 */
    var sec3 = el('section', 'rct-sec');
    sec3.appendChild(ph(el('h4', 'rct-sec__title', '\u25B8 \u88C5\u9970'), 'editor.sec.deco'));
    var slotsInTpl = this.engine.scopeEl ? this.engine.scopeEl.querySelectorAll('[data-slot]') : [];
    var present = {};
    for (var i = 0; i < slotsInTpl.length; i++) present[slotsInTpl[i].getAttribute('data-slot')] = true;
    var s3 = el('div', 'rct-sec__body');
    var anySlot = false;
    this.engine.listDecoSolts().forEach(function (slot) {
      if (!present[slot.id]) return;   // 当前模板没有这个槽位就不显示
      anySlot = true;
      s3.appendChild(ph(el('div', 'rct-deco__label', esc(slot.name)), 'editor.deco.' + slot.id));
      var grid = el('div', 'rct-deco-grid');
      var cur = null;
      (self.engine.currentDeco() || []).forEach(function (d) { if (d.slot === slot.id) cur = d.id; });
      var none = el('button', 'rct-chip' + (!cur ? ' is-active' : ''), '\u65E0');
      none.type = 'button';
      none.addEventListener('click', function () { self.engine.setDeco(slot.id, null); });
      grid.appendChild(none);
      self.engine.listDeco(slot.id).forEach(function (d) {
        var b = ph(el('button', 'rct-deco' + (cur === d.id ? ' is-active' : '')), 'editor.deco.item');
        b.type = 'button';
        b.setAttribute('data-role', 'deco');
        b.setAttribute('data-deco-id', d.id);
        b.setAttribute('title', d.name);
        var svgBox = el('span', 'rct-deco__svg');
        svgBox.innerHTML = d.svg || '';
        if (d.png && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(d.png)) {
          var thumb = document.createElement('img');
          thumb.src = d.png;
          thumb.alt = '';
          thumb.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
          svgBox.appendChild(thumb);
        }
        b.appendChild(svgBox);
        b.addEventListener('click', function () { self.engine.setDeco(slot.id, d.id); });
        grid.appendChild(b);
      });
      s3.appendChild(grid);
    });
    if (!anySlot) s3.appendChild(el('p', 'rct-tip', '\u672C\u6A21\u677F\u672A\u9884\u7559\u88C5\u9970\u69FD\u4F4D\u3002'));
    sec3.appendChild(s3);
    body.appendChild(sec3);

    /* 段4 明细行（仅点单类） */
    var kind = this.engine.data.meta ? this.engine.data.meta.kind : '';
    if (kind === 'order') {
      var sec4 = el('section', 'rct-sec');
      sec4.appendChild(ph(el('h4', 'rct-sec__title', '\u25B8 \u660E\u7EC6\u884C'), 'editor.sec.items'));
      var s4 = el('div', 'rct-sec__body');
      var items = Array.isArray(this.engine.data.items) ? this.engine.data.items : [];
      if (!items.length) s4.appendChild(el('p', 'rct-tip', '\u8FD9\u5F20\u5C0F\u7968\u6CA1\u6709\u660E\u7EC6\u884C\u3002'));
      items.forEach(function (it, i) {
        var row = el('div', 'rct-item-row');
        row.appendChild(el('span', 'rct-item-row__name', esc(String(it.name || '').slice(0, 10))));
        var up = el('button', 'rct-mini', '\u2191'); up.type = 'button';
        up.addEventListener('click', function () { self.engine.moveItem(i, -1); });
        var dn = el('button', 'rct-mini', '\u2193'); dn.type = 'button';
        dn.addEventListener('click', function () { self.engine.moveItem(i, 1); });
        var del = el('button', 'rct-mini rct-mini--danger', '\u2715'); del.type = 'button';
        del.setAttribute('data-role', 'item-remove');
        del.addEventListener('click', function () { self.engine.removeItem(i); });
        row.appendChild(up); row.appendChild(dn); row.appendChild(del);
        s4.appendChild(row);
      });
      var add = el('button', 'rct-btn rct-btn--wide', '\uFF0B \u65B0\u589E\u660E\u7EC6\u884C');
      add.type = 'button';
      add.setAttribute('data-role', 'item-add');
      add.addEventListener('click', function () { self.engine.addItem(0); });
      s4.appendChild(add);
      sec4.appendChild(s4);
      body.appendChild(sec4);
    }

    /* 段5 文案库 */
    var sec5 = el('section', 'rct-sec');
    sec5.appendChild(ph(el('h4', 'rct-sec__title', '\u25B8 \u6587\u6848\u5E93'), 'editor.sec.phrases'));
    var s5 = el('div', 'rct-sec__body');
    var chips = el('div', 'rct-chips');
    this.engine.listPhrases().forEach(function (p) {
      var b = el('button', 'rct-chip rct-chip--btn', esc(p.text.slice(0, 10) + '\u2026'));
      b.type = 'button';
      b.setAttribute('title', p.group + '\uFF1A' + p.text);
      b.addEventListener('click', function () { self.engine.appendNote(p.text); });
      chips.appendChild(b);
    });
    s5.appendChild(chips);
    s5.appendChild(el('p', 'rct-tip', '\u70B9\u4E00\u4E0B\u5C31\u628A\u8FD9\u53E5\u8BDD\u8FFD\u52A0\u5230\u788E\u788E\u5FF5\u91CC\u3002'));
    sec5.appendChild(s5);
    body.appendChild(sec5);
    box.appendChild(body);

    return this;
  };

  function create(options) { return new Panel(options); }

  global.McdPanel = { version: '0.3.1', create: create, Panel: Panel, SOURCES: SOURCES, KIND_NAME: KIND_NAME };
})(typeof window !== 'undefined' ? window : this);
