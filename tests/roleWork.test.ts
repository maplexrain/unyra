/**
 * role-work 工作层的端到端测试：假流驱动 work.create → work.send → 后台执行 → 交付回 role。
 *
 * 钉住：名称校验与唯一性、send 起轮、自动交付（没 host.send 时）、显式 host.send、
 * status 只回 execute 标题、kill 删除、works 账本与交付通道钩子。
 */
import { describe, expect, it } from 'vitest'
import { createWorkManager, type WorkManagerDeps } from '../src/agent/work/manager'
import type { ConversationMessage, WorkSession } from '../src/agent/types'
import { conversationMessageById } from '../src/learn/roleWork/channels'
import type { SandboxOptions, SandboxRequest, SandboxReply } from '../src/agent/sandbox/types'
import type { ResolvedProvider } from '../src/ai/client'
import { AiRequestError } from '../src/ai/types'
import type { ChatMessage, StreamChatOptions, StreamChatResult } from '../src/ai/types'

const provider = { id: 't', label: 'T', baseUrl: 'http://localhost', apiKey: 'k' } as ResolvedProvider

interface Hop {
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}

function scriptedStream(routes: Array<{ match: string; hops: Hop[] }>) {
  const requests: ChatMessage[][] = []
  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    requests.push(JSON.parse(JSON.stringify(opts.messages)))
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
    const route = routes.find((h) => text.includes(h.match))
    if (!route) throw new Error('没有匹配的剧本：' + text.slice(0, 80))
    const hop = route.hops.shift()
    if (!hop) throw new Error('剧本用完了：' + text.slice(0, 80))
    if (hop.content) opts.onDelta?.({ content: hop.content })
    return { content: hop.content, reasoning: '', toolCalls: hop.toolCalls ?? [], finishReason: 'stop' }
  }
  return { requests, stream }
}

function sandboxBase(calls: string[]): SandboxOptions {
  return {
    nodeId: () => null,
    resolveNode: () => ({ ok: false, message: '没有节点' }),
    resolveDoc: () => ({ ok: false, message: '没有文档' }),
    docOps: {} as never,
    nodeOps: {} as never,
    runSandbox: async (req: SandboxRequest): Promise<SandboxReply> => {
      const host = /host\.send\(([\s\S]*)\)/.exec(req.body)
      const search = /web\.search\(([^)]*)\)/.exec(req.body)
      const wait = /api\.wait\(([^)]*)\)/.exec(req.body)
      const name = host ? 'host.send' : search ? 'web.search' : wait ? 'wait' : 'unknown'
      calls.push(name)
      try {
        return {
          ok: true,
          value: host
            ? await req.callApi('host.send', [{ text: '显式交付' }])
            : search
              ? await req.callApi('web.search', [search[1]!.replace(/['"]/g, '')])
              : wait
                ? await req.callApi('wait', [Number(wait[1])])
                : null,
          ms: 1,
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  } as SandboxOptions
}

function makeManager(
  stream: WorkManagerDeps['stream'],
  calls: string[] = [],
  roleMessage: WorkManagerDeps['roleMessage'] = () => null,
  extra: Partial<WorkManagerDeps> = {},
) {
  let works: WorkSession[] = []
  const deliveries: Array<{ text: string; auto?: boolean }> = []
  const outbound: string[] = []
  const manager = createWorkManager({
    roleId: 'tutor',
    roleConversationId: 'c1',
    getWorks: () => works,
    setWorks: (update) => {
      works = update(works)
    },
    buildSystem: () => 'WORK SYSTEM',
    roleMessage,
    appendOutbound: (_w, text) => outbound.push(text),
    deliverToRole: (_w, text, meta) => deliveries.push({ text, ...(meta.auto ? { auto: true } : {}) }),
    stream,
    onEvent: () => {},
    onRunEnd: () => {},
    ...extra,
  })
  manager.setTurn({ sandbox: sandboxBase(calls), provider, model: 'test-model', contextWindow: 100_000 })
  return { manager, works: () => works, deliveries, outbound }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('work.create / list / kill', () => {
  it('名称校验、重名拒绝、缺省 work-N、kill 删除', async () => {
    const { manager, works } = makeManager(scriptedStream([]).stream)
    expect(await manager.api.create({ name: 'bad/name' })).toMatchObject({ ok: false })
    const a = await manager.api.create()
    expect(a.ok).toBe(true)
    expect((await manager.api.list()).map((w) => w.name)).toEqual(['work-1'])
    expect(await manager.api.create({ name: 'work-1' })).toMatchObject({ ok: false })
    const b = await manager.api.create({ name: '调研-1' })
    expect(b.ok).toBe(true)
    expect(works()).toHaveLength(2)
    expect(await manager.api.kill('missing')).toMatchObject({ ok: false })
    expect(await manager.api.kill('调研-1')).toMatchObject({ ok: true })
    expect(works().map((w) => w.name)).toEqual(['work-1'])
  })
})

describe('work.send 与交付', () => {
  it('send 起一轮，结束后自动把正文回传 role（auto），账本与 status 齐全', async () => {
    const { requests, stream } = scriptedStream([{ match: '查勾股', hops: [{ content: '勾股定理的结论与来源。' }] }])
    const { manager, works, deliveries } = makeManager(stream)
    manager.api.create({ name: '调研-1' })
    const r = manager.api.send({ name: '调研-1', text: '查勾股定理' })
    expect(r).toMatchObject({ ok: true, mode: 'started' })
    await tick()
    await tick()
    const w = works()[0]!
    expect(w.runs).toBe(1)
    expect(w.status).toBe('idle')
    expect(w.messages.some((m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && p.text.includes('查勾股')))).toBe(true)
    expect(w.messages.some((m) => m.role === 'assistant')).toBe(true)
    expect(deliveries).toEqual([{ text: '勾股定理的结论与来源。', auto: true }])
    expect(requests).toHaveLength(1)
    const short = manager.api.status('调研-1') as { runs: number; recentExecutes: unknown[] }
    expect(short.runs).toBe(1)
    expect(short.recentExecutes).toEqual([])
  })

  it('bindMessageId 可选绑定一条通道消息，运行状态从 running 同步到完成', async () => {
    const { stream } = scriptedStream([{ match: '查勾股', hops: [{ content: '勾股定理的结论与来源。' }] }])
    const bound: Array<{ messageId: string; status: string }> = []
    const updates: Array<{ messageId: string; workId: string; patch: { status?: string } }> = []
    const { manager, works } = makeManager(stream, [], () => null, {
      bindWorkMessage: (messageId, binding) => {
        bound.push({ messageId, status: binding.status })
        return { ok: true }
      },
      updateWorkBinding: (messageId, workId, patch) => {
        updates.push({ messageId, workId, patch })
      },
    })
    manager.api.create({ name: '调研-1' })
    const r = manager.api.send({ name: '调研-1', text: '查勾股定理', bindMessageId: 'm-channel' })
    expect(r).toMatchObject({ ok: true, mode: 'started' })
    expect(bound).toEqual([{ messageId: 'm-channel', status: 'running' }])
    await tick()
    await tick()
    expect(works()[0]!.status).toBe('idle')
    expect(updates.some((u) => u.messageId === 'm-channel' && u.patch.status === 'idle')).toBe(true)
  })

  it('绑定失败时整笔 send 拒绝，不留“任务已收”的回执', async () => {
    const { stream } = scriptedStream([])
    const { manager, works, outbound } = makeManager(stream, [], () => null, {
      bindWorkMessage: () => ({ ok: false, error: '这条消息不在本通道里' }),
      updateWorkBinding: () => {},
    })
    manager.api.create({ name: '调研-1' })
    const r = manager.api.send({ name: '调研-1', text: '查勾股定理', bindMessageId: 'm-gone' })
    expect(r).toMatchObject({ ok: false })
    expect(outbound).toEqual([])
    expect(works()[0]!.messages).toEqual([])
  })


  it('role 用群聊抬头 id 引用带图消息：work.send 能解析并把附件引用落进 work', async () => {
    const groupMessage: ConversationMessage = {
      id: 'm-internal',
      role: 'user',
      ts: 1,
      parts: [{ type: 'text', text: '看这张图' }],
      channel: {
        channel: 'group',
        from: { kind: 'user', id: 'u1', name: 'Maxwell' },
        to: { kind: 'role', id: 'tutor', name: '导师龟' },
        ts: 1,
        envelopeId: 'g-abc',
      },
      images: [
        { id: 'img-1', name: 'shot.png', rel: 'docs/高等数学/static/shot.png', mime: 'image/png', bytes: 10 },
      ],
    }
    const { stream } = scriptedStream([{ match: '读附件', hops: [{ content: '完成' }] }])
    const { manager, works } = makeManager(stream, [], (id) => conversationMessageById([groupMessage], id))
    manager.api.create({ name: '看图' })
    const r = manager.api.send({ name: '看图', messageId: 'g-abc', text: '读附件' })
    expect(r).toMatchObject({ ok: true, mode: 'started' })
    const task = works()[0]!.messages.at(-1)!
    expect(task.images?.map((i) => i.id)).toEqual(['img-1'])
    expect(task.parts[0]!.type === 'text' ? task.parts[0]!.text : '').toContain('引用 role 会话消息 m-internal')
    await tick()
    await tick()
  })

  it('显式 host.send：不再自动回传；status 的 recentExecutes 只记 execute 标题', async () => {
    const { stream } = scriptedStream([
      {
        match: '工具单',
        hops: [
          {
            content: '',
            toolCalls: [
              {
                id: 't1',
                name: 'execute',
                arguments: JSON.stringify({
                  description: '回传结果',
                  body: '((api) => api.host.send({ text: "显式交付" }))',
                }),
              },
            ],
          },
          { content: '收尾正文。' },
        ],
      },
    ])
    const calls: string[] = []
    const { manager, works, deliveries } = makeManager(stream, calls)
    manager.api.create({ name: '工具活儿' })
    manager.api.send({ name: '工具活儿', text: '工具单' })
    await tick()
    await tick()
    const w = works()[0]!
    expect(w.execTrace.map((x) => x.title)).toEqual(['回传结果'])
    expect(deliveries).toEqual([{ text: '显式交付' }])
    expect(calls).toContain('host.send')
  })

  it('运行中补任务：任务消息排在当前 assistant 之后，不会改写已有前缀', async () => {
    const { requests, stream } = scriptedStream([
      {
        match: '第一棒',
        hops: [
          {
            content: '先跑一段。',
            toolCalls: [
              {
                id: 'w1',
                name: 'execute',
                arguments: JSON.stringify({
                  description: '等一会',
                  body: '((api) => api.wait(30))',
                }),
              },
            ],
          },
        ],
      },
      { match: '第二棒', hops: [{ content: '第二棒收尾。' }] },
    ])
    const { manager, works } = makeManager(stream)
    manager.api.create({ name: '接力' })
    expect(manager.api.send({ name: '接力', text: '第一棒' })).toMatchObject({ ok: true, mode: 'started' })
    // 第一轮还在 wait：此时补任务只能排队，不能先落进 work.messages 把 assistant 挤到后面
    expect(manager.api.send({ name: '接力', text: '第二棒' })).toMatchObject({ ok: true, mode: 'queued' })
    await new Promise((r) => setTimeout(r, 80))
    await tick()
    const messages = works()[0]!.messages
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[0]!.parts.some((p) => p.type === 'text' && p.text.includes('第一棒'))).toBe(true)
    expect(messages[1]!.parts.some((p) => p.type === 'tool' && p.name === 'execute')).toBe(true)
    expect(messages[2]!.parts.some((p) => p.type === 'text' && p.text.includes('第二棒'))).toBe(true)
    expect(messages[3]!.parts.some((p) => p.type === 'text' && p.text.includes('第二棒收尾'))).toBe(true)
    // 第二次请求看到的历史必须是 [第一棒, assistant 工具跳, 第二棒]，而不是把任务塞在 assistant 前
    expect(requests[1]!.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
    expect(requests[1]![2]!.content).toContain('先跑一段')
    expect(typeof requests[1]![4]!.content === 'string' ? requests[1]![4]!.content : '').toContain('第二棒')
  })

  it('work 异常终止：系统自动把状态与原因上报给 role', async () => {
    const { manager, works, deliveries } = makeManager(async () => {
      throw new AiRequestError('模型连接断开', 401)
    })
    manager.api.create({ name: '会掉线' })
    manager.api.send({ name: '会掉线', text: '跑一下' })
    await new Promise((r) => setTimeout(r, 100))
    await tick()
    expect(works()[0]!.status).toBe('error')
    expect(works()[0]!.lastIssue).toContain('模型连接断开')
    expect(deliveries.at(-1)?.text).toContain('work 异常终止')
    expect(deliveries.at(-1)?.text).toContain('会掉线')
    expect(deliveries.at(-1)?.text).toContain('模型连接断开')
    expect(deliveries.at(-1)?.auto).toBe(true)
  })

  it('work 的 wait 由 work 自己接上，不借 role 的信号', async () => {
    const { stream } = scriptedStream([
      {
        match: '等片刻',
        hops: [
          {
            content: '',
            toolCalls: [
              {
                id: 'w1',
                name: 'execute',
                arguments: JSON.stringify({
                  description: '等待',
                  body: '((api) => api.wait(0))',
                }),
              },
            ],
          },
          { content: '等好了。' },
        ],
      },
    ])
    const calls: string[] = []
    const { manager, works } = makeManager(stream, calls)
    manager.api.create({ name: '等待' })
    manager.api.send({ name: '等待', text: '等片刻' })
    await tick()
    await tick()
    await tick()
    const w = works()[0]!
    expect(w.status).toBe('idle')
    expect(w.execTrace.map((x) => x.title)).toEqual(['等待'])
    expect(calls).toContain('wait')
  })

  it('未知 work 与空 send 都当场拒绝，不落任何东西', () => {
    const { manager, works } = makeManager(scriptedStream([]).stream)
    expect(manager.api.send({ name: 'ghost', text: '做活' })).toMatchObject({ ok: false })
    manager.api.create({ name: '闲人' })
    expect(manager.api.send({ name: '闲人' })).toMatchObject({ ok: false })
    expect(works()).toHaveLength(1)
  })
})

describe('用户终止 work', () => {
  it('空声明只能拒绝；带声明的终止会落 stopped 并把说明发给 role', () => {
    const { manager, works, deliveries } = makeManager(scriptedStream([]).stream)
    manager.api.create({ name: '调研-1' })
    expect(manager.stopWithStatement('调研-1', '   ')).toMatchObject({ ok: false })

    const r = manager.stopWithStatement('调研-1', '方向变了，先保留材料')
    expect(r).toMatchObject({ ok: true, name: '调研-1', status: 'stopped' })
    expect(works()[0]!.status).toBe('stopped')
    expect(works()[0]!.lastIssue).toContain('用户终止')
    expect(deliveries.at(-1)?.text).toContain('用户终止 work')
    expect(deliveries.at(-1)?.text).toContain('方向变了，先保留材料')
  })
})
