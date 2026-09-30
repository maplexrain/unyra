/**
 * 这个文件负责把「还没落盘的附件」在真正发送那一刻转存进资源库：图片（transferPendingImages）、
 * 文本 / 二进制文件（transferPendingFiles），以及把会话里用到的文本附件读回来
 * （loadAttachTexts，与 learn/images 的 loadImagesFor 是一对）。
 *
 * 从 learn/useAgent 拆出（见 docs/refactor-plan.md 3.8）。
 */

import {
  type ConversationMessage,
  type MessageFile,
  type MessageImage,
  type PendingFile,
  type PendingImage,
} from '../../agent/types'
import type { LearnStore } from '../types'
import { addResource, saveStaticImage, saveStaticText } from '../static'
import { readUserText } from '../../lib/storage'

/**
 * 把输入框里**还没落盘**的附件转存进资源库。
 *
 * 时机就是这里：消息确认要发出去、真要进上下文的那一刻。
 * - 写文件（`{目标}/static/{uuid}.{ext}`，缩放与内容指纹都在 saveStaticImage 里）
 * - 登记清单（addResource → store，跟着文档一起落盘）
 *
 * 之前是「贴进输入框就落盘」，代价是贴了又删、没配 Key 发不出去、中途切走节点
 * 的那些图都会在资源库里留下**永远没人引用的孤儿文件**——而资源库本该只收
 * 真正进过上下文的东西。
 *
 * 单张失败不影响其它几张：能转几张是几张，失败原因原样回给界面说一句。
 * 全部失败时不动 store（不留空清单）。
 */
export async function transferPendingImages(
  getLatest: () => LearnStore,
  set: (store: LearnStore) => void,
  goalId: string,
  pending: PendingImage[],
): Promise<{ images: MessageImage[]; error?: string }> {
  const images: MessageImage[] = []
  let store = getLatest()
  let error: string | undefined
  for (const [i, p] of pending.entries()) {
    const res = await saveStaticImage(store, goalId, p.file, i)
    if (res.ok) {
      images.push(res.image)
      // 同一批里内容相同的两张图（指纹一致）会拿到同一条资源，addResource 按 uuid 覆盖即可
      store = addResource(store, goalId, res.resource)
    } else {
      error = res.error
    }
  }
  if (images.length) set(store)
  return { images, error }
}

/**
 * 把输入框里还没落盘的**文件**附件转存进资源库（与图片同一时机、同一原则）。
 *
 * 文本附件**存进资源库**而不是塞进 chat.json：会话文件每次改动都要整份重写，
 * 几百 KB 的附件塞进去写一次就是几十毫秒；存成资源之后，导师之后还能用 res.read
 * 把这份附件再读一遍，而不只是「这一轮瞥了一眼」。
 *
 * 二进制附件（读不出文本的那种）不进资源库：它的字节对模型没有任何用处，
 * 复制一份只是浪费磁盘。留一个名字与体积，让模型知道「他附了一份这种东西」就够了。
 */
export async function transferPendingFiles(
  getLatest: () => LearnStore,
  set: (store: LearnStore) => void,
  goalId: string,
  pending: PendingFile[],
): Promise<{ files: MessageFile[]; error?: string }> {
  const files: MessageFile[] = []
  let store = getLatest()
  let changed = false
  let error: string | undefined
  for (const p of pending) {
    if (p.text === undefined || p.binary) {
      files.push({ name: p.name, bytes: p.bytes, binary: true })
      continue
    }
    const res = await saveStaticText(store, goalId, p.name, p.text)
    if (!res.ok) {
      error = res.error
      continue
    }
    // 同一份内容再发一次会拿到同一条资源（指纹去重），addResource 按 uuid 覆盖即可
    store = addResource(store, goalId, res.resource)
    changed = true
    files.push(p.truncated ? { ...res.file, truncated: true } : res.file)
  }
  if (changed) set(store)
  return { files, error }
}

/**
 * 把会话里用到的文本附件读回来（uuid → 正文）。
 *
 * 与 loadImagesFor 是一对：那边读图片字节，这边读文本正文。附件的内容存在资源库里，
 * 每一轮都要读回来拼进上下文，因此结果按 rel 去重、并发读——一轮里同一个附件
 * 可能在好几条消息上出现（用户接着追问同一份文件是常事）。
 */
export async function loadAttachTexts(messages: ConversationMessage[]): Promise<Map<string, string>> {
  const rels = new Map<string, string>()
  for (const m of messages) {
    for (const f of m.files ?? []) {
      if (f.uuid && f.rel && !rels.has(f.uuid)) rels.set(f.uuid, f.rel)
    }
  }
  const out = new Map<string, string>()
  await Promise.all(
    [...rels].map(async ([uuid, rel]) => {
      const text = await readUserText(rel)
      if (text !== null) out.set(uuid, text)
    }),
  )
  return out
}
