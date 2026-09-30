/**
 * 探针分组：图片输入与资源库落盘（原文件第 5 节（图片）与第 6 节（static / 预算与附图））。
 *
 * - imageTests：中立片段 → 三家协议的字段、带图历史的逐字节稳定、视觉能力门禁；
 * - staticTests：清单与磁盘必须一致、改名时资源目录要跟着搬、引用扫描；
 * - budgetAndAttachTests：历史预算里图片按张数折当量、工具附图还原成下一跳的 user 消息。
 *
 * 共享 fixture（ok / NOW / baseStore / childId / rootId / goalId / PNG_UUID / MD_UUID …）见 ./harness。
 */
import type { ChatContent } from '../../src/ai/types'
import { estimateUsage } from '../../src/ai/types'
import {
  budgetChars,
  contentChars,
  imagePart,
  plainText,
  textPart,
  toAnthropicBlocks,
  toCcParts,
  toOpenAiContent,
  toResponsesContent,
} from '../../src/ai/content'
import { MAX_TOOL_IMAGES, TOOL_IMAGE_NOTE, type ConversationMessage } from '../../src/agent/types'
import { goalImagesDir } from '../../src/learn/images'
import { toChatHistory } from '../../src/learn/useAgent'
import { supportsImage, type AiSettings, type InputModality } from '../../src/ai/settings'
import { assetMoves, buildDocs, diffDocs, parseDocs } from '../../src/learn/files'
import {
  baseNameOf,
  extOf,
  findResource,
  goalStaticDir,
  refCountOf,
  resourceRel,
  scanRefs,
  uuidFromHref,
} from '../../src/learn/static'
import { setUserScope, userPath } from '../../src/lib/storage'
import type { LearnStore } from '../../src/learn/types'
import { MD_UUID, NOW, PNG_REL, PNG_UUID, baseStore, childId, goalId, ok, rootId, staticStore } from './harness'

/* ---------- 5. 图片输入（多模态） ---------- */

/**
 * 这一段守的是「看不见的那一层」里最容易悄悄坏掉的部分：
 * 带图的消息怎么变成三家协议的字段、历史还原是否逐字节稳定（前缀缓存的前提）、
 * 图片引用在 chat.json 里怎么往返、以及「模型不收图时界面该不该放行」。
 * 这些错了界面都不会当场报错——只会在真正发请求时收到一个 400，
 * 或者更糟：换一家提供商之后整段前缀缓存作废，用户默默多付一次全价。
 */
export function imageTests() {
  const withText: ChatContent = [textPart('看这张图'), imagePart('image/png', 'AAAB')]

  // 中立片段 → 三家协议的线格式
  const openai = toOpenAiContent(withText)
  ok(
    Array.isArray(openai) && openai[0].type === 'text' && openai[0].text === '看这张图',
    'OpenAI：第一块是 text',
    openai,
  )
  ok(
    Array.isArray(openai) &&
      openai[1].type === 'image_url' &&
      openai[1].image_url.url === 'data:image/png;base64,AAAB',
    'OpenAI：图片是 image_url 的 data URL',
    openai,
  )
  ok(toOpenAiContent('纯文本') === '纯文本', 'OpenAI：没有图就仍发字符串（兼容性最好的形态）')
  const anthropic = toAnthropicBlocks(withText)
  ok(
    anthropic[1].type === 'image' && anthropic[1].source.media_type === 'image/png' && anthropic[1].source.data === 'AAAB',
    'Anthropic：base64 放在 source 里，不是 data URL',
    anthropic[1],
  )
  const responses = toResponsesContent(withText)
  ok(
    Array.isArray(responses) && responses[1].type === 'input_image' && responses[1].image_url === 'data:image/png;base64,AAAB',
    'Responses：图片是 input_image 块',
    responses,
  )
  const cc = toCcParts(withText)
  ok(
    Array.isArray(cc) && cc[1].type === 'image' && cc[1].image === 'data:image/png;base64,AAAB',
    'Command Code：图片是裸 data URL 的 image 块（没有 source 包装）',
    cc,
  )
  ok(toCcParts('纯文本') === '纯文本', 'Command Code：没有图仍是字符串')
  ok(plainText(withText) === '看这张图', 'plainText 只取文字（`(no output)` 之类退化用）')
  ok(contentChars(withText) === '看这张图'.length + 4, 'contentChars 是内容的原始大小（预算另走 budgetChars）', contentChars(withText))

  // 会话历史还原：带图的消息 → 中立片段，且两次逐字节一致
  const messages: ConversationMessage[] = [
    {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: '这道题怎么做' }],
      ts: NOW,
      images: [
        { id: 'i1', rel: 'docs/微积分/images/i1.png', name: '题.png', mime: 'image/png', bytes: 3, width: 2, height: 2 },
      ],
    },
    { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '先看已知条件' }], ts: NOW },
  ]
  const table = new Map([['i1', { mime: 'image/png', data: 'AAAB' }]])
  const h1 = toChatHistory(messages, table)
  const h2 = toChatHistory(messages, table)
  ok(JSON.stringify(h1) === JSON.stringify(h2), '带图的历史两次还原逐字节一致（前缀缓存的前提）')
  ok(
    Array.isArray(h1[0].content) && h1[0].content[0].type === 'text' && h1[0].content[1].type === 'image',
    '带图的消息还原成「文本 + 图片」片段',
    h1[0].content,
  )
  ok(typeof h1[1].content === 'string', '纯文本消息仍是字符串')
  const noTable = toChatHistory(messages)
  ok(noTable[0].content === '这道题怎么做', '图片字节读不到时退化成纯文本，不炸整轮请求', noTable[0].content)

  // 估算用量不能被 base64 撑爆
  const usage = estimateUsage(h1, undefined, '')
  ok(!usage.estimated || usage.input < 5000, '估算用量不把图片 base64 当文字算', usage.input)

  // 存储往返：图片引用跟着 chat.json 走
  const st = baseStore()
  st.conversations[0] = { ...st.conversations[0], messages }
  const files = buildDocs(st)
  const chat = JSON.parse(files.get('docs/微积分/chat.json') as string) as {
    conversations: Array<{ messages: Array<{ images?: Array<{ rel?: string }> }> }>
  }
  ok(
    chat.conversations[0].messages[0].images?.[0]?.rel === 'docs/微积分/images/i1.png',
    '图片引用写进 chat.json（字节不进去）',
    chat.conversations[0].messages[0].images,
  )
  const back = parseDocs(files, {})
  ok(back?.conversations[0].messages[0].images?.[0]?.id === 'i1', '图片引用能读回来')

  // 半条记录（缺 rel）宁可丢掉：留着只会在发请求时变成一张读不到的空图
  const broken = JSON.parse(JSON.stringify(chat)) as {
    conversations: Array<{ messages: Array<{ images?: unknown[] }> }>
  }
  broken.conversations[0].messages[0].images?.push({ id: 'x' })
  const files2 = new Map(files)
  files2.set('docs/微积分/chat.json', JSON.stringify(broken) + '\n')
  const back2 = parseDocs(files2, {})
  ok(back2?.conversations[0].messages[0].images?.length === 1, '缺 rel 的半条图片记录被丢掉')

  // 图片目录跟着目标目录走（改标题＝改目录，图片也跟着搬）
  ok(goalImagesDir(st, goalId) === 'docs/微积分/images', '图片目录就在目标目录下', goalImagesDir(st, goalId))
  ok(goalImagesDir(st, '不存在的目标') === null, '目标不存在时没有图片目录')

  // 视觉能力门禁
  const cfg = (protocolOwner: string, modalities: InputModality[]): AiSettings => ({
    providers: [
      {
        id: protocolOwner,
        kind: 'provider',
        label: '',
        baseUrl: '',
        apiKey: 'sk-test',
        models: [{ id: 'm1', name: '', contextWindow: 0, inputModalities: modalities }],
      },
    ],
    global: { providerId: protocolOwner, model: 'm1', effort: 'max' },
  })
  ok(supportsImage(cfg('deepseek', ['text', 'image'])), '模型声明了图像 → 允许贴图')
  ok(!supportsImage(cfg('deepseek', ['text'])), '模型只声明文本 → 不允许贴图')
  ok(supportsImage(cfg('commandcode', ['text', 'image'])), 'Command Code 网关那一路同样支持图片（块数组）')
}

/* ---------- 6. 资源库（static）与工具附图的通道：清单往返、改名搬迁、引用扫描（分节标题与 fixture 见 ./harness） ---------- */
export function staticTests() {
  const s = staticStore()
  ok(goalStaticDir(s, goalId) === 'docs/微积分/static', '资源目录在目标根目录下', goalStaticDir(s, goalId))
  ok(resourceRel(s, goalId, findResource(s, goalId, PNG_UUID)!) === PNG_REL, '资源文件名 = uuid + 原后缀', resourceRel(s, goalId, findResource(s, goalId, PNG_UUID)!))
  ok(findResource(s, goalId, PNG_UUID)!.type === 'binary' && findResource(s, goalId, MD_UUID)!.type === 'text', '类型由后缀判定')
  ok(extOf('题图.PNG') === 'png' && extOf('没有后缀') === '' && baseNameOf('题图.PNG') === '题图', '后缀与展示名的解析')
  ok(uuidFromHref('moji:static/' + PNG_UUID) === PNG_UUID && uuidFromHref('moji:node/x') === null, '从文档链接里取出 uuid')

  // 清单往返：元数据跟着文档一起落盘、一起读回来
  const files = buildDocs(s)
  const manifest = files.get('docs/微积分/static/manifest.json')
  ok(!!manifest, '清单写在 static/ 里', [...files.keys()].filter((k) => k.includes('static')))
  ok(!!manifest && manifest.includes('"题图"') && manifest.includes('第二题的插图'), '清单里有名称与描述', manifest?.slice(0, 140))
  const round = parseDocs(files, {})?.resources?.[goalId] ?? []
  ok(round.length === 2 && round[0].uuid === PNG_UUID && round[0].bytes === 2048, '清单逐字往返', round)
  ok(round[0].createdAt === NOW && round[0].updatedAt === NOW, '日期字段往返', round[0])
  ok(!buildDocs(baseStore()).has('docs/微积分/static/manifest.json'), '没有资源时不写空清单')
  ok(parseDocs(buildDocs(s), {})?.resources?.['不存在的目标'] === undefined, '清单按目标归属')

  // 目录改名：diff 会删掉整个旧目录，所以必须先有搬迁计划（否则资源跟着一起没）
  const renamed: LearnStore = { ...s, nodes: s.nodes.map((n) => (n.id === rootId ? { ...n, title: '微积分（正式）' } : n)) }
  const moves = assetMoves(buildDocs(s), buildDocs(renamed))
  ok(moves.some((m) => m.from === 'docs/微积分' && m.to === 'docs/微积分（正式）'), '改名后资源目录有搬迁计划', moves)
  ok(diffDocs(buildDocs(s), buildDocs(renamed)).removes.includes('docs/微积分'), 'diff 仍会删旧目录（因此必须靠 move 先搬走）')

  /**
   * 路径约定：资源模块里的路径是「相对当前用户」的（docs/…），
   * 落盘时由 storage 补 users/{uid}/ 前缀。这条曾经漏掉，结果文件写到数据根下的
   * docs/、而清单走 buildDocs 写到 users/{uid}/docs/ —— 资源和清单分家。
   */
  setUserScope('u1')
  ok(userPath('docs/微积分/static/a.png') === 'users/u1/docs/微积分/static/a.png', '用户内路径补上前缀', userPath('docs/微积分/static/a.png'))
  setUserScope(null)
  ok(userPath('docs/x') === null, '未登录时用户内路径解析为 null（调用方按中性值处理）', userPath('docs/x'))

  // 引用扫描
  const quoted: LearnStore = {
    ...s,
    nodes: s.nodes.map((n) => (n.id === childId ? { ...n, docs: { ...n.docs, teaching: '看图：![题图](moji:static/' + PNG_UUID + ')' } } : n)),
  }
  const refs = scanRefs(quoted, PNG_UUID)
  ok(refs.length === 1 && refs[0].nodeId === childId && refs[0].count === 1 && !refs[0].foreign, '引用扫描能找到引用它的文档', refs)
  ok(refCountOf(quoted, MD_UUID) === 0, '没被引用的资源引用数为 0')
}

/**
 * 历史预算与「工具附图」的还原。
 *
 * 预算那条是**实测踩过的坑**：图片一度按 base64 长度计入 20 万字符的预算，
 * 于是一张 188KB 的图（base64 25 万字符）会让整段历史连本次提问一起被丢掉，
 * 25 条历史归零。现在图片按张数折当量，判据钉在这里。
 */
export function budgetAndAttachTests() {
  const big = 'A'.repeat(400_000)
  const img = { id: 'img1', rel: 'docs/微积分/static/img1.png', name: '题.png', mime: 'image/png', bytes: 300_000 }
  const msgs: ConversationMessage[] = []
  for (let i = 0; i < 12; i++) {
    msgs.push({ id: 'u' + i, role: 'user', parts: [{ type: 'text', text: 'x'.repeat(1000) }], ts: NOW })
    msgs.push({ id: 'a' + i, role: 'assistant', parts: [{ type: 'text', text: 'y'.repeat(1000) }], ts: NOW })
  }
  msgs.push({ id: 'last', role: 'user', parts: [{ type: 'text', text: '这张截图里我哪里算错了' }], ts: NOW, images: [img] })
  const table = new Map([['img1', { mime: 'image/png', data: big }]])

  ok(budgetChars([textPart('ab'), imagePart('image/png', big)]) === 2 + 4400, '预算里图片按张数折当量，不按 base64 长度', budgetChars([textPart('ab'), imagePart('image/png', big)]))
  ok(contentChars([textPart('ab'), imagePart('image/png', big)]) === 2 + big.length, 'contentChars 仍是原始大小（两者用途不同）')
  const h = toChatHistory(msgs, table)
  ok(h.length === msgs.length, '一张 300KB 的图不再把历史清空', [msgs.length, h.length])
  ok(JSON.stringify(h).includes('这张截图里我哪里算错了'), '本次提问仍在上下文里')
  ok(h.reduce((sum, m) => sum + budgetChars(m.content), 0) <= 200_000, '按新预算算装得下')

  // 工具附图：还原成工具结果之后的一条 user 消息，且两次逐字节一致
  const shot = { id: PNG_UUID, rel: PNG_REL, name: '题图.png', mime: 'image/png', bytes: 4 }
  const conv: ConversationMessage[] = [
    {
      id: 'm1',
      role: 'assistant',
      ts: NOW,
      parts: [
        { type: 'text', text: '我看一下这张图' },
        { type: 'tool', id: 't1', name: 'execute', args: '{}', result: '图片已附在下一跳', ok: true, status: 'done', images: [shot] },
      ],
    },
  ]
  const shotTable = new Map([[PNG_UUID, { mime: 'image/png', data: 'AAAB' }]])
  const r1 = toChatHistory(conv, shotTable)
  const r2 = toChatHistory(conv, shotTable)
  ok(JSON.stringify(r1) === JSON.stringify(r2), '带图工具结果两次还原逐字节一致（前缀缓存的前提）')
  // 正文与工具调用必须并进**同一条** assistant 消息（runtime 实发的就是一条 content+tool_calls）：
  // 早先拆成两条，只要有一轮「先说一句话再调工具」，下一轮历史就从那里与上一轮实发对不上，
  // 服务端的前缀缓存整段作废——缓存命中率极低正是这么来的
  ok(r1.length === 3 && r1[0].role === 'assistant' && !!r1[0].tool_calls && typeof r1[0].content === 'string', '正文与工具调用并进同一条 assistant（与 runtime 实发一致）', r1.map((m) => m.role))
  ok(r1[1].role === 'tool' && r1[2].role === 'user', '图片还原成工具结果之后的 user 消息', r1.map((m) => m.role))
  const parts2 = r1[2].content
  ok(Array.isArray(parts2) && parts2[0].type === 'text' && parts2[0].text === TOOL_IMAGE_NOTE, '说明文字取自共享常量（与运行时一字不差）', parts2)
  ok(Array.isArray(parts2) && parts2[1].type === 'image' && parts2[1].data === 'AAAB', '图片片段带上了字节', parts2)
  const noBytes = toChatHistory(conv)
  ok(noBytes.length === 2 && noBytes.every((m) => m.role !== 'user'), '字节读不到时不挂那条消息，也不炸整轮请求', noBytes.map((m) => m.role))
  ok(MAX_TOOL_IMAGES >= 1, '一次最多挂几张图有上限')
}
