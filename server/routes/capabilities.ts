/**
 * WebUI 模式的模型能力路由（桌面端走 IPC，见 electron/capabilities/index.ts）。
 *
 * 与桌面端共用同一套分流实现（electron/capabilities 的 deepseek/local/cache）：
 * 服务端只做「HTTP 请求 → 分流调用 → JSON 回包」的转发，引擎配置由浏览器端
 * 读好随请求体带来（跟桌面端渲染层传 engine 字段是同一约定）。
 * 结果缓存落在服务端的数据目录（userData/caps-cache），同一份 WebUI 的用户共享。
 */

import { Hono } from 'hono'
import path from 'node:path'
import type {
  CapsFilesCreateRequest,
  CapsFilesDeleteRequest,
  CapsFilesListRequest,
  CapsOcrRequest,
  CapsSttRequest,
  CapsTtsRequest,
} from '../../shared/ipc/capabilities'
import { getUserDataDir } from '../../electron/storage/userData'
import { dispatchCapsOcr, dispatchCapsStt, dispatchCapsTts } from '../../electron/capabilities/index'
import { cacheGet, cacheSet } from '../../electron/capabilities/cache'
import { deepseekFilesCreate, deepseekFilesDelete, deepseekFilesList } from '../../electron/capabilities/deepseek'

export const capsRouter = new Hono()

const cacheRoot = (): string => path.join(getUserDataDir(), 'caps-cache')

capsRouter.post('/ocr', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CapsOcrRequest | null
  if (!body?.engine) return c.json({ ok: false, error: '缺少引擎配置' })
  return c.json(await dispatchCapsOcr(body))
})

capsRouter.post('/tts', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CapsTtsRequest | null
  if (!body?.engine) return c.json({ ok: false, error: '缺少引擎配置' })
  return c.json(await dispatchCapsTts(body))
})

capsRouter.post('/stt', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CapsSttRequest | null
  if (!body?.engine) return c.json({ ok: false, error: '缺少引擎配置' })
  // JSON 过线的 samples 是普通数组：还原成 Float32Array 交给 WAV 编码器
  if (Array.isArray(body.samples)) body.samples = new Float32Array(body.samples)
  return c.json(await dispatchCapsStt(body))
})

/* ---------- 结果缓存（与桌面端同一个 KV 目录口径） ---------- */

capsRouter.get('/cache/:key', async (c) => {
  const key = c.req.param('key')
  if (!/^[0-9a-f]{64}$/.test(key)) return c.json({ ok: true, value: null })
  return c.json({ ok: true, value: await cacheGet(cacheRoot(), key) })
})

capsRouter.post('/cache', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { key?: string; value?: unknown } | null
  if (!body?.key || !/^[0-9a-f]{64}$/.test(body.key)) return c.json({ ok: false, error: '缓存键无效' })
  await cacheSet(cacheRoot(), body.key, body.value)
  return c.json({ ok: true })
})

/* ---------- Files API ---------- */

capsRouter.post('/files/list', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CapsFilesListRequest | null
  if (!body?.engine?.apiKey) return c.json({ ok: false, error: '尚未配置 DeepSeek API Key' })
  return c.json(await deepseekFilesList(body))
})

capsRouter.post('/files/create', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CapsFilesCreateRequest | null
  if (!body?.engine?.apiKey) return c.json({ ok: false, error: '尚未配置 DeepSeek API Key' })
  return c.json(await deepseekFilesCreate(body))
})

capsRouter.post('/files/delete', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CapsFilesDeleteRequest | null
  if (!body?.engine?.apiKey) return c.json({ ok: false, error: '尚未配置 DeepSeek API Key' })
  return c.json(await deepseekFilesDelete(body))
})
