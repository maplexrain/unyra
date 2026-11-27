import { describe, expect, it } from 'vitest'
import type { AgentPart, Conversation, ConversationMessage, WorkSession } from '../src/agent/types'
import {
  latestWorkAnchors,
  resolveWorkInline,
  splitWorkRefs,
  workActivityOf,
  workInlineKey,
  workInlineSourceOf,
  type WorkInlineSource,
} from '../src/lib/workInline'

function session(overrides: Partial<WorkSession> = {}): WorkSession {
  const now = 1_000
  return {
    id: 'w-1',
    name: '调研-1',
    roleId: 'tutor',
    roleConversationId: 'c-1',
    status: 'idle',
    runs: 0,
    createdAt: now,
    lastActiveAt: now,
    runtimeMs: 0,
    systemPrompt: '',
    messages: [],
    execTrace: [],
    ...overrides,
  }
}

function assistant(parts: AgentPart[], id = 'm-1'): ConversationMessage {
  return { id, role: 'assistant', parts, ts: 1 }
}

function conversation(id: string, goalId: string, sessions: WorkSession[]): Conversation {
  return {
    id,
    goalId,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    works: { sessions },
  }
}

describe('splitWorkRefs', () => {
  it('只解析独占一行的 work 引用，并保留前后正文', () => {
    expect(splitWorkRefs('先看这个\n[ 调研进度 ](work: 调研-1)\n然后再决定')).toEqual([
      { type: 'text', text: '先看这个' },
      { type: 'work', title: '调研进度', workRef: '调研-1' },
      { type: 'text', text: '然后再决定' },
    ])
  })

  it('代码围栏与行内出现都不解析', () => {
    expect(splitWorkRefs('```\n[调研](work: w-1)\n```')).toEqual([
      { type: 'text', text: '```\n[调研](work: w-1)\n```' },
    ])
    expect(splitWorkRefs('前面 [调研](work: w-1) 后面')).toEqual([
      { type: 'text', text: '前面 [调研](work: w-1) 后面' },
    ])
  })

  it('支持同一条消息里的多个引用块', () => {
    expect(splitWorkRefs('[一](work: a)\n\n[二](work: b)').filter((s) => s.type === 'work')).toEqual([
      { type: 'work', title: '一', workRef: 'a' },
      { type: 'work', title: '二', workRef: 'b' },
    ])
  })
})

describe('resolveWorkInline', () => {
  it('按 name / id 查找；同名时优先有实时轮次的', () => {
    const older = session({ id: 'w-old', name: '同名', lastActiveAt: 20 })
    const live = session({ id: 'w-live', name: '同名', lastActiveAt: 10 })
    const source: WorkInlineSource = {
      sessions: [older, live],
      live: [{ workId: 'w-live', runId: 'r-1', ts: 3, parts: [{ type: 'text', text: '在跑' }] }],
    }
    expect(resolveWorkInline(source, '同名')?.session.id).toBe('w-live')
    expect(resolveWorkInline(source, 'w-old')?.session.id).toBe('w-old')
    expect(resolveWorkInline(source, '没有')).toBeNull()
  })

  it('workInlineSourceOf 按目标收拢 work 账本与实时轮次', () => {
    const a = session({ id: 'w-a', name: 'A' })
    const b = session({ id: 'w-b', name: 'B' })
    const source = workInlineSourceOf(
      [conversation('c-a', 'g-1', [a]), conversation('c-b', 'g-2', [b])],
      [
        { workId: 'w-a', conversationId: 'c-a', runId: 'r-a', ts: 1, parts: [] },
        { workId: 'w-b', conversationId: 'c-b', runId: 'r-b', ts: 2, parts: [] },
      ],
      'g-1',
    )
    expect(source.sessions.map((w) => w.id)).toEqual(['w-a'])
    expect(source.live.map((run) => run.workId)).toEqual(['w-a'])
  })
})

describe('workActivityOf', () => {
  it('实时轮次只取最后一个可见步骤：思考 / execute 标题 / 正文', () => {
    const base = session({ status: 'running', runningSince: 1 })
    expect(workActivityOf(base, { workId: 'w-1', runId: 'r-1', ts: 1, parts: [{ type: 'thinking', text: '先读材料' }] })).toMatchObject({
      kind: 'thinking',
      text: '先读材料',
    })
    expect(
      workActivityOf(base, {
        workId: 'w-1',
        runId: 'r-1',
        ts: 1,
        parts: [{ type: 'tool', id: 't1', name: 'execute', args: '{"description":"整理提纲"}', result: '', ok: true, status: 'running' }],
      }),
    ).toMatchObject({ kind: 'tool', text: '整理提纲' })
    expect(
      workActivityOf(base, {
        workId: 'w-1',
        runId: 'r-1',
        ts: 1,
        parts: [
          { type: 'thinking', text: '想' },
          { type: 'text', text: '第一行\n第二行' },
        ],
      }),
    ).toMatchObject({ kind: 'text', text: '第二行' })
  })

  it('没有实时轮次时退回最后一条 assistant 的最后一步；再退回 issue / 轮次状态', () => {
    const done = session({
      runs: 1,
      messages: [
        assistant([{ type: 'text', text: '旧正文' }], 'm-1'),
        assistant([{ type: 'text', text: '新正文' }, { type: 'tool', id: 't2', name: 'execute', args: '{"description":"收尾"}', result: '', ok: true, status: 'done' }], 'm-2'),
      ],
    })
    expect(workActivityOf(done)).toMatchObject({ kind: 'tool', text: '收尾' })

    const failed = session({ status: 'error', lastIssue: '模型调用失败' })
    expect(workActivityOf(failed)).toMatchObject({ kind: 'idle', text: '模型调用失败', error: true })

    const waiting = session({ status: 'running', runningSince: 2 })
    expect(workActivityOf(waiting)).toMatchObject({ kind: 'idle', text: '正在准备…' })
  })
})

describe('最新 work 引用', () => {
  it('多行流式内容只留最后一行，单行超长时留末尾', () => {
    const base = session({ status: 'running', runningSince: 1 })
    expect(
      workActivityOf(base, {
        workId: 'w-1',
        runId: 'r-1',
        ts: 1,
        parts: [{ type: 'text', text: '第一行\n第二行\n' }],
      }),
    ).toMatchObject({ text: '第二行' })
    const long = '开头' + 'x'.repeat(500) + '当前末尾'
    expect(workActivityOf(base, {
      workId: 'w-1',
      runId: 'r-1',
      ts: 1,
      parts: [{ type: 'text', text: long }],
    }).text.endsWith('当前末尾')).toBe(true)
  })

  it('同一个列表里每个 work 只锚定最新一条消息', () => {
    const a = session({ id: 'w-a', name: '调研龟' })
    const source: WorkInlineSource = { sessions: [a], live: [] }
    const anchors = latestWorkAnchors(
      [
        { id: 'm-old', text: '[旧进度](work: 调研龟)' },
        { id: 'm-new', text: '先看这里\n[新进度](work: w-a)' },
        { id: 'm-other', text: '无关消息' },
      ],
      source,
    )
    expect(anchors.get(workInlineKey(source, '调研龟'))).toBe('m-new')
    expect(anchors.get(workInlineKey(source, 'w-a'))).toBe('m-new')
    expect(anchors.size).toBe(1)
  })
})
