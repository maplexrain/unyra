/**
 * role-work 三组 api 的装配：role 的 work.* / chat.*，work 的 host.*。
 * 具体实现由宿主注入（learn/ops/work、learn/ops/chat、learn/ops/host）；
 * 这一层只做参数清洗与把错误收成普通回执，避免把栈甩给模型。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'
import type { ChatAttachmentInput, ChatSendInput, WorkSendInput } from '../../roleWork/types'

function cleanMentions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const id = asText(item).trim()
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

function cleanAttachments(raw: unknown): ChatAttachmentInput[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ChatAttachmentInput[] = []
  for (const item of raw.slice(0, 4)) {
    const a = asRecord(item)
    const image = asText(a.image).trim()
    const file = asText(a.file).trim()
    const name = asText(a.name).trim()
    if (!image && !file) continue
    out.push({ ...(image ? { image } : {}), ...(file ? { file } : {}), ...(name ? { name } : {}) })
  }
  return out.length ? out : undefined
}

export function installRoleWork(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  if (opts.work) {
    const work = opts.work
    wrapApi(api, 'work.list', async () => {
      try {
        return { works: await work.list() }
      } catch (e) {
        return { works: [], error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
    wrapApi(api, 'work.status', async (args) => {
      const name = asText(args[0]).trim()
      if (!name) return { error: 'work.status 需要 name' }
      try {
        return await work.status(name)
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
    wrapApi(api, 'work.stop', async (args) => {
      const name = asText(args[0]).trim()
      if (!name) return { ok: false, error: 'work.stop 需要 name' }
      try {
        return await work.stop(name)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
    wrapApi(api, 'work.create', async (args) => {
      const a = asRecord(args[0])
      try {
        return await work.create({ ...(asText(a.name).trim() ? { name: asText(a.name).trim() } : {}) })
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
    wrapApi(api, 'work.kill', async (args) => {
      const name = asText(args[0]).trim()
      if (!name) return { ok: false, error: 'work.kill 需要 name' }
      try {
        return await work.kill(name)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
    wrapApi(api, 'work.send', async (args) => {
      const a = asRecord(args[0])
      const name = asText(a.name).trim()
      const text = asText(a.text).trim()
      const messageId = asText(a.messageId).trim()
      if (!name) return { ok: false, error: 'work.send 需要 name' }
      if (!text && !messageId) return { ok: false, error: 'work.send 需要 text 或 messageId' }
      const input: WorkSendInput = { name, ...(text ? { text } : {}), ...(messageId ? { messageId } : {}) }
      try {
        return await work.send(input)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
  }

  if (opts.chat) {
    const chat = opts.chat
    wrapApi(api, 'chat.send', async (args) => {
      const a = asRecord(args[0])
      const channel = asText(a.channel).trim()
      const rawText = asText(a.text)
      const trimmedText = rawText.trim()
      // 群聊 @ 的分隔符就是名字后的空格：末尾的这一个空格不能被 trim 掉。
      const text = trimmedText && /[ \u3000]$/.test(rawText) ? trimmedText + ' ' : trimmedText
      const to = asText(a.to).trim()
      const messageId = asText(a.messageId).trim()
      const mentions = cleanMentions(a.mentions)
      const silent = a.silent === true
      if (channel !== 'user' && channel !== 'agent' && channel !== 'work' && channel !== 'group') {
        return { ok: false, error: 'chat.send 的 channel 只能是 user / agent / work / group' }
      }
      if (silent && channel !== 'agent' && channel !== 'group') {
        return { ok: false, error: 'chat.send 的 silent 只支持 agent / group 通道（进度汇报用）' }
      }
      if (!text && !messageId) return { ok: false, error: 'chat.send 需要 text 或 messageId' }
      if (channel === 'agent' && !to) return { ok: false, error: 'chat.send 到 agent 通道需要 to（目标 role id）' }
      if (channel === 'work' && !to) return { ok: false, error: 'chat.send 到 work 通道需要 to（work 名）' }
      const attachments = cleanAttachments(a.attachments)
      const input: ChatSendInput = {
        channel,
        text,
        ...(to ? { to } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(messageId ? { messageId } : {}),
        ...(attachments ? { attachments } : {}),
        ...(silent ? { silent: true } : {}),
      }
      try {
        return await chat.send(input)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
  }

  if (opts.host) {
    const host = opts.host
    wrapApi(api, 'host.send', async (args) => {
      const a = asRecord(args[0])
      const text = asText(a.text).trim()
      const messageId = asText(a.messageId).trim()
      if (!text) return { ok: false, error: 'host.send 需要 text（交付全文）' }
      try {
        return await host.send({ text, ...(messageId ? { messageId } : {}) })
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }, log)
  }
}
