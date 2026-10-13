/*!
 * 麦门日记 · 数据映射器  v0.3.1
 * ------------------------------------------------------------------
 * 职责：把「数据集 dataset」里的分区数据，映射成「小票数据 receipt」。
 *       这是"选择数据 → 生成小票"这一步的全部业务逻辑，与界面无关。
 *
 * 运行环境：浏览器（window.McdMappers）与 Node（module.exports）通用。
 * 契约：入参见 src/dataset.schema.json，出参见 src/receipt.schema.json。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.McdMappers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------- 小工具 ---------------------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function money(v) { return '\u00a5' + (Number(v) || 0).toFixed(2); }
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(String(s).replace(/-/g, '/'));
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(s, withTime) {
    var d = parseDate(s);
    if (!d) return s || '';
    var out = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    if (withTime) out += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return out;
  }
  /** 由时间推算餐次——麦当劳供应时段：早餐 07:14–10:15 / 午餐 10:44–14:15 / 下午茶 14:44–16:45 / 夜市 17:14–21:45 */
  function mealOf(datetime) {
    var d = parseDate(datetime);
    if (!d) return '其他';
    var m = d.getHours() * 60 + d.getMinutes();
    if (m >= 7 * 60 && m < 10 * 60 + 30) return '早餐';
    if (m >= 10 * 60 + 30 && m < 14 * 60 + 30) return '午餐';
    if (m >= 14 * 60 + 30 && m < 17 * 60) return '下午茶';
    if (m >= 17 * 60 && m < 22 * 60) return '夜市';
    return '其他';
  }
  /** 订单号脱敏：只留后 6 位并加 F- 前缀（表明虚构 / 脱敏） */
  function maskId(id) {
    var s = String(id == null ? '' : id);
    return 'F-' + (s.length > 6 ? s.slice(-6) : s || '000000');
  }

  /** 废单判定：已取消 / 已退单 / 已作废的订单，可以看，但不该占首屏 */
  function isVoidOrder(o) {
    return /取消|退单|作废/.test(String((o && o.status) || ''));
  }

  /**
   * 默认落点：最近一单「有效」订单（跳过废单）；全是废单则退回第一单。
   * ⚠️ 工作台首屏（builder）与左栏默认选中（panel）都必须走这里 ——
   *    两处各写一份就会漂移，导致「票面渲染 A 单、左栏高亮 B 单」。
   */
  function defaultOrderIndex(orders) {
    var list = Array.isArray(orders) ? orders : [];
    for (var i = 0; i < list.length; i++) if (!isVoidOrder(list[i])) return i;
    return 0;
  }
  /** 清理活动简介里的 HTML 标签与多余空行 */
  function cleanText(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s·、]+/, '')
      .trim();
  }
  function listOf(dataset, key) {
    var s = dataset && dataset.sections ? dataset.sections[key] : null;
    return Array.isArray(s) ? s : [];
  }
  /** 会员编号：把账户 ID（UUID）裁成小票上好读的一行。
   *  MCP 拿不到昵称 / 姓名（`query-my-account` 只返回 accountId 与各项积分，
   *  `order-list` 只有订单字段），`accountId` 是唯一能代表"用户本人"的真实字段，
   *  因此用它做票尾签名区的编号 —— 有真实来源，不是编出来的（D-032）。 */
  function deriveMemberNo(accountId) {
    if (!accountId) return '';
    var hex = String(accountId).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length < 8) return '';
    return 'No.' + hex.slice(0, 4) + '-' + hex.slice(4, 8);
  }

  function baseReceipt(kind, title, source, account) {
    return {
      meta: {
        receiptNo: 'F-NO.' + String(Date.now()).slice(-4),
        generatedAt: new Date().toISOString(),
        source: source || 'mcp',
        kind: kind,
        brand: '麦门日记',                                  // 票头字标（与门店名构成"品牌 → 门店"两级）
        title: title || '',
        badge: ''                                           // 徽标：有实在内容时才显示（D-028）
      },
      store: { name: '', code: '', address: '', phone: '' },
      // datetime 兜底为生成时间：签名区总得有个日期，非点单类小票没有真实下单时间
      order: { datetime: new Date().toISOString(), orderType: '', takeWay: '', orderNo: '', pickupCode: '', remark: '', address: '' },
      items: [],
      fees: { productPrice: 0, packing: 0, delivery: 0, tableware: 0 },
      amounts: { subtotal: 0, discount: 0, delivery: 0, total: 0, currency: 'CNY', mode: 'items', listPrice: 0 },
      coupons: [],
      member: { points: 0, level: '', no: deriveMemberNo(account && account.accountId) },
      journal: { moodLabel: '', note: '', signature: '—— 麦门日记' },  // 心情 emoji 已移除（D-031）；signature 供票尾签名区落款
      avatar: { kind: 'none' },        // 界面无头像入口，默认不注入（D-030）
      blocks: []
      // deco 刻意不设默认值 → 留给引擎回落到模板 manifest.defaultDeco（D-032）
    };
  }

  /** 票头徽标：文创小票的"仪式感"标题；没有实在内容就返回空串（不占位） */
  function badgeOf(kind) {
    if (kind === 'activity') return '🎉 恭喜我解锁了！';
    if (kind === 'collectible') return '🎉 恭喜我获得了！';
    if (kind === 'loot') return '🎉 恭喜我获得了！';
    return '';
  }

  /* ---------------------------- 1. 历史点单小票 ---------------------------- */

  /** 一张真实历史订单 → 小票。金额只展整单合计（order-list 无单项单价，不臆造） */
  function mapOrder(order, account) {
    var r = baseReceipt('order', '', 'mcp', account);
    var items = Array.isArray(order.items) ? order.items : [];
    r.meta.receiptNo = maskId(order.id);
    r.order.datetime = order.datetime || '';
    r.order.orderType = order.orderType || '\u5230\u5e97\u81ea\u53d6';
    r.order.takeWay = order.takeWay || order.meal || '';
    r.order.orderNo = maskId(order.id);
    r.store.name = order.storeName || '';
    r.store.code = order.storeCode || '';

    r.items = items.map(function (it) {
      var combo = Array.isArray(it.combo) ? it.combo : [];
      return {
        name: it.name || '\u9910\u54c1',
        // 套餐子项拼进规格文案，历史小票最动人的就是这一行
        spec: combo.length
          ? combo.map(function (c) { return c.name + (c.qty > 1 ? ' \u00d7' + c.qty : ''); }).join(' + ')
          : '',
        qty: Number(it.qty) || 1,
        amount: 0,          // 历史订单无单项金额，留空不计入
        tag: combo.length ? '\u5957\u9910' : ''
      };
    });

    // 金额：历史订单只有整单金额（无单项单价）→ 用 order 模式，只展整单合计，绝不臆造单价
    r.amounts.mode = 'order';
    r.amounts.subtotal = Number(order.total) || 0;
    r.amounts.discount = 0;
    r.amounts.delivery = 0;
    r.amounts.total = Number(order.total) || 0;
    r.member.points = Number(account && account.availablePoint) || 0;

    if (order.status && /取消/.test(order.status)) {
      r.journal.moodLabel = '\u8fd9\u5355\u53d6\u6d88\u4e86';
      r.journal.note = '\u8ba2\u5355\u72b6\u6001\uff1a' + order.status + '\u3002\u8bb0\u5f55\u4e00\u4e0b\uff0c\u4e5f\u7b97\u5403\u8fc7\u3002';
    } else {
      r.journal.moodLabel = order.meal ? order.meal + '\u7684\u5b89\u6170' : '\u4e00\u987f\u597d\u5403\u7684';
      r.journal.note = fmtDate(order.datetime, false) + '\uff0c\u5728' + (order.storeName || '\u9ea6\u5f53\u52b3') + '\u5403\u7684\u8fd9\u4e00\u987f\u3002';
    }
    return r;
  }

  /* ---------------------- 1b. 历史点单小票 · 明细版 ---------------------- */

  /**
   * 明细版历史小票（query-order → 小票）。
   * order = order-list 的索引项；detail = query-order 的返回。
   * detail 为空时自动降级为 mapOrder（整单金额版式），绝不臆造单价。
   */
  function mapOrderDetail(order, detail, account) {
    if (!detail) return mapOrder(order, account);
    var o = order || {};
    var d = detail || {};
    var r = baseReceipt('order', '', 'mcp', account);
    r.meta.receiptNo = maskId(o.id || d.orderNo);
    r.meta.badge = d.pickupCode ? ('取餐码 ' + d.pickupCode) : '';

    r.store.name = d.storeName || o.storeName || '';
    r.store.code = o.storeCode || '';
    r.store.address = d.storeAddress || d.address || '';
    r.order.datetime = d.createTime || o.datetime || '';
    r.order.orderType = o.orderType || '\u5230\u5E97\u81EA\u53D6';
    r.order.takeWay = d.takeWay || o.takeWay || '';
    r.order.orderNo = maskId(o.id || d.orderNo);
    r.order.pickupCode = d.pickupCode || '';
    r.order.remark = d.remark || '';
    r.order.address = d.address || '';

    var lines = Array.isArray(d.lines) ? d.lines : [];
    r.items = lines.map(function (it) {
      var combo = Array.isArray(it.combo) ? it.combo : [];
      return {
        name: it.name || it.productName || '\u9910\u54C1',
        spec: it.spec || (combo.length
          ? combo.map(function (c) { return c.name + (c.qty > 1 ? ' \u00D7' + c.qty : ''); }).join(' + ')
          : ''),
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unitPrice != null ? it.unitPrice : it.price) || 0,
        amount: Number(it.amount) || 0,
        tag: combo.length ? '\u5957\u9910' : '',
        // 官方商品图：MCP 的字段叫 productImage（不是 image），直连 CDN。
        // 只供左栏辨认订单用，模板里没有任何 data-field 引用它，所以不会进小票（D-021）。
        image: it.image || it.productImage || null
      };
    });

    r.fees = {
      productPrice: Number(d.fees && d.fees.productPrice) || 0,
      packing: Number(d.fees && d.fees.packing) || 0,
      delivery: Number(d.fees && d.fees.delivery) || 0,
      tableware: Number(d.fees && d.fees.tableware) || 0
    };
    r.coupons = (Array.isArray(d.coupons) ? d.coupons : []).map(function (c) {
      return { name: c.name || c.title || '\u4F18\u60E0', amount: Number(c.amount) || 0 };
    });

    var itemSum = r.items.reduce(function (s, it) { return s + (Number(it.amount) || 0); }, 0);
    var discount = Number(d.discount) || r.coupons.reduce(function (s, c) { return s + c.amount; }, 0);
    r.amounts.mode = 'detail';
    // listPrice 优先采信平台给的「原价合计」（= 商品 + 配送 + 打包），它与 Σ品项原价不是一回事
    r.amounts.listPrice = Number(d.listPrice) || Math.round(itemSum * 100) / 100;
    r.amounts.subtotal = Math.round(itemSum * 100) / 100;
    r.amounts.discount = Math.round(discount * 100) / 100;
    // 显式传 0 也要认（麦乐送常出现「配送费 6 元、实付 0 元」）
    r.amounts.delivery = (d.delivery === undefined || d.delivery === null)
      ? (r.fees.delivery || 0)
      : Number(d.delivery) || 0;
    r.amounts.total = (d.total === undefined || d.total === null)
      ? Math.round((r.amounts.subtotal + r.amounts.delivery + r.fees.packing + r.fees.tableware - r.amounts.discount) * 100) / 100
      : Number(d.total) || 0;
    r.member.points = Number(account && account.availablePoint) || 0;

    r.journal.moodLabel = o.meal ? o.meal + '\u7684\u5B89\u6170' : '\u4E00\u987F\u597D\u5403\u7684';
    r.journal.note = r.order.remark
      ? '\u6211\u81EA\u5DF1\u5199\u7684\u5907\u6CE8\uFF1A' + r.order.remark
      : fmtDate(r.order.datetime, false) + '\uFF0C\u5728' + (r.store.name || '\u9EA6\u5F53\u52B3') + '\u5403\u7684\u8FD9\u4E00\u987F\u3002';
    return r;
  }

  /* ---------------------------- 2. 积分存折 ---------------------------- */

  function mapPoints(account, orders) {
    var a = account || {};
    var list = Array.isArray(orders) ? orders : listOf({ sections: { orders: orders } }, 'orders');
    var total = 0;
    list.forEach(function (o) { total += Number(o.total) || 0; });

    var r = baseReceipt('points', '\u9ea6\u95e8\u79ef\u5206\u5b58\u6298', 'mcp', a);
    var acc = Number(a.accumulativePoint) || 0;
    var available = Number(a.availablePoint) || 0;
    var used = Number(a.usedPoint) || 0;
    var expired = Number(a.expiredPoint) || 0;

    // 积分折算：以巨无霸 ¥25.5 为度量单位，把抽象积分变成能感知的东西
    var bigMac = Math.round(acc / 25.5);
    r.summary = [
      { label: '\u53ef\u7528\u79ef\u5206', value: String(available) },
      { label: '\u7d2f\u8ba1\u79ef\u5206', value: String(acc) },
      { label: '\u5df2\u4f7f\u7528', value: String(used) },
      { label: '\u5df2\u8fc7\u671f', value: String(expired) },
      { label: '\u5e94\u7528', value: a.currency || '\u9ea6\u4eab\u4f1a\u79ef\u5206' }
    ];
    r.stats = [
      { label: '\u79ef\u5206\u6298\u7b97', value: '\u2248 ' + bigMac + ' \u4e2a\u5de8\u65e0\u9738', hint: '\u6309 \u00a525.5 / \u4e2a\u4f30\u7b97' },
      { label: '\u672c\u6708\u5373\u5c06\u8fc7\u671f', value: String(Number(a.currentMonthExpirePoint) || 0), hint: '\u60f3\u7528\u5c31\u522b\u7b49' },
      { label: '\u5386\u53f2\u6d88\u8d39\u7d2f\u8ba1', value: money(total), hint: list.length + ' \u5355' }
    ];
    r.items = [
      { name: '\u53ef\u7528\u79ef\u5206', spec: '\u968f\u65f6\u53ef\u5151', qty: 1, amount: 0 },
      { name: '\u7d2f\u8ba1\u79ef\u5206', spec: '\u8fd9\u4e9b\u5e74\u5403\u8fc7\u7684\u9ea6\u5f53\u52b3', qty: 1, amount: 0 },
      { name: '\u5386\u53f2\u8fc7\u671f', spec: '\u6ca1\u6765\u5f97\u53ca\u7528\u7684\u90e8\u5206', qty: 1, amount: 0 }
    ];
    r.member.points = available;
    r.journal.moodLabel = '\u79ef\u5206\u8d26\u6237\u5065\u5eb7\u62a5\u544a';
    r.journal.note = '\u7d2f\u8ba1 ' + acc + ' \u79ef\u5206\uff0c\u6362\u7b97\u4e0b\u6765\u5927\u6982 ' + bigMac + ' \u4e2a\u5de8\u65e0\u9738\u3002\u8fd9\u5c31\u662f\u6211\u7684\u9ea6\u95e8\u5c65\u5386\u3002';
    return r;
  }

  /* ---------------------------- 3. 活动票根 ---------------------------- */

  /** 「已获得」判定：联名/活动/周边只展示真正拿到手的（决策 D-020） */
  function isObtained(x) {
    return !!(x && (x.obtained === true || x.attended === true || x.owned === true));
  }
  /** 「已获得」的依据文案：命中订单写依据，手动标记写本地标记 */
  function evidenceOf(x) {
    if (!x) return '';
    if (x.evidence || x.obtainedDate) return '\u4F9D\u636E\uFF1A\u4F60\u4E8E ' + fmtDate(x.evidence || x.obtainedDate, false) + ' \u8D2D\u4E70\u8FC7\u76F8\u5173\u5546\u54C1';
    if (x.manual) return '\u6211\u7684\u6807\u8BB0\uFF08\u672C\u5730\uFF09';
    return '';
  }

  function mapActivity(activities, opts) {
    var o = opts || {};
    var list = Array.isArray(activities) ? activities : [];
    var picks = o.includeUnowned ? list : list.filter(isObtained);
    var r = baseReceipt('activity', '\u6211\u7684\u9EA6\u95E8\u6D3B\u52A8', 'mcp', o.account);
    r.meta.title = o.title || '\u6211\u7684\u9EA6\u95E8\u6D3B\u52A8';
    r.meta.badge = badgeOf('activity');
    r.items = picks.slice(0, 20).map(function (a) {
      return {
        name: a.title || '\u6D3B\u52A8',
        spec: [evidenceOf(a), a.brand, fmtDate(a.date, false)].filter(Boolean).join(' \u00B7 '),
        qty: 1,
        amount: 0,
        obtained: true,
        tag: a.kind || ''
      };
    });
    r.summary = [
      { label: '\u6211\u89E3\u9501\u7684\u6D3B\u52A8', value: String(picks.length) },
      { label: '\u6700\u8FD1\u4E00\u6B21', value: fmtDate(picks.length ? picks[0].date : '', false) },
      { label: '\u6700\u65E9\u4E00\u6B21', value: fmtDate(picks.length ? picks[picks.length - 1].date : '', false) }
    ];
    r.journal.moodLabel = '\u8FD9\u4E9B\u90FD\u662F\u6211\u7684';
    r.journal.note = picks.length
      ? picks.slice(0, 3).map(function (a) { return '\u00B7 ' + a.title; }).join('\n')
      : '\u8FD8\u6CA1\u89E3\u9501\u4EFB\u4F55\u6D3B\u52A8\uFF0C\u53BB\u770B\u770B\u6709\u4EC0\u4E48\u65B0\u73A9\u610F\u513F\u3002';
    return r;
  }

  /* ---------------------------- 4. 联名图鉴 ---------------------------- */

  function mapCollectibles(collectibles, opts) {
    var o = opts || {};
    var list = Array.isArray(collectibles) ? collectibles : [];
    var picks = o.includeUnowned ? list : list.filter(isObtained);
    var r = baseReceipt('collectible', '\u6211\u7684\u9EA6\u95E8\u56FE\u9274', 'mcp', o.account);
    r.meta.title = o.title || '\u6211\u7684\u9EA6\u95E8\u56FE\u9274';
    r.meta.badge = badgeOf('collectible');
    r.items = picks.slice(0, 30).map(function (c) {
      return {
        name: c.name || '\u5468\u8FB9',
        spec: [evidenceOf(c), c.series, c.type, c.price ? '\u00A5' + c.price : (c.point ? c.point + ' \u79EF\u5206' : ''), fmtDate(c.releaseDate, false)]
          .filter(Boolean).join(' \u00B7 '),
        qty: 1,
        amount: 0,
        obtained: true,
        tag: c.type || ''
      };
    });
    var series = [];
    picks.forEach(function (c) {
      if (c.series && series.indexOf(c.series) === -1) series.push(c.series);
    });
    r.summary = [
      { label: '\u6211\u5DF2\u5165\u624B', value: String(picks.length) + ' \u4EF6' },
      { label: '\u6700\u8FD1\u4E00\u4EF6', value: picks.length ? String(picks[0].name || '').slice(0, 12) : '\u2014' },
      { label: '\u7CFB\u5217', value: series.slice(0, 3).join('\u3001') || '\u2014' }
    ];
    r.stats = [
      { label: '\u6536\u96C6\u4EF6\u6570', value: String(picks.length), hint: '\u90FD\u662F\u771F\u91D1\u767D\u94F6\u6362\u6765\u7684' }
    ];
    r.journal.moodLabel = '\u6211\u7684\u6536\u85CF\u67DC';
    r.journal.note = picks.length
      ? '\u5171 ' + picks.length + ' \u4EF6\u5DF2\u5165\u624B\u3002\u6BCF\u4E00\u4EF6\u90FD\u6709\u5B83\u7684\u6545\u4E8B\u3002'
      : '\u8FD8\u6CA1\u6709\u5165\u624B\u7684\u8054\u540D\u5468\u8FB9\u3002';
    return r;
  }

  /* ---------------------------- 5. 趣味统计 ---------------------------- */

  /** 从数据集里挖值得做成小票的趣味数据。全部为纯计算，不臆造 */
  function computeFun(dataset) {
    var orders = listOf(dataset, 'orders');
    var account = dataset && dataset.account ? dataset.account : {};
    var collectibles = listOf(dataset, 'collectibles');
    var prizes = listOf(dataset, 'prizes');

    // 已取消的订单不计入花费与「最贵一单」，否则统计口径会虚高（F-11）
    var valid = orders.filter(function (o) { return !/\u53D6\u6D88/.test(String(o && o.status || '')); });
    var cancelledCount = orders.length - valid.length;

    var stores = {};
    var itemCount = {};
    var mealCount = {};
    var total = 0;
    var maxOrder = null;

    valid.forEach(function (o) {
      if (o.storeName) stores[o.storeName] = (stores[o.storeName] || 0) + 1;
      total += Number(o.total) || 0;
      if (!maxOrder || Number(o.total) > Number(maxOrder.total)) maxOrder = o;
      var meal = o.meal || mealOf(o.datetime);
      mealCount[meal] = (mealCount[meal] || 0) + 1;
      (o.items || []).forEach(function (it) {
        if (!it.name) return;
        itemCount[it.name] = (itemCount[it.name] || 0) + (Number(it.qty) || 1);
      });
    });

    var topItems = Object.keys(itemCount).sort(function (a, b) { return itemCount[b] - itemCount[a]; }).slice(0, 3);
    var storeList = Object.keys(stores)
      .map(function (n) { return { name: n, count: stores[n] }; })
      .sort(function (a, b) { return b.count - a.count; });
    var dates = valid.map(function (o) { return parseDate(o.datetime); }).filter(Boolean).sort(function (a, b) { return a - b; });
    var spanDays = dates.length > 1 ? Math.round((dates[dates.length - 1] - dates[0]) / 86400000) : 0;

    return {
      orderCount: valid.length,
      cancelledCount: cancelledCount,
      totalSpend: Math.round(total * 100) / 100,
      storeCount: storeList.length,
      storeNames: storeList.map(function (s) { return s.name; }),
      stores: storeList,
      topItems: topItems.map(function (n) { return { name: n, count: itemCount[n] }; }),
      mealCount: mealCount,
      maxOrder: maxOrder,
      spanDays: spanDays,
      firstDate: dates.length ? dates[0] : null,
      lastDate: dates.length ? dates[dates.length - 1] : null,
      accumulativePoint: Number(account.accumulativePoint) || 0,
      collectibleTotal: collectibles.length,
      collectibleOwned: collectibles.filter(isObtained).length,
      prizeCount: prizes.length
    };
  }

  function mapFun(dataset, opts) {
    var f = computeFun(dataset);
    var r = baseReceipt('fun', '\u9ea6\u95e8\u5c65\u5386\u5c0f\u7968', 'mcp', (opts && opts.account) || (dataset && dataset.account));
    r.meta.title = (opts && opts.title) || '\u9ea6\u95e8\u5c65\u5386\u5c0f\u7968';

    r.summary = [
      { label: '\u70b9\u5355\u603b\u6570', value: f.orderCount + ' \u5355' },
      { label: '\u7d2f\u8ba1\u82b1\u8d39', value: money(f.totalSpend) },
      { label: '\u8de8\u8d8a\u5929\u6570', value: f.spanDays + ' \u5929' }
    ];

    r.stats = [
      { label: '\u95e8\u5e97\u8db3\u8ff9', value: f.storeCount + ' \u5bb6', hint: f.storeNames.slice(0, 2).join('\u3001') },
      { label: '\u6700\u8d35\u4e00\u5355', value: money(f.maxOrder ? f.maxOrder.total : 0), hint: f.maxOrder ? fmtDate(f.maxOrder.datetime, false) : '' },
      {
        label: '\u5e38\u70b9 TOP',
        value: f.topItems.length ? f.topItems[0].name : '\u2014',
        hint: f.topItems.map(function (t) { return t.name + '\u00d7' + t.count; }).join('\u3001')
      },
      {
        label: '\u996d\u70b9\u5206\u5e03',
        value: Object.keys(f.mealCount).sort(function (a, b) { return f.mealCount[b] - f.mealCount[a]; })[0] || '\u2014',
        hint: Object.keys(f.mealCount).map(function (k) { return k + '\u00d7' + f.mealCount[k]; }).join('\u3001')
      },
      { label: '\u7d2f\u8ba1\u79ef\u5206', value: String(f.accumulativePoint), hint: '\u2248 ' + Math.round(f.accumulativePoint / 25.5) + ' \u4e2a\u5de8\u65e0\u9738' },
      { label: '\u8054\u540d\u6536\u96c6', value: f.collectibleOwned + ' / ' + f.collectibleTotal, hint: '\u4e2d\u5956 ' + f.prizeCount + ' \u6b21' }
    ];
    if (f.cancelledCount > 0) {
      r.stats.push({ label: '\u5df2\u53d6\u6d88', value: f.cancelledCount + ' \u5355', hint: '\u6ca1\u5403\u4e0a\u7684\u90a3\u51e0\u987f' });
    }

    r.items = f.stores.map(function (s) {
      return { name: s.name, spec: '\u53bb\u8fc7 ' + s.count + ' \u6b21', qty: 1, amount: 0 };
    });
    r.journal.moodLabel = '\u6570\u636e\u4e0d\u4f1a\u9a97\u4eba';
    r.journal.note = f.orderCount
      ? '\u4ece ' + fmtDate(f.firstDate, false) + ' \u5230 ' + fmtDate(f.lastDate, false) + '\uff0c\u5171 ' + f.orderCount + ' \u5355\u3001' + money(f.totalSpend) + '\u3002'
      : '\u8fd8\u6ca1\u6709\u8db3\u591f\u7684\u70b9\u5355\u8bb0\u5f55\u3002';
    return r;
  }

  /* ---------------------------- 6. 战利品票根 ---------------------------- */

  /** 奖品 + 券 → 战利品票根（kind=loot） */
  function mapLoot(dataset, opts) {
    var o = opts || {};
    var prizes = listOf(dataset, 'prizes');
    var coupons = listOf(dataset, 'coupons');
    var r = baseReceipt('loot', '\u9EA6\u95E8\u6218\u5229\u54C1', 'mcp', (opts && opts.account) || (dataset && dataset.account));
    r.meta.title = o.title || '\u9EA6\u95E8\u6218\u5229\u54C1';
    r.meta.badge = badgeOf('loot');

    r.items = prizes.map(function (p) {
      return {
        name: p.name || '\u5956\u54C1',
        spec: [p.typeText, p.recordTime, p.statusText ? '\u72B6\u6001\uFF1A' + p.statusText : ''].filter(Boolean).join(' \u00B7 '),
        qty: 1, amount: 0, obtained: true, tag: '\u4E2D\u5956'
      };
    }).concat(coupons.map(function (c) {
      return {
        name: c.title || c.name || '\u4F18\u60E0\u5238',
        spec: c.kind === 'owned' ? '\u5DF2\u5728\u5361\u5305' : '\u53EF\u9886\u53D6',
        qty: 1, amount: 0, obtained: c.kind === 'owned', tag: '\u5238'
      };
    }));

    var ownedCoupons = coupons.filter(function (c) { return c.kind === 'owned'; }).length;
    r.summary = [
      { label: '\u4E2D\u5956\u6B21\u6570', value: String(prizes.length) },
      { label: '\u5361\u5305\u5238', value: String(ownedCoupons) },
      { label: '\u53EF\u9886\u5238', value: String(coupons.length - ownedCoupons) }
    ];
    r.stats = [
      { label: '\u6218\u5229\u54C1\u5408\u8BA1', value: String(prizes.length + coupons.length) + ' \u4EF6', hint: '\u90FD\u662F\u767D\u634E\u7684' }
    ];
    r.journal.moodLabel = '\u624B\u6C14\u4E0D\u9519';
    r.journal.note = prizes.length
      ? '\u4E2D\u8FC7 ' + prizes.length + ' \u6B21\u5956\uFF0C\u5361\u5305\u91CC\u8FD8\u6709 ' + coupons.length + ' \u5F20\u5238\u3002'
      : '\u8FD8\u6CA1\u6709\u4E2D\u5956\u8BB0\u5F55\uFF0C\u4F46\u5361\u5305\u91CC\u6709 ' + coupons.length + ' \u5F20\u5238\u3002';
    return r;
  }

  /* ---------------------------- 对外接口 ---------------------------- */

  return {
    version: '0.3.1',
    mealOf: mealOf,
    maskId: maskId,
    isVoidOrder: isVoidOrder,
    defaultOrderIndex: defaultOrderIndex,
    money: money,
    cleanText: cleanText,
    isObtained: isObtained,
    evidenceOf: evidenceOf,
    computeFun: computeFun,
    mapOrder: mapOrder,
    mapOrderDetail: mapOrderDetail,
    mapPoints: mapPoints,
    mapActivity: mapActivity,
    mapCollectibles: mapCollectibles,
    mapFun: mapFun,
    mapLoot: mapLoot
  };
});
