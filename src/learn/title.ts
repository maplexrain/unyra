import { AiRequestError, chatCompleteWith } from '../ai/client'
import { activeLabel, hasApiKey, loadAiSettings, resolveGlobal } from '../ai/settings'
import type { Conversation } from '../agent/types'

/**
 * 对话命名：一段对话叫什么，由模型读**第一句话**起一个短标题。
 *
 * 为什么不是用户自己填：绝大多数人不会填，于是对话列表里全是「对话 1、对话 2」——
 * 等于没有列表。而"这段对话在聊什么"这件事，第一句话里已经写着了。
 *
 * 这个请求刻意做得极窄：**系统提示词 + 第一条 user 消息**，没有工具、没有历史、
 * 没有目标上下文、没有画像。理由有两条：
 * 1. 起名只需要那一句话。把整段上下文递过去，等于为十个字付一整轮的输入钱；
 * 2. 它跑在用户那一轮**之外**（不阻塞回答），上下文越干净越不容易受干扰。
 */

/** 标题的硬上限（字符数，按 Unicode 码点数）。模型被要求写到这个数以内，超出由这里截断 */
export const TITLE_MAX_CHARS = 30

/** 送进去的第一句话最多这么长：起名用不着看完全文，而超长首条（贴了一大段材料）会很贵 */
const SOURCE_MAX_CHARS = 2000

const TITLE_SYSTEM = [
  '你给一段对话起标题，供用户在对话列表里认出它。',
  '',
  '只输出标题本身：',
  '- 不要引号、书名号、句号，不要「标题：」这类前缀，不要解释。',
  '- 全文不超过 30 个字符（中文 30 个字以内，英文 30 个字母以内、约 6 个词）。',
  '- 写成名词短语，点明「在聊什么」，不要写成一句话或一句问候。',
  '- 用与用户那句话相同的语言。',
].join('\n')

/** 标题两头要剥掉的东西：引号、书名号、括号、前缀 */
const WRAP_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
  ['（', '）'],
  ['(', ')'],
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['[', ']'],
]
/** 标题尾巴上的标点：标题不是句子，句号问号都该去掉 */
const TAIL_PUNCT = /[。．.！!？?；;，,、：:~～\-—\s]+$/

/**
 * 把模型吐出来的东西收拾成一个标题：只留第一行、剥掉引号与结尾标点、掐到 30 字符。
 *
 * 为什么要自己再掐一刀：提示词只是"要求"，模型偶尔会写成一整句（"用户想了解导数的定义"），
 * 或者干脆带上一对引号。**上限是硬要求**，不能指望对方每次都听话。
 */
export function cleanTitle(raw: string): string {
  let text = (raw.split('\n').find((l) => l.trim()) ?? '').trim()
  // 「标题：xxx」「Title: xxx」这类前缀
  text = text.replace(/^(标题|题目|title)\s*[:：]\s*/i, '').trim()
  let changed = true
  while (changed && text.length > 1) {
    changed = false
    for (const [open, close] of WRAP_PAIRS) {
      if (text.startsWith(open) && text.endsWith(close) && text.length > open.length + close.length) {
        text = text.slice(open.length, text.length - close.length).trim()
        changed = true
      }
    }
  }
  text = text.replace(/\s+/g, ' ').replace(TAIL_PUNCT, '').trim()
  return clampChars(text, TITLE_MAX_CHARS)
}

/** 逐字累加到不超过 max 字符为止（for...of 按 Unicode 码点走，emoji 不会被拦腰截断） */
function clampChars(text: string, max: number): string {
  let out = ''
  let n = 0
  for (const ch of text) {
    if (n >= max) break
    out += ch
    n++
  }
  return out.replace(TAIL_PUNCT, '').trim()
}

/**
 * 拿哪段话去起名：**第一条给用户看的 user 消息**。
 *
 * 跳过隐藏消息（工作流指令、自动开讲）：那是我们写给模型的内部指令，不是用户说的话，
 * 拿它起名会得到「学习大纲」这种没信息量的标题。一条用户消息都还没有时退回**目标问题**——
 * 新建目标的那一轮就是这种情况（第一条是隐藏的大纲指令），而目标问题本来就是用户的原话。
 */
export function namingSource(conv: Conversation, goalQuestion: string): string {
  for (const m of conv.messages) {
    if (m.role !== 'user' || m.hidden) continue
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ')
      .trim()
    if (text) return text.slice(0, SOURCE_MAX_CHARS)
  }
  return goalQuestion.trim().slice(0, SOURCE_MAX_CHARS)
}

/**
 * 起一个标题。**只传系统提示词 + 那一条消息**（见文件头的说明）。
 *
 * 失败一律抛出去，由调用方决定怎么办（当前的做法是：安静地失败，界面退回「对话 N」，
 * 下一轮再试一次）——起名失败不该打断任何一次真正的对话。
 */
export async function generateConversationTitle(opts: {
  text: string
  signal?: AbortSignal
}): Promise<string> {
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new AiRequestError(`尚未配置「${activeLabel(settings)}」的 API Key，请在设置中填写`)
  }
  const { provider, model } = resolveGlobal(settings)
  const raw = await chatCompleteWith(provider, model, {
    messages: [
      { role: 'system', content: TITLE_SYSTEM },
      { role: 'user', content: opts.text },
    ],
    /*
     * 起名不需要想：低档就够。但输出预算**不能**给得太抠——推理模型的思考 token 与
     * 正文 token 计在同一个 max_tokens 里，之前只给 40，思考就把预算烧光了，正文一个字
     * 都剩不下，于是每次起名都「成功返回空串」，标题永远起不出来。给到 512：写 30 个字
     * 绰绰有余，推理模型的思考也有得花（多花的只是无关紧要的几步）。
     */
    reasoningEffort: 'low',
    maxTokens: 512,
    /*
     * 不传 temperature：起名不求创造性，默认温度就好；而不少 OpenAI 兼容网关对带
     * reasoning 的请求见到 temperature 会直接 400——少一个字段就少一种起名失败。
     */
    signal: opts.signal,
  })
  const title = cleanTitle(raw)
  if (!title) throw new AiRequestError('AI 未能生成标题')
  return title
}
