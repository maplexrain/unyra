/**
 * 设计预览内置 HTTP 服务。
 *
 * 只在主进程里起一个绑定 127.0.0.1 的小服务，供浏览器（或内置浏览器）打开：
 *   /                 选择已注册外部文件 + iframe 预览画布
 *   /api/files        当前 doc-design 目录里的 .tsx 清单（前端轮询实现热更新）
 *   /preview/<file>   动态编译该 TSX，并用 React 服务端渲染成 HTML
 *
 * 为什么不复用局域网传输服务：那个服务绑定 0.0.0.0、面向手机传文件，和这里
 * “只给本机开发者看组件”不是同一件事。这里独立端口、独立页面、只读扫描。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { app as electronApp, ipcMain } from 'electron'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compileExternalTsx } from '../../src/lib/externalModules/compile'
import type { DesignPreviewStatus } from '../../shared/ipc'
import { currentRoot, sessionPath } from '../storage/settings'

const BASE_PORT = 51900
const MAX_PORT_TRIES = 8
const MAX_FILE_BYTES = 512 * 1024
const DESIGN_DIR = 'doc-design'

type PreviewKind = 'doc-component' | 'classroom-component' | 'classroom-animation' | 'classroom-sound'

interface PreviewFile {
  file: string
  kind: PreviewKind
  label: string
  updatedAt: number
  size: number
}

interface ServerState {
  server: http.Server | null
  status: DesignPreviewStatus
}

const state: ServerState = {
  server: null,
  status: { running: false, port: 0, url: '', fileCount: 0 },
}

const KIND_PREFIXES: Array<{ prefix: string; kind: PreviewKind }> = [
  { prefix: 'doc-component--', kind: 'doc-component' },
  { prefix: 'classroom-component--', kind: 'classroom-component' },
  { prefix: 'classroom-animation--', kind: 'classroom-animation' },
  { prefix: 'classroom-sound--', kind: 'classroom-sound' },
]

const KIND_LABEL: Record<PreviewKind, string> = {
  'doc-component': '文档组件',
  'classroom-component': '课堂组件',
  'classroom-animation': '课堂动效',
  'classroom-sound': '课堂音效',
}

function currentUserId(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath(), 'utf-8')) as { userId?: unknown } | null
    if (typeof raw?.userId === 'string' && raw.userId.trim()) {
      return path.basename(raw.userId.trim())
    }
  } catch {
    // 未登录 / 会话文件还没写：页面显示空列表即可
  }
  return ''
}

function designDir(): string {
  const uid = currentUserId()
  if (!uid) return ''
  return path.join(currentRoot(), 'users', uid, DESIGN_DIR)
}

/** 预览组件需要和主应用共用主题与组件样式；从构建产物里找最新的应用 CSS。 */
async function findAppCss(): Promise<string | null> {
  const candidates: string[] = []
  try {
    candidates.push(path.join(electronApp.getAppPath(), 'dist', 'assets'))
  } catch {
    // 测试或非 Electron 环境没有 app 对象
  }
  candidates.push(path.join(process.cwd(), 'dist', 'assets'))
  for (const dir of candidates) {
    try {
      const entries = await fsp.readdir(dir)
      const css = entries.filter((name) => name.endsWith('.css')).sort().pop()
      if (css) return path.join(dir, css)
    } catch {
      // 尝试下一个候选目录
    }
  }
  return null
}

function kindOf(file: string): PreviewKind | null {
  const found = KIND_PREFIXES.find((item) => file.startsWith(item.prefix))
  return found ? found.kind : null
}

function labelOf(file: string, kind: PreviewKind): string {
  const prefix = KIND_PREFIXES.find((item) => item.kind === kind)?.prefix ?? ''
  return file.slice(prefix.length).replace(/\.tsx$/i, '').replace(/_/g, ' ') || file
}

async function listFiles(): Promise<PreviewFile[]> {
  const dir = designDir()
  if (!dir) return []
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const files: PreviewFile[] = []
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.toLowerCase().endsWith('.tsx')) continue
      const kind = kindOf(entry.name)
      if (!kind) continue
      try {
        const stat = await fsp.stat(path.join(dir, entry.name))
        files.push({
          file: entry.name,
          kind,
          label: labelOf(entry.name, kind),
          updatedAt: stat.mtimeMs,
          size: stat.size,
        })
      } catch {
        // 文件刚好被删除：跳过
      }
    }
    files.sort((a, b) => a.kind.localeCompare(b.kind) || b.updatedAt - a.updatedAt)
    return files
  } catch {
    return []
  }
}

async function readPreviewFile(file: string): Promise<{ source?: string; error?: string }> {
  if (!file || file !== path.basename(file) || !file.toLowerCase().endsWith('.tsx')) {
    return { error: '非法文件名' }
  }
  if (!kindOf(file)) return { error: '不是已注册的外部组件文件名' }
  const dir = designDir()
  if (!dir) return { error: '尚未登录，找不到用户目录' }
  const full = path.join(dir, file)
  try {
    const stat = await fsp.stat(full)
    if (stat.size > MAX_FILE_BYTES) return { error: '文件超过 512 KB，预览已跳过' }
    return { source: await fsp.readFile(full, 'utf-8') }
  } catch {
    return { error: '找不到这个外部文件' }
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function renderErrorPage(title: string, detail: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{margin:0;background:#f6f1e7;color:#2b2620;font:14px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:48px}pre{margin-top:16px;padding:18px;border:1px solid #d9d0c1;border-radius:10px;background:#fffdf8;white-space:pre-wrap;word-break:break-word}</style>
<h2>${esc(title)}</h2><pre>${esc(detail)}</pre>`
}

function renderMetaPage(kind: PreviewKind, file: string, def: Record<string, unknown>, source: string): string {
  const meta: Record<string, unknown> = {}
  for (const key of ['name', 'description', 'verb', 'duration', 'easing', 'keyframes']) {
    if (key in def && typeof def[key] !== 'function') meta[key] = def[key]
  }
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(file)}</title>
<link rel="stylesheet" href="/app.css">
<style>html,body{margin:0;min-height:100%;}body{background:#f6f1e7;color:#2b2620;font:14px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px}.preview-stage{max-width:920px;margin:0 auto}.meta{padding:18px;border:1px solid #d9d0c1;border-radius:12px;background:#fffdf8}.meta h2{margin:0 0 8px;font-size:16px}.meta p{margin:0 0 12px;color:#857a6c}pre{margin:14px 0 0;padding:14px;border:1px solid #d9d0c1;border-radius:10px;background:#fbf7ef;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,Consolas,monospace;max-height:52vh;overflow:auto}</style>
<div class="preview-stage"><section class="meta"><h2>${esc(KIND_LABEL[kind])}</h2><p><code>${esc(file)}</code> 由${esc(KIND_LABEL[kind])}注册中心解释，不在本画布中做 React 渲染。</p><pre>${esc(JSON.stringify(meta, null, 2))}</pre><pre>${esc(source.slice(0, 4000))}</pre></section></div>`
}

function renderHtml(def: Record<string, unknown>, kind: PreviewKind, file: string, source: string): string {
  const component = def.component
  const slots = {
    title: '组件预览',
    describe: `<p>这是来自 <code>${esc(file)}</code> 的实时预览。</p><p>在应用内编辑并保存这个 TSX 文件，预览页会自动刷新。</p>`,
    content: '组件预览',
  }
  const defaultProps = (def.defaultProps ?? {}) as Record<string, string>
  const props = { ...defaultProps, ...(defaultProps.title ? {} : { title: String(def.name ?? '课堂组件') }) }
  const content = '<p>这是课堂组件的预览内容。保存文件后会自动热更新。</p>'

  let html = ''
  if (typeof component === 'function') {
    try {
      const element =
        kind === 'doc-component'
          ? createElement(component as never, { tag: String(def.tag ?? ''), attrs: {}, slots })
          : createElement(component as never, { tag: String(def.tag ?? ''), content, attrs: {}, props })
      html = renderToStaticMarkup(element)
    } catch (err) {
      return renderErrorPage('组件渲染失败', `${file}\n\n${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`)
    }
  } else if (kind === 'doc-component' || kind === 'classroom-component') {
    return renderErrorPage(
      '这个文件没有可渲染的组件',
      `在 ${file} 的 export default 里导出 component React 组件。\n\n当前文件没有导出 component。`,
    )
  } else {
    return renderMetaPage(kind, file, def, source)
  }

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(file)}</title>
<link rel="stylesheet" href="/app.css">
<style>html,body{margin:0;min-height:100%;}body{background:#f6f1e7;color:#2b2620;font:15px/1.7 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px}.preview-stage{max-width:920px;margin:0 auto}.preview-stage img{max-width:100%}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}</style>
<div class="preview-stage">${html || '<p>组件渲染为空。</p>'}</div>`
}

function pageHtml(files: PreviewFile[]): string {
  return `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>设计预览 · 外部组件</title>
<style>
:root{color-scheme:light;--ink:#27221c;--muted:#857a6c;--line:#d9d0c1;--paper:#f6f1e7;--card:#fffdf8;--accent:#8b5e3c}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);background:rgba(255,253,248,.72);position:sticky;top:0;backdrop-filter:blur(10px)}
header h1{margin:0;font-size:15px;letter-spacing:.04em}
header .hint{color:var(--muted);font-size:12px}
header .url{margin-left:auto;color:var(--muted);font:11px ui-monospace,Consolas,monospace}
main{display:grid;grid-template-columns:280px minmax(0,1fr);height:calc(100vh - 54px)}
aside{border-right:1px solid var(--line);overflow:auto;padding:14px 12px 24px}
.group-title{margin:16px 6px 6px;color:var(--muted);font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.file{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--ink);border-radius:8px;padding:9px 10px;cursor:pointer;font:inherit}
.file:hover{background:rgba(139,94,60,.08)}
.file.active{background:rgba(139,94,60,.14);box-shadow:inset 2px 0 0 var(--accent)}
.file .name{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file .meta{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.empty{padding:26px 14px;color:var(--muted);line-height:1.8}
section{min-width:0;display:flex;flex-direction:column;background:#efe7da}
.toolbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);background:rgba(255,253,248,.55);font-size:12px;color:var(--muted)}
.toolbar strong{color:var(--ink);font-weight:600}
.toolbar .dot{width:7px;height:7px;border-radius:50%;background:#6f9c72}
.toolbar .dot.pulse{animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:.45}50%{opacity:1}}
.toolbar .spacer{flex:1}
.toolbar button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:7px;padding:5px 10px;cursor:pointer;font:inherit}
.toolbar button:hover{border-color:var(--accent);color:var(--accent)}
.frame-wrap{flex:1;min-height:0;padding:18px}
iframe{width:100%;height:100%;border:1px solid var(--line);border-radius:12px;background:var(--paper);box-shadow:0 8px 26px rgba(73,54,38,.08)}
@media(max-width:800px){main{grid-template-columns:1fr;height:auto}aside{border-right:0;border-bottom:1px solid var(--line);max-height:42vh}section{height:62vh}}
</style>
<header>
  <h1>设计预览</h1>
  <span class="hint">只读扫描 doc-design · 保存 TSX 后自动热更新</span>
  <span class="url">http://127.0.0.1:${state.status.port}/</span>
</header>
<main>
  <aside id="list"></aside>
  <section>
    <div class="toolbar">
      <span class="dot pulse"></span><span id="live">正在监听外部文件</span>
      <strong id="active-name">未选择组件</strong>
      <span class="spacer"></span>
      <button id="refresh" type="button">立即刷新</button>
    </div>
    <div class="frame-wrap"><iframe id="frame" title="组件预览"></iframe></div>
  </section>
</main>
<script>
const files = ${jsonForScript(files)};
let signature = '';
let active = localStorage.getItem('unyra.designPreview.file') || '';
function groupLabel(kind) {
  return { 'doc-component': '文档组件', 'classroom-component': '课堂组件', 'classroom-animation': '课堂动效', 'classroom-sound': '课堂音效' }[kind] || kind;
}
function renderList() {
  const list = document.getElementById('list');
  if (!files.length) {
    list.innerHTML = '<div class="empty">还没有注册的外部 TSX 文件。<br>在「设置 → 设计」新建组件，或把 .tsx 放进 doc-design 目录。</div>';
    return;
  }
  const groups = {};
  for (const file of files) (groups[file.kind] ||= []).push(file);
  list.innerHTML = '';
  for (const kind of Object.keys(groups)) {
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = groupLabel(kind);
    list.appendChild(title);
    for (const file of groups[kind]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file' + (file.file === active ? ' active' : '');
      button.dataset.file = file.file;
      button.innerHTML = '<span class="name">' + escapeHtml(file.label) + '</span><span class="meta">' + escapeHtml(file.file) + '</span>';
      button.addEventListener('click', () => select(file.file));
      list.appendChild(button);
    }
  }
  if (!active && files[0]) select(files[0].file);
  else updateActiveLabel();
}
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function updateActiveLabel() {
  const file = files.find((item) => item.file === active);
  document.getElementById('active-name').textContent = file ? file.label + ' · ' + file.file : '未选择组件';
  document.querySelectorAll('.file').forEach((el) => el.classList.toggle('active', el.dataset.file === active));
}
function select(file) {
  active = file;
  localStorage.setItem('unyra.designPreview.file', file);
  const iframe = document.getElementById('frame');
  iframe.src = '/preview/' + encodeURIComponent(file) + '?v=' + Date.now();
  updateActiveLabel();
}
async function poll() {
  try {
    const res = await fetch('/api/files', { cache: 'no-store' });
    const data = await res.json();
    const next = JSON.stringify(data.files);
    document.getElementById('live').textContent = data.files.length ? '监听中 · ' + data.files.length + ' 个外部文件' : '监听中 · 暂无外部文件';
    if (next !== signature) {
      signature = next;
      files.length = 0;
      files.push(...data.files);
      renderList();
      if (active && files.some((item) => item.file === active)) select(active);
    }
  } catch (err) {
    document.getElementById('live').textContent = '预览服务连接中断，稍后自动重试';
  }
}
document.getElementById('refresh').addEventListener('click', () => { signature = ''; poll(); if (active) select(active); });
renderList();
poll();
setInterval(poll, 1400);
</script>
</html>`
}

function serve(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://127.0.0.1:${state.status.port}`)
  const pathname = decodeURIComponent(url.pathname)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    serve(res, 405, 'text/plain', 'Method Not Allowed')
    return
  }

  if (pathname === '/' || pathname === '/index.html') {
    const files = await listFiles()
    state.status.fileCount = files.length
    serve(res, 200, 'text/html', pageHtml(files))
    return
  }
  if (pathname === '/api/files') {
    const files = await listFiles()
    state.status.fileCount = files.length
    serve(res, 200, 'application/json', JSON.stringify({ files }))
    return
  }
  if (pathname === '/app.css') {
    const cssFile = await findAppCss()
    if (!cssFile) {
      // 路由本身可用；开发/测试环境尚未构建客户端时也不应把样式请求打成 404。
      serve(res, 200, 'text/css', '/* 尚未构建客户端样式 */')
      return
    }
    try {
      serve(res, 200, 'text/css', await fsp.readFile(cssFile, 'utf-8'))
    } catch {
      serve(res, 404, 'text/css', '/* 读取应用样式失败 */')
    }
    return
  }
  if (pathname.startsWith('/preview/')) {
    const file = pathname.slice('/preview/'.length)
    const read = await readPreviewFile(file)
    if (!read.source) {
      serve(res, 404, 'text/html', renderErrorPage('预览失败', read.error || '找不到文件'))
      return
    }
    const compiled = compileExternalTsx(read.source, file)
    if (compiled.error || !compiled.def) {
      serve(res, 500, 'text/html', renderErrorPage('TSX 编译失败', compiled.error || '模块没有导出对象'))
      return
    }
    const kind = kindOf(file) || 'doc-component'
    serve(res, 200, 'text/html', renderHtml(compiled.def, kind, file, read.source))
    return
  }
  serve(res, 404, 'text/plain', 'Not Found')
}

async function listen(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      serve(res, 500, 'text/plain', `预览服务内部错误：${err instanceof Error ? err.message : String(err)}`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
  return server
}

/** 启动服务；如果端口被占用，向后顺延。重复调用返回当前状态。 */
export async function startDesignPreview(): Promise<DesignPreviewStatus> {
  if (state.status.running && state.server) return getDesignPreviewStatus()
  let lastError = ''
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const port = BASE_PORT + i
    try {
      const server = await listen(port)
      state.server = server
      state.status = {
        running: true,
        port,
        url: `http://127.0.0.1:${port}/`,
        fileCount: (await listFiles()).length,
      }
      server.on('close', () => {
        state.server = null
        state.status = { ...state.status, running: false }
      })
      console.log(`[design-preview] listening on ${state.status.url}`)
      return getDesignPreviewStatus()
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (!lastError.includes('EADDRINUSE')) break
    }
  }
  state.status = { running: false, port: 0, url: '', fileCount: 0, error: lastError || '启动失败' }
  return getDesignPreviewStatus()
}

export async function stopDesignPreview(): Promise<void> {
  const server = state.server
  state.server = null
  state.status = { running: false, port: 0, url: '', fileCount: 0 }
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

export async function getDesignPreviewStatus(): Promise<DesignPreviewStatus> {
  if (state.status.running) {
    state.status.fileCount = (await listFiles()).length
  }
  return { ...state.status }
}

export function registerDesignPreviewIpc(): void {
  ipcMain.handle('designPreview:status', () => getDesignPreviewStatus())
  ipcMain.handle('designPreview:ensure', () => startDesignPreview())
}
