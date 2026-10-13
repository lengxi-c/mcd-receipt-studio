#!/usr/bin/env node
/*!
 * 麦门日记 · 命令行入口（零依赖，Node ≥ 18）
 * ------------------------------------------------------------------
 *   node cli.js list                          列出已登记模板
 *   node cli.js check                         模板契约检查 + 示例数据校验
 *   node cli.js build --all                   构建全部产物（examples/output/*.html + index.html）
 *   node cli.js build --template <id>          构建单个模板产物
 *        [--data <file>] [--out <file>]
 *   node cli.js validate --data <file>        校验一份 receipt 数据是否符合契约
 *   node cli.js selftest                      一键自检（数据 + 全部模板 + 全量构建）
 */
'use strict';

const path = require('path');
const b = require('./src/builder.js');

const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', red: '\u001b[31m',
  green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m', bold: '\u001b[1m'
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function rel(p) { return path.relative(b.ROOT, p).split(path.sep).join('/'); }

/* ------------------------------ 命令 ------------------------------ */

function cmdList() {
  const ids = b.listTemplateIds();
  console.log(C.bold + '已登记模板（templates/index.json）' + C.reset);
  console.log('');
  ids.forEach(function (id, i) {
    try {
      const t = b.loadTemplate(id);
      const m = t.manifest;
      const status = m.status === 'ready' ? C.green + 'ready' + C.reset : C.yellow + (m.status || 'placeholder') + C.reset;
      const fields = (t.html.match(/data-field/g) || []).length;
      console.log(
        '  ' + (i + 1) + '. ' + C.cyan + m.id + C.reset +
        '  ' + (m.name || '') +
        '\n     ' + C.dim + 'v' + (m.version || '?') + ' · ' + status + ' · ' + fields + ' 个字段标注 · ' + rel(t.dir) + C.reset
      );
    } catch (e) {
      console.log('  ' + (i + 1) + '. ' + C.red + id + '  ✗ ' + e.message + C.reset);
    }
  });
  console.log('');
}

/** 取数据集：默认 demo，可用 --dataset <file> 换成真实数据（用于 D6 真实演练回归） */
function pickDataset(args) {
  const dsPath = args && typeof args.dataset === 'string' ? args.dataset : null;
  return {
    path: dsPath,
    label: dsPath ? rel(dsPath) : 'examples/demo-dataset.json',
    data: dsPath ? JSON.parse(require('fs').readFileSync(dsPath, 'utf8')) : b.demoDataset()
  };
}

function cmdCheck(args) {
  const data = b.demoData();
  const ds = pickDataset(args);
  const dataset = ds.data;
  let fail = 0;

  console.log(C.bold + '① 示例小票数据（examples/demo-data.json）' + C.reset);
  const v = b.validateData(data);
  if (v.ok) console.log('  ' + C.green + '✓ 契约校验通过' + C.reset);
  else { v.errors.forEach(function (e) { console.log('  ' + C.red + '✗ ' + e + C.reset); }); fail++; }
  v.warnings.forEach(function (w) { console.log('  ' + C.yellow + '! ' + w + C.reset); });

  console.log('');
  console.log(C.bold + '② 数据集（' + ds.label + '）' + C.reset);
  const dv = b.validateDataset(dataset);
  if (dv.ok) console.log('  ' + C.green + '✓ 数据集校验通过' + C.reset);
  else { dv.errors.forEach(function (e) { console.log('  ' + C.red + '✗ ' + e + C.reset); }); fail++; }
  dv.warnings.forEach(function (w) { console.log('  ' + C.yellow + '! ' + w + C.reset); });

  console.log('');
  console.log(C.bold + '③ 数据源映射链路（三类常用来源）' + C.reset);
  b.checkMappers(dataset).forEach(function (r) {
    console.log('  ' + (r.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' ' + r.kind);
    r.problems.forEach(function (p) { console.log('      ' + C.red + '✗ ' + p + C.reset); });
    if (!r.ok) fail++;
  });

  console.log('');
  console.log(C.bold + '④ 素材包（皮肤 / 装饰 / 头像）' + C.reset);
  const cat = b.checkCatalog();
  if (cat.ok) console.log('  ' + C.green + '✓ 素材符合契约（无外链、无 script/foreignObject）' + C.reset);
  else { cat.problems.forEach(function (p) { console.log('  ' + C.red + '✗ ' + p + C.reset); }); fail++; }
  cat.notes.forEach(function (n) { console.log('  ' + C.yellow + '· ' + n + C.reset); });

  console.log('');
  console.log(C.bold + '⑤ 模板契约检查' + C.reset);
  const reports = b.checkAllTemplates(data);
  reports.forEach(function (r) {
    console.log('  ' + (r.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' ' + C.cyan + r.id + C.reset +
      C.dim + '  [' + r.status + ' · ' + (r.fields || 0) + ' 字段]' + C.reset);
    r.problems.forEach(function (p) { console.log('      ' + C.red + '✗ ' + p + C.reset); if (!r.ok) fail++; });
    r.notes.forEach(function (n) { console.log('      ' + C.yellow + '· ' + n + C.reset); });
  });

  console.log('');
  console.log(fail === 0 ? C.green + C.bold + '全部通过' + C.reset : C.red + C.bold + '存在问题：' + fail + ' 项' + C.reset);
  return fail === 0;
}

function cmdBuild(args) {
  // 工作台：数据面板 + 小票舞台（MCP 数据集 → 前端挑数据生成小票）
  if (args.workspace) {
    const dsPath = typeof args.dataset === 'string' ? args.dataset : null;
    const dataset = dsPath ? JSON.parse(require('fs').readFileSync(dsPath, 'utf8')) : b.demoDataset();
    const v = b.validateDataset(dataset);
    if (!v.ok) {
      console.log(C.red + '✗ 数据集不符合契约，已中止构建：' + C.reset);
      v.errors.forEach(function (e) { console.log('    ' + C.red + e + C.reset); });
      return false;
    }
    const out = typeof args.out === 'string' ? args.out : path.join(b.ROOT, 'index.html');
    const html = b.buildWorkspace(dataset, { templateId: typeof args.template === 'string' ? args.template : undefined });
    b.writeFile(out, html);
    console.log(C.green + '✓ 工作台已生成' + C.reset + '  ' + rel(out) + C.dim +
      '  (' + html.length + ' 字节 · 数据源 ' + (dsPath ? rel(dsPath) : 'examples/demo-dataset.json') + ')' + C.reset);
    return true;
  }

  if (args.all) {
    const r = b.buildAll(
      typeof args.data === 'string' ? args.data : undefined,
      typeof args.dataset === 'string' ? args.dataset : undefined
    );
    console.log(C.green + '✓ 构建完成' + C.reset + '  小票数据：' + rel(r.data) + '　数据集：' + rel(r.dataset));
    r.files.forEach(function (f) { console.log('  → ' + rel(f)); });
    return true;
  }

  const id = typeof args.template === 'string' ? args.template : null;
  if (!id) {
    console.log(C.red + '缺少 --template <id>（或用 --all 构建全部 / --workspace 构建工作台）' + C.reset);
    return false;
  }
  const data = typeof args.data === 'string' ? JSON.parse(require('fs').readFileSync(args.data, 'utf8')) : b.demoData();
  const html = b.buildProduct(id, data);
  const out = typeof args.out === 'string'
    ? args.out
    : path.join(b.EXAMPLES_DIR, 'output', id + '.html');
  b.writeFile(out, html);
  console.log(C.green + '✓ 已生成' + C.reset + '  ' + rel(out) + C.dim + '  (' + html.length + ' 字节)' + C.reset);
  return true;
}

function cmdValidate(args) {
  if (typeof args.data !== 'string') {
    console.log(C.red + '用法：node cli.js validate --data <file.json>' + C.reset);
    return false;
  }
  const data = JSON.parse(require('fs').readFileSync(args.data, 'utf8'));
  const v = b.validateData(data);
  if (v.ok) console.log(C.green + '✓ 数据符合契约：' + args.data + C.reset);
  else v.errors.forEach(function (e) { console.log(C.red + '✗ ' + e + C.reset); });
  v.warnings.forEach(function (w) { console.log(C.yellow + '! ' + w + C.reset); });
  return v.ok;
}

function cmdSelftest(args) {
  console.log(C.bold + C.cyan + '麦门日记 · 自检' + C.reset + C.dim + '  engine / 模板 / 数据集 / 选择器是否仍然对齐' + C.reset);
  console.log('');
  const data = b.demoData();
  const ds = pickDataset(args);
  const dataset = ds.data;
  let fail = 0;

  const v = b.validateData(data);
  console.log('  ' + (v.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' 小票数据契约（demo-data.json）');
  v.errors.forEach(function (e) { console.log('      ' + C.red + e + C.reset); });
  if (!v.ok) fail++;

  const dv = b.validateDataset(dataset);
  console.log('  ' + (dv.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' 数据集契约（' + ds.label + '）');
  dv.errors.forEach(function (e) { console.log('      ' + C.red + e + C.reset); });
  if (!dv.ok) fail++;

  b.checkMappers(dataset).forEach(function (r) {
    console.log('  ' + (r.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' 数据源映射 · ' + r.kind);
    if (!r.ok) { fail++; r.problems.forEach(function (p) { console.log('      ' + C.red + p + C.reset); }); }
  });

  const cat = b.checkCatalog();
  console.log('  ' + (cat.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' 素材包契约（皮肤 / 装饰 / 头像）');
  if (!cat.ok) { fail++; cat.problems.forEach(function (p) { console.log('      ' + C.red + p + C.reset); }); }

  const reports = b.checkAllTemplates(data);
  reports.forEach(function (r) {
    console.log('  ' + (r.ok ? C.green + '✓' : C.red + '✗') + C.reset + ' 模板 ' + r.id +
      C.dim + '（' + (r.fields || 0) + ' 个字段标注）' + C.reset);
    if (!r.ok) { fail++; r.problems.forEach(function (p) { console.log('      ' + C.red + p + C.reset); }); }
  });

  // 全量构建（内存中，不写盘）：确保每个模板都能产出，且工作台可构建
  try {
    b.listTemplateIds().forEach(function (id) {
      const html = b.buildProduct(id, data);
      if (!html || html.length < 1000) throw new Error(id + ' 产物过小，疑似构建失败');
    });
    const gallery = b.buildGallery(data);
    const ws = b.buildWorkspace(dataset);
    console.log('  ' + C.green + '✓' + C.reset + ' 全量构建（' + b.listTemplateIds().length + ' 模板 + 画廊 + 工作台）' +
      C.dim + '  工作台 ' + ws.length + ' 字节' + C.reset);
  } catch (e) {
    console.log('  ' + C.red + '✗ 构建失败：' + e.message + C.reset);
    fail++;
  }

  console.log('');
  console.log(fail === 0
    ? C.green + C.bold + '✓ 自检通过（可以交付）' + C.reset
    : C.red + C.bold + '✗ 自检未通过：' + fail + ' 项需要处理' + C.reset);
  return fail === 0;
}

/* ------------------------------ 主流程 ------------------------------ */

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'list': cmdList(); return 0;
    case 'check': return cmdCheck(args) ? 0 : 1;
    case 'build': return cmdBuild(args) ? 0 : 1;
    case 'validate': return cmdValidate(args) ? 0 : 1;
    case 'selftest': return cmdSelftest(args) ? 0 : 1;
    default:
      console.log([
        C.bold + '麦门日记 CLI' + C.reset,
        '',
        '  node cli.js list                     列出已登记模板',
        '  node cli.js check                    契约检查（小票数据 / 数据集 / 选择器 / 模板）[--dataset <file>]',
        '  node cli.js build --all              构建全部产物（工作台 + 各模板 + 画廊）',
        '  node cli.js build --workspace        构建工作台 index.html（--dataset / --out 可选）',
        '  node cli.js build --template <id>    构建单个模板产物（--data / --out 可选）',
        '  node cli.js validate --data <file>   校验一份 receipt 数据',
        '  node cli.js selftest                 一键自检 [--dataset <file>]'
      ].join('\n'));
      return cmd ? 1 : 0;
  }
}

process.exit(main());
