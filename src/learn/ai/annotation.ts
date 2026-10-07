/**
 * 这个文件负责什么：「了解」那种一两句话的就地释义（generateShortAnnotation）——
 * 一次没有工具、没法自己取画像的请求，所以画像只能由调用方递进来。
 */
import { AiRequestError, chatCompleteWith } from '../../ai/client'
import { activeLabel, hasApiKey, loadAiSettings, resolveGlobal } from '../../ai/settings'
import { profilePromptBlock } from '../../user/profile'
import type { UserProfile } from '../../user/types'

/** 「了解」产生的短注解：只解释这个词本身，控制在一两句话 */
export async function generateShortAnnotation(opts: {
  term: string
  context?: string
  /** 用户画像：决定释义用什么语言 */
  profile?: UserProfile
  signal?: AbortSignal
}): Promise<string> {
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new AiRequestError(`尚未配置「${activeLabel(settings)}」的 API Key，请在设置中填写`)
  }

  const user = opts.context?.trim()
    ? `在下面这段内容里，读者选中了「${opts.term}」想快速弄清它的意思：\n\n${opts.context.trim()}\n\n请只解释「${opts.term}」本身。`
    : `请只解释「${opts.term}」的意思。`

  const base =
    '你是一位词典式释义助手。用一两句话（不超过 60 字）说清一个术语是什么意思，' +
    '供读者悬停查看。直接输出释义本身，不要标题、不要客套话、不要分点；' +
    '涉及数学时可用行内 LaTeX（$...$）。'
  // 这一处仍然由调用方把画像递进来：释义是**没有工具的一次性请求**，用不了 api.userInfo.get，
  // 而它唯一要画像的地方是「用什么语言解释」——取不到就只能猜语言（全文突然变成英文）。
  // 注意它目前没有调用方：真正在跑的「了解」走的是别的路，这里留着是为了那句话不落空。
  const profile = profilePromptBlock(opts.profile)
  const { provider, model, effort } = resolveGlobal(settings)

  const text = await chatCompleteWith(provider, model, {
    messages: [
      { role: 'system', content: profile ? `${base}\n\n${profile}` : base },
      { role: 'user', content: user },
    ],
    // 释义很短，低档思考就够；提供商与模型仍走全局
    reasoningEffort: effort === 'max' ? 'low' : effort,
    temperature: 0.4,
    signal: opts.signal,
    purpose: 'annotate',
  })
  const text2 = text.trim()
  if (!text2) throw new AiRequestError('AI 未能生成释义，请重试')
  return text2
}
