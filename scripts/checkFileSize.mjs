#!/usr/bin/env node
// 文件体积门禁（ratchet 台账）：约束「往单个文件里死命堆逻辑」的持续膨胀。
//
// 规则（详见 AGENTS.md「文件体积红线」）：
//   - src/ electron/ shared/ 下的 .ts/.tsx/.css 单文件硬上限 HARD_LIMIT 行；
//   - 已超限文件登记在 scripts/fileSizeBaseline.json，只许减不许增；
//   - 文件变小后必须同步收紧台账，防止悄悄涨回去。
//
// 用法：
//   npm run size:check     门禁校验（CI 与本地同一入口）
//   npm run size:baseline  重生成台账（显式动作，diff 可见，需在 PR 说明理由）

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['src', 'electron', 'shared'];
const EXTS = new Set(['.ts', '.tsx', '.css']);
const HARD_LIMIT = 1000; // 硬上限：新文件一步到位拒绝
const SOFT_LIMIT = 700; // 提示线：接近就该考虑拆分
const BASELINE_PATH = join(ROOT, 'scripts', 'fileSizeBaseline.json');

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (EXTS.has(name.slice(name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

// 行数口径唯一来源：生成台账与校验同走这里，不存在口径漂移
function countLines(p) {
  const text = readFileSync(p, 'utf8');
  if (text === '') return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');
const pad = (n) => String(n).padStart(5);

function collect() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const dir = join(ROOT, root);
    if (existsSync(dir)) files.push(...listFiles(dir));
  }
  return files.map((p) => [rel(p), countLines(p)]);
}

const updating = process.argv.includes('--update');
const all = collect();
const over = all.filter(([, n]) => n > HARD_LIMIT).sort((a, b) => b[1] - a[1]);

if (updating) {
  writeFileSync(BASELINE_PATH, JSON.stringify(Object.fromEntries(over), null, 2) + '\n');
  console.log(`已重生成台账：${over.length} 个超限文件 → scripts/fileSizeBaseline.json`);
  for (const [p, n] of over) console.log(`  ${pad(n)}  ${p}`);
  process.exit(0);
}

// ---- 门禁校验 ----
const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {};
const nowOver = new Set(over.map(([p]) => p));

const grows = [];
const news = [];
const shrinks = [];
for (const [p, n] of over) {
  const prev = baseline[p];
  if (prev === undefined) news.push(`${pad(n)}  ${p}`);
  else if (n > prev) grows.push(`${pad(prev)} → ${pad(n)}（+${n - prev}）  ${p}`);
  else if (n < prev) shrinks.push(`${pad(prev)} → ${pad(n)}（−${prev - n}）  ${p}`);
}
const stale = Object.keys(baseline).filter((p) => !nowOver.has(p));

if (news.length + grows.length + shrinks.length + stale.length === 0) {
  const near = all
    .filter(([p, n]) => n > SOFT_LIMIT && !nowOver.has(p))
    .sort((a, b) => b[1] - a[1]);
  console.log(`✓ 体积门禁通过：${all.length} 个文件，${over.length} 个存量超限在台账内未增长。`);
  if (near.length) {
    console.log(`  接近上限（>${SOFT_LIMIT} 行），加逻辑前先想想拆分：`);
    for (const [p, n] of near) console.log(`  ${pad(n)}  ${p}`);
  }
  process.exit(0);
}

const fail = (title, items, advice) => {
  if (!items.length) return;
  console.error(`✗ ${title}`);
  for (const it of items) console.error(`    ${it}`);
  console.error(`    → ${advice}`);
};
fail('新超限文件', news, '先拆分再落地：把独立域抽成模块，单文件不许一步写超 1000 行。');
fail(
  '存量超限文件继续增长',
  grows,
  '把本次逻辑抽到独立模块/相邻子目录；确实必须增长时 npm run size:baseline 重生成台账，并在 PR 描述写明理由。',
);
fail('台账可收紧（文件已变小）', shrinks, '运行 npm run size:baseline 同步收紧台账，防止日后悄悄涨回。');
fail('台账过期（条目已不在超限名单）', stale, '文件已删除或已拆下线：运行 npm run size:baseline 清理台账。');
process.exit(1);
