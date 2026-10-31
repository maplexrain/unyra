import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { initWebSocketServer } from './ws'
import { storageRouter } from './routes/storage'
import { voiceRouter } from './routes/voice'
import { proxyRouter } from './routes/proxy'
import { baseRouter } from './routes/base'
import { mcpRouter } from './routes/mcp'
import { webRouter } from './routes/web'
import { noticeRouter } from './routes/notice'
import { guardRouter } from './routes/guard'
import { audioRouter } from './routes/audio'
import { toolsRouter } from './routes/tools'
import { getUserDataDir } from '../electron/storage/userData'

const app = new Hono()

// 开发时允许 Vite 调试端口 (5173) 跨域调用
app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
  exposeHeaders: ['*'],
  maxAge: 86400,
}))

// 挂载 API 子路由
app.route('/api/storage', storageRouter)
app.route('/api/voice', voiceRouter)
app.route('/api/proxy', proxyRouter)
app.route('/api/base', baseRouter)
app.route('/api/mcp', mcpRouter)
app.route('/api/web', webRouter)
app.route('/api/notice', noticeRouter)
app.route('/api/guard', guardRouter)
app.route('/api/audio', audioRouter)
app.route('/api/tools', toolsRouter)

// 系统与健康检查接口
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.6.5-web',
    mode: 'web-server',
    userDataDir: getUserDataDir(),
  })
})

// 生产模式静态资源托管 (dist 目录)
const distDir = path.resolve(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use('/*', serveStatic({ root: './dist' }))
  // SPA 回落：任意未命中静态文件的路由回落至 index.html
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

const PORT = Number(process.env.PORT) || 3800
const HOST = process.env.HOST || '0.0.0.0'

export function startWebServer(port = PORT, host = HOST) {
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    console.log(`\n======================================================`)
    console.log(`🚀 归一 Unyra · 本地 WebUI 微服务已启动`)
    console.log(`👉 本地访问:    http://localhost:${info.port}`)
    console.log(`📁 数据存储目录: ${getUserDataDir()}`)
    console.log(`======================================================\n`)
  })

  // 挂载 WebSocket 实时事件通道
  initWebSocketServer(server as unknown as import('node:http').Server)

  return server
}

// 若作为主脚本直接执行时自启动
if (process.argv[1] && (process.argv[1].endsWith('server/index.ts') || process.argv[1].includes('index.cjs'))) {
  startWebServer()
}
