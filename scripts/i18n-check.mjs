#!/usr/bin/env node
/**
 * i18n 对账：字典与代码是否对得上、还有哪些界面文案没接 t()。
 *
 *   node scripts/i18n-check.mjs
 *
 * 输出四段：
 *   [conflict]   同一个键在不同字典分片里译法不一致（合并时后者覆盖前者，必须人工裁决）
 *   [orphan]     字典里有、代码里找不到的键（十有八九是键抄错，或代码后来改了没同步字典）
 *   [unwrapped]  界面目录（components / lib / electron）里仍是中文的字符串字面量——
 *                待接入的文案清单；所在行已有 t( 的不算（那是 t 的参数本身）
 *   [review]     src/learn、src/ai、src/agent、src/user 里的中文残留——这些目录大量
 *                存在**发给模型的提示词**（不该翻译），只列文件计数供人工过目
 *
 * 注释里的中文一律忽略。脚本只做启发式：引号字符串与注释剥离都不是完整的词法分析，
 * 它是接入口的清单工具，不是门禁——结果要人过目。字典条目约定**一条一行**。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CJK = /[\u4e00-\u9fff]/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const norm = (p) => p.replace(/\\/g, '/')
const relToRoot = (f) => norm(f).slice(norm(ROOT).length)

/** 粗暴剥注释：块注释整段删，行注释避开 'https://' 这类协议写法。足够对账用 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1')
}

/* ---------- 1. 读字典（一行一条：`key: 'value',` 或 `'key': 'value',`） ---------- */

const dictDir = join(SRC, 'i18n', 'en')
const byKey = new Map() // key -> Map(分片文件 -> 英文值)
const conflicts = new Set()

const LINE_RE = /^(?:'([^']*)'|"([^"]*)"|([^:'"][^:]*?))\s*:\s*('([^']*)'|"([^"]*)")\s*,?\s*$/

for (const f of walk(dictDir)) {
  const rel = relToRoot(f).replace('src/i18n/en/', '')
  for (const raw of readFileSync(f, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue
    const m = LINE_RE.exec(line)
    if (!m) continue
    const key = (m[1] ?? m[2] ?? m[3])?.trim()
    const value = m[5] ?? m[6] ?? ''
    if (!key || !CJK.test(key)) continue
    let perFile = byKey.get(key)
    if (!perFile) byKey.set(key, (perFile = new Map()))
    const prev = perFile.get(rel)
    if (prev !== undefined && prev !== value) conflicts.add(key)
    perFile.set(rel, value)
  }
}

/* ---------- 2. 扫源码 ---------- */

const srcFiles = walk(SRC).filter((f) => !norm(f).includes('/src/i18n/') && !/\.test\./.test(f))
// electron 的字典文件不算语料：否则它自己的键永远「找得到」，对账就漏了
const electronFiles = walk(join(ROOT, 'electron')).filter((f) => !/\/electron\/i18n(-strings)?\.ts$/.test(norm(f)))

const corpus = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const corpusElectron = electronFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/**
 * 运行期拼接出来的键：代码里只有模板（如 '导师人格 · {0}'），展开串永远搜不到原文。
 * 它们不是抄错，豁免对账；新增这一类键时来这里登记。
 */
const RUNTIME_COMPOSED = new Set(['导师人格 · 简洁导师', '导师人格 · 标准导师', '导师人格 · ADHD 导师'])

const orphans = [...byKey.keys()].filter(
  (k) => !RUNTIME_COMPOSED.has(k) && !corpus.includes(k) && !corpusElectron.includes(k),
)

/** 找一个文件里「没被 t( 包住」的中文引号字符串，返回计数与样例 */
function unwrappedIn(text) {
  const clean = stripComments(text)
  const samples = []
  let count = 0
  const re = /(['"`])((?:\\.|(?!\1).)*?[\u4e00-\u9fff](?:\\.|(?!\1).)*?)\1/g
  let m
  while ((m = re.exec(clean)) !== null) {
    const lineStart = clean.lastIndexOf('\n', m.index) + 1
    const lineEnd = clean.indexOf('\n', m.index)
    const line = clean.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    // t('…') 的参数本身、import 语句不算待接入；含 ${ 的模板计入数量（多半要参数化）但不给样例
    if (/\bt\(/.test(line) || /^\s*import\b/.test(line)) continue
    count++
    if (samples.length < 3 && !m[0].includes('${')) samples.push(m[0].slice(0, 90))
  }
  return { count, samples }
}

const unwrapped = []
const review = []
for (const f of [...srcFiles, ...electronFiles]) {
  const text = readFileSync(f, 'utf8')
  if (!CJK.test(stripComments(text))) continue
  const res = unwrappedIn(text)
  if (res.count === 0) continue
  const rel = relToRoot(f)
  if (/^src\/(components|lib|electron)\//.test(rel)) unwrapped.push({ file: rel, ...res })
  else if (/^src\/(learn|ai|agent|user|run)\//.test(rel)) review.push({ file: rel, count: res.count })
}

unwrapped.sort((a, b) => b.count - a.count)
review.sort((a, b) => b.count - a.count)

/* ---------- 3. 报告 ---------- */

const p = (s) => process.stdout.write(s + '\n')

p('== i18n 对账 ==')
p(`字典键总数: ${byKey.size}`)

if (conflicts.size) {
  p(`\n[conflict] ${conflicts.size} 个键在多个分片里译法不一致:`)
  for (const k of [...conflicts].slice(0, 40)) {
    p(`  ${k}`)
    for (const [file, v] of byKey.get(k)) p(`    ${file}: ${v}`)
  }
} else p('\n[conflict] 无')

if (orphans.length) {
  p(`\n[orphan] ${orphans.length} 个键在代码里找不到（键抄错或代码已改）:`)
  for (const k of orphans.slice(0, 60)) p(`  ${k}`)
  if (orphans.length > 60) p(`  …还有 ${orphans.length - 60} 个`)
} else p('\n[orphan] 无')

p(`\n[unwrapped] 界面目录待接入 ${unwrapped.length} 个文件:`)
for (const u of unwrapped.slice(0, 60)) {
  p(`  ${u.count}\t${u.file}`)
  for (const s of u.samples) p(`        ${s}`)
}
if (unwrapped.length > 60) p(`  …还有 ${unwrapped.length - 60} 个文件`)

p(`\n[review] 逻辑目录残留（多为发给模型的提示词，人工过目）${review.length} 个文件:`)
for (const r of review.slice(0, 40)) p(`  ${r.count}\t${r.file}`)
if (review.length > 40) p(`  …还有 ${review.length - 40} 个文件`)
