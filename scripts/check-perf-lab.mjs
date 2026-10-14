/**
 * 实验台自检：先构建，再在 happy-dom 里把生成好的单文件 HTML 跑一遍，
 * 确认 React 真的渲染出了工作区、点页签能切、指标区会更新。
 *
 * 只验证「能跑、能动」，不验证数字——数字要在真浏览器里看（happy-dom 没有 canvas，
 * 所以那一段在这里是空转的）。
 *
 * 用法：node scripts/check-perf-lab.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildPerfLab } from './build-perf-lab.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* 1. 构建（直接调函数，不走子进程：本机沙箱里 spawn 同款 node 会 EBUSY） */
const { target, size, prod } = await buildPerfLab()
console.log(`已生成 ${target.replace(root, '.')}  (${(size / 1024).toFixed(0)} KB, React ${prod ? 'production' : 'development'})`)

/* 2. 在 happy-dom 里跑一遍 */
const { Window } = await import('happy-dom')

const html = readFileSync(target, 'utf8')
const bundle = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
if (!bundle) throw new Error('没找到内联的 bundle')

const win = new Window({ url: 'http://localhost/', width: 1600, height: 900 })
const { document } = win
document.body.innerHTML = '<div id="root"></div>'
if (!win.ResizeObserver) win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

// 把 happy-dom 的全局挂到 Node 上，bundle 才能像在浏览器里那样跑
const g = globalThis
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'ResizeObserver', 'performance', 'Float32Array', 'Map', 'Set']) {
  if (win[k] === undefined) continue
  try { g[k] = win[k] } catch { Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true }) }
}
g.window = win
g.document = document
g.requestAnimationFrame = win.requestAnimationFrame.bind(win)
g.cancelAnimationFrame = win.cancelAnimationFrame.bind(win)
g.getComputedStyle = win.getComputedStyle.bind(win)

const errors = []
win.addEventListener('error', (e) => errors.push(String(e.message ?? e)))

new Function(bundle)()

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const count = (sel) => document.querySelectorAll(sel).length
const click = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
const rows = []
const check = (name, ok, extra = '') => rows.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)

await wait(150)
check('实验台根节点已渲染', count('.lab') === 1)
check('侧栏树渲染出了节点', count('.row') === 120, count('.row') + ' 行')
check('页签栏渲染出了页签', count('.tab') === 24, count('.tab') + ' 枚')
check('正文区渲染出了标题', !!document.querySelector('.doc h3'), document.querySelector('.doc h3')?.textContent)
check('对话栏渲染出了消息', count('.msg') === 24)
check('canvas 律动已挂载', !!document.querySelector('canvas'))
check('控制台有六个机制开关', count('fieldset label.check') === 6)
check('指标区就位', count('.metrics .kv') >= 4)

const activeIdx = () => [...document.querySelectorAll('.tab')].findIndex((t) => t.className.includes('active'))
click(document.querySelectorAll('.tab')[5])
await wait(250)
check('点页签能切换', activeIdx() === 5, '→ 第 ' + activeIdx() + ' 枚')
check('正文跟着换', document.querySelector('.doc h3')?.textContent?.includes('节点 5'))

click(document.querySelectorAll('.row')[9])
await wait(250)
check('点侧栏节点也能切', document.querySelector('.doc h3')?.textContent?.includes('节点 9'))

click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('切换一次页签')))
await wait(250)
const metric = document.querySelector('.metrics .kv b')?.textContent ?? ''
check('点击→首帧指标已记录', /\d/.test(metric), metric)

console.log(rows.join('\n'))
if (errors.length) console.log('\n页面错误：\n' + errors.join('\n'))
const failed = rows.filter((r) => r.startsWith('FAIL')).length
console.log('\n' + (failed ? `${failed} 项失败` : '实验台自检全部通过'))
process.exit(failed || errors.length ? 1 : 0)
