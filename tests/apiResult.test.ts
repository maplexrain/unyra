import { describe, expect, it } from 'vitest'
import { apiResultOf, wrapApi } from '../src/agent/sandbox/wrap'
import type { SandboxCall } from '../src/agent/sandbox/types'

describe('execute api 返回值契约', () => {
  it('undefined 也补一张成功回执，模型能判断动作已执行', () => {
    expect(apiResultOf('chat.send', undefined)).toEqual({
      ok: true,
      api: 'chat.send',
      message: '调用完成（该 api 没有额外返回值）',
    })
  })

  it('wrapApi 的同步空返回同样被补成回执', () => {
    const api: Record<string, unknown> = {}
    const log: SandboxCall[] = []
    wrapApi(api, 'chat.send', () => undefined, log)
    const chat = api.chat as Record<string, (...args: unknown[]) => unknown>
    expect(chat.send()).toMatchObject({ ok: true, api: 'chat.send' })
  })
})
