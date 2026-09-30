/**
 * 对话（chat.json）的**落盘往返**。
 *
 * 与 readingPersist 是同一类事故，而且更隐蔽：读回来时 store 的 normalizeConversation
 * 是按**字段白名单**重建每条消息的，写入方后来往消息上加的东西，这里没跟上。症状全都出在
 * 「重启之后」，而且全是静默的：
 * - mark 没了 → 导师自己发起的那次回忆 / 探针 / 开讲，在对话流与消息定位条上一起消失
 *   （那条指令本身是隐藏消息，没有 mark 连显示都不显示）；
 * - retired + summary 没了 → 压过的历史整段又灌回上下文，等于白压一次；摘要还在时更糟：
 *   summaryBlock 照旧拼在最前面，同一段内容发了两遍；
 * - files 没了 → 附件从气泡上消失，之后的每一轮请求里也不再带上它的正文。
 *
 * 这个文件因此按「一条消息能带的东西」逐项钉住往返：写出去什么，读回来必须还是什么。
 */
import { describe, expect, it } from 'vitest'

import { emptyDocs } from '../src/learn/groups'
import { buildDocs, buildState, parseDocs } from '../src/learn/files'
import { activeMessages } from '../src/learn/compact'
import { upsertAssistantInFlight } from '../src/learn/agent/inflight'
import { emptyPomodoro } from '../src/learn/pomodoro'
import type { Conversation, ConversationMessage, ContextSummary } from '../src/agent/types'
import type { LearnStore } from '../src/learn/types'

const now = new Date(2026, 8, 23, 21, 0).getTime()

const msg = (id: string, role: 'user' | 'assistant', text: string): ConversationMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  ts: now,
})

const convWith = (messages: ConversationMessage[], summary?: ContextSummary): Conversation => ({
  id: 'c1',
  goalId: 'g1',
  messages,
  createdAt: now,
  updatedAt: now,
  ...(summary ? { summary } : {}),
})

/** 一份最小可用的学习数据，只挂一段对话 */
function storeWith(conv: Conversation): LearnStore {
  return {
    version: 2,
    nodes: [
      {
        id: 'n1',
        title: '导数',
        key: '导数',
        description: '',
        docs: { teaching: '# 导数' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'ai',
        goalId: 'g1',
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [],
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '我想学导数', createdAt: now, updatedAt: now }],
    conversations: [conv],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'n1',
    activeConversationId: conv.id,
    // 文档区：一组、没有页签（分割与分组见 learn/groups）
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
    reading: { byGoal: {} },
    checkin: { byGoal: {} },
    pomodoro: emptyPomodoro(),
  }
}

/** 走一遍真正的落盘路径：buildDocs 写文件 → parseDocs 读回来 */
function roundTrip(conv: Conversation): Conversation {
  const store = storeWith(conv)
  const back = parseDocs(buildDocs(store), buildState(store))
  return (back?.conversations ?? [])[0] as Conversation
}

describe('对话写盘 → 读回', () => {
  it('工作流分界条活着回来：hidden 的指令带着 mark，定位条才锚得住它', () => {
    const back = roundTrip(
      convWith([
        msg('u1', 'user', '开始吧'),
        { ...msg('u2', 'user', '【回忆】上一次讲到哪了'), hidden: true, mark: '回忆', context: '当前节点：导数' },
        { ...msg('u3', 'user', '【节点上下文】'), hidden: true },
      ]),
    )
    expect(back.messages.map((m) => m.mark)).toEqual([undefined, '回忆', undefined])
    expect(back.messages[1]).toMatchObject({ hidden: true, context: '当前节点：导数' })
    // 面板那条判据（见 AgentPanel）：显示的是「非隐藏」+「带 mark 的隐藏」
    const shown = back.messages.filter((m) => !m.hidden || !!m.mark)
    expect(shown.map((m) => m.id)).toEqual(['u1', 'u2'])
  })

  it('压缩过的历史读回来还是压过的：摘要与失活标记一起活着', () => {
    const summary: ContextSummary = {
      at: now,
      text: '## 已经讲清的内容\n导数的定义与几何意义。',
      tasks: ['把第 3 节的例题补完'],
      messages: 2,
      chars: 320,
    }
    const back = roundTrip(
      convWith(
        [
          { ...msg('u1', 'user', '我想学导数'), retired: true },
          { ...msg('a1', 'assistant', '好，我们从极限说起'), retired: true },
          msg('u2', 'user', '接着讲求导法则'),
          msg('a2', 'assistant', '求导法则有四条'),
        ],
        summary,
      ),
    )
    expect(back.summary).toEqual(summary)
    expect(back.messages.map((m) => !!m.retired)).toEqual([true, true, false, false])
    // 真正进上下文的只有没失活的那两条（摘要在它们之前单独拼，见 summaryBlock）
    expect(activeMessages(back.messages).map((m) => m.id)).toEqual(['u2', 'a2'])
  })

  it('附件活着回来：文本那份要留住 uuid + rel，二进制那份只有名字与体积', () => {
    const back = roundTrip(
      convWith([
        {
          ...msg('u1', 'user', '看看这份笔记'),
          files: [
            { name: '笔记.md', bytes: 1200, uuid: 'r1', rel: 'docs/导数/static/r1.md', chars: 800, truncated: true },
            { name: 'setup.exe', bytes: 20480, binary: true },
          ],
        },
      ]),
    )
    expect(back.messages[0].files).toEqual([
      { name: '笔记.md', bytes: 1200, uuid: 'r1', rel: 'docs/导数/static/r1.md', chars: 800, truncated: true },
      { name: 'setup.exe', bytes: 20480, binary: true },
    ])
  })

  it('图片活着回来：消息自己的那张与工具附带回的那张', () => {
    const shot = { id: 'img1', rel: 'docs/导数/images/img1.png', name: '截图.png', mime: 'image/png', bytes: 4096, width: 800, height: 600 }
    const back = roundTrip(
      convWith([
        { ...msg('u1', 'user', '这张图里是什么'), images: [{ ...shot, id: 'img0', rel: 'docs/导数/images/img0.png' }] },
        {
          ...msg('a1', 'assistant', '我看一眼'),
          parts: [
            { type: 'text', text: '我看一眼' },
            { type: 'tool', id: 't1', name: 'execute', args: '{}', result: 'ok', ok: true, status: 'done', images: [shot] },
          ],
        },
      ]),
    )
    expect(back.messages[0].images?.[0]).toMatchObject({ id: 'img0', rel: 'docs/导数/images/img0.png' })
    const part = back.messages[1].parts.find((p) => p.type === 'tool')
    expect(part && part.type === 'tool' ? part.images : null).toEqual([shot])
  })

  it('写摘要的那一轮没跑完（pending 留在盘上）：读回来就地把它应用掉', () => {
    const back = roundTrip(
      convWith(
        [msg('u1', 'user', '我想学导数'), msg('a1', 'assistant', '好'), msg('u2', 'user', '继续')],
        { at: now, text: '## 已经讲清的内容\n导数的定义。', tasks: [], messages: 0, chars: 0, pending: true },
      ),
    )
    // 不应用的话，下一次 finally 动手时会把「之后」的新消息一起吞掉
    expect(back.summary?.pending).toBeFalsy()
    expect(back.messages.every((m) => m.retired)).toBe(true)
    // 条数与字数是**应用时**按当时活着的消息重算的（盘上那份是 0/0）
    expect(back.summary?.messages).toBe(3)
    expect(back.summary?.chars).toBeGreaterThan(0)
    // 再存一次，盘上就没有 pending 这个键了（normalizeSummary 只认 true）
    expect(roundTrip(back).summary).not.toHaveProperty('pending')
  })

  it('失活脱离摘要就作废：摘要没了还认它，整段历史会一条都不发', () => {
    const back = roundTrip(
      convWith([
        { ...msg('u1', 'user', '第一句'), retired: true },
        { ...msg('u2', 'user', '第二句'), retired: true },
      ]),
    )
    expect(back.summary).toBeUndefined()
    expect(back.messages.every((m) => !m.retired)).toBe(true)
    expect(activeMessages(back.messages)).toHaveLength(2)
  })

  it('坏数据不炸也不留：没正文的摘要、没名字的附件、缺一半的图片引用', () => {
    const back = roundTrip(
      convWith(
        [
          {
            ...msg('u1', 'user', '正文'),
            files: [
              { name: '', bytes: 10, uuid: 'r1', rel: 'a.md' },
              { name: '半条.md', bytes: 10, uuid: 'r2' },
              { name: '半张.png', uuid: 'r3', bytes: 0 },
            ],
            // rel 是空的：手改过的 chat.json 里那种半条记录
            images: [{ id: 'x', name: '没有 rel', rel: '', mime: 'image/png', bytes: 1 }],
          },
          { ...msg('u2', 'user', '【空 mark】'), hidden: true, mark: '' },
        ],
        { at: now, text: '   ', tasks: [], messages: 0, chars: 0 },
      ),
    )
    expect(back.summary).toBeUndefined()
    // 没名字的那条整条丢掉；缺一半引用的留下名字与体积（模型至少知道「他附过一份东西」）
    expect(back.messages[0].files).toEqual([
      { name: '半条.md', bytes: 10 },
      { name: '半张.png', bytes: 0 },
    ])
    expect(back.messages[0].images).toBeUndefined()
    expect(back.messages[1].mark).toBeUndefined()
  })
})

describe('在途轮次：增量落库的形状与中断恢复（见 learn/agent/inflight）', () => {
  const runningTool = {
    type: 'tool' as const,
    id: 't1',
    name: 'execute',
    args: '{}',
    result: '',
    ok: true,
    status: 'running' as const,
  }

  it('没收口的回复读回即恢复：没跑完的执行补「结果未知」回执，末尾加中断说明，标记清掉', () => {
    const conv = {
      ...convWith([msg('u1', 'user', '帮我写份大纲'), { ...msg('a9', 'assistant', '好，开始。'), parts: [runningTool, { type: 'text' as const, text: '先看看' }] }]),
      inflight: { messageId: 'a9', startedAt: now },
    }
    const back = roundTrip(conv)
    expect(back.inflight).toBeUndefined()
    const parts = back.messages[1].parts
    expect(parts[0]).toMatchObject({ type: 'tool', status: 'error', ok: false, result: expect.stringContaining('结果未知') })
    expect(parts[parts.length - 1]).toMatchObject({ type: 'notice', level: 'warn' })
  })

  it('在途但一个片段都没落上：空回复丢弃，用户消息原地留着', () => {
    const conv = {
      ...convWith([msg('u1', 'user', '在吗'), { ...msg('a9', 'assistant', ''), parts: [] }]),
      inflight: { messageId: 'a9', startedAt: now },
    }
    const back = roundTrip(conv)
    expect(back.inflight).toBeUndefined()
    expect(back.messages.map((m) => m.id)).toEqual(['u1'])
  })

  it('老数据没有在途标记：跑一半的工具片段原样保留（用户手动停的那种），不误标', () => {
    const back = roundTrip(
      convWith([msg('u1', 'user', '开始吧'), { ...msg('a1', 'assistant', ''), parts: [runningTool] }]),
    )
    expect(back.inflight).toBeUndefined()
    expect(back.messages[1].parts).toEqual([runningTool])
  })

  it('恢复是幂等的：读回两次不会补两条中断说明', () => {
    const conv = {
      ...convWith([msg('u1', 'user', '开始吧'), { ...msg('a9', 'assistant', ''), parts: [runningTool] }]),
      inflight: { messageId: 'a9', startedAt: now },
    }
    const once = roundTrip(conv)
    const twice = roundTrip(once)
    expect(twice.messages[1].parts.filter((p) => p.type === 'notice')).toHaveLength(1)
  })

  it('upsertAssistantInFlight：第一次追加、之后按 id 替换、settle 清标记', () => {
    const conv = { ...convWith([msg('u1', 'user', '你好')]), inflight: { messageId: 'a1', startedAt: now } }
    const first = upsertAssistantInFlight(conv, { id: 'a1', role: 'assistant', parts: [runningTool], ts: now })
    expect(first.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(first.inflight).toBeDefined()
    const second = upsertAssistantInFlight(
      first,
      { id: 'a1', role: 'assistant', parts: [runningTool, { type: 'text', text: '好了' }], ts: now },
      true,
    )
    expect(second.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(second.messages[1].parts).toHaveLength(2)
    expect(second.inflight).toBeUndefined()
  })
})
