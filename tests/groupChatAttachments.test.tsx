// @vitest-environment happy-dom
/**
 * 群聊带附件：桥先转存、再把引用落进群消息与 role 入站请求。
 * 转存本身在 learn/agent/transfer 的单测里覆盖，这里只验「顺序与引用」。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/learn/agent/transfer', () => ({
  transferPendingImages: vi.fn(async (_get, _set, _goal, pending: { name: string }[]) => ({
    images: pending.map((p, i) => ({
      id: `stored-img-${i}`,
      name: p.name,
      rel: `static/stored-img-${i}.png`,
      mime: 'image/png',
      bytes: 10,
    })),
    error: undefined,
  })),
  transferPendingFiles: vi.fn(async (_get, _set, _goal, pending: { name: string }[]) => ({
    files: pending.map((p, i) => ({ name: p.name, rel: `static/stored-file-${i}.txt`, bytes: 20, binary: false })),
    error: undefined,
  })),
}))

import { getGroupChatMessages } from '../src/learn/groupChat'
import type { PendingFile, PendingImage } from '../src/agent/types'
import { resetChannelRegistry, setRoleWorkDispatcher, type RoleTurnRequest } from '../src/learn/roleWork/dispatch'
import { setGroupTriageRunner } from '../src/learn/roleWork/groupTriage'
import { transferPendingImages } from '../src/learn/agent/transfer'
import type { LearnStore } from '../src/learn/types'
import { useGroupChatBridge, type GroupChatBridge } from '../src/components/learn/workspace/useGroupChatBridge'

const pendingImage: PendingImage = {
  id: 'p-img',
  name: '猫.png',
  bytes: 10,
  file: new File([new Uint8Array([1, 2, 3])], '猫.png', { type: 'image/png' }),
  previewUrl: '',
}
const pendingFile: PendingFile = { id: 'p-doc', name: '说明.txt', bytes: 20, text: '正文' }

describe('群聊附件', () => {
  afterEach(() => {
    setRoleWorkDispatcher(null)
    setGroupTriageRunner(null)
    resetChannelRegistry()
  })

  it('带附件发送：先转存，再把 images / files 引用放进群消息与 role 入站', async () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-attach',
            agents: [{ id: 'tutor', name: '导师龟' }],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    const ok = await bridge!.send('@导师龟 看附件', ['tutor'], undefined, {
      images: [pendingImage],
      files: [pendingFile],
    })
    expect(ok).toBe(true)
    expect(started).toHaveLength(1)
    expect(started[0]!.images?.map((i) => i.name)).toEqual(['猫.png'])
    expect(started[0]!.files?.map((f) => f.name)).toEqual(['说明.txt'])
    const logged = getGroupChatMessages().find((m) => m.goalId === 'g-attach')
    expect(logged?.attachments?.images?.[0]?.rel).toBe('static/stored-img-0.png')
    expect(logged?.attachments?.files?.[0]?.rel).toBe('static/stored-file-0.txt')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('附件转存失败：拒绝发送并保留原话，不落一条没有附件的群消息', async () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-attach-fail',
            agents: [{ id: 'tutor', name: '导师龟' }],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    vi.mocked(transferPendingImages).mockResolvedValueOnce({ images: [], error: '图片存盘失败' })

    await expect(
      bridge!.send('@导师龟 看附件', ['tutor'], undefined, { images: [pendingImage] }),
    ).rejects.toThrow('图片存盘失败')
    expect(getGroupChatMessages().some((m) => m.goalId === 'g-attach-fail')).toBe(false)

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
