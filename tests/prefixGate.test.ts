/**
 * 前缀门禁（agent/prefixGate）的行为钉子：
 * 同一会话的上下文只允许「逐字节前缀 + 追加」，唯一的例外是 withinBudget 那种
 * 「从最旧一头裁掉一段」的形状；工具声明必须不变。系统提示词每轮现拼，允许变化。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertPrefixStable,
  clearPrefixGatesForTests,
  currentEpoch,
  lastCacheRead,
  noteCacheRead,
  PrefixGateError,
  resetPrefixGate,
} from '../src/agent/prefixGate'
import type { ChatMessage } from '../src/ai/types'

const msg = (role: ChatMessage['role'], content: string): ChatMessage =>
  ({ role, content }) as ChatMessage

const tools = [{ name: 'execute', description: '执行一段 JS', parameters: { type: 'object' } }]

beforeEach(() => clearPrefixGatesForTests())

describe('前缀门禁', () => {
  it('第一次请求无条件放行并记账', () => {
    expect(() => assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)).not.toThrow()
  })

  it('只在其后追加（增长）放行', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)
    expect(() =>
      assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好'), msg('assistant', '好')], tools),
    ).not.toThrow()
  })

  it('与上次完全相同视为重试，放行', () => {
    const same = [msg('system', 'S'), msg('user', '你好')]
    assertPrefixStable('c1', same, tools)
    expect(() => assertPrefixStable('c1', same, tools)).not.toThrow()
  })

  it('中间一条被改写：抛 PrefixGateError，且记账更新后重放不再拦', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好'), msg('assistant', '好')], tools)
    const rewritten = [msg('system', 'S'), msg('user', '你好！'), msg('assistant', '好'), msg('user', '继续')]
    expect(() => assertPrefixStable('c1', rewritten, tools)).toThrow(PrefixGateError)
    // 抛错前已把这次的上下文记为新基线：会话不会被无限拦下去
    expect(() => assertPrefixStable('c1', rewritten, tools)).not.toThrow()
  })

  it('系统提示词变了：放行并换一届缓存纪元', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)
    const epoch = currentEpoch('c1')
    expect(() => assertPrefixStable('c1', [msg('system', 'S2'), msg('user', '你好')], tools)).not.toThrow()
    expect(currentEpoch('c1')).toBe(epoch + 1)
  })

  it('系统提示词变化不掩护历史改写：两边切掉 system 后仍按前缀纪律比对', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)
    expect(() =>
      assertPrefixStable('c1', [msg('system', 'S2'), msg('user', '你好！')], tools),
    ).toThrow(PrefixGateError)
  })

  it('工具声明变了：抛错', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)
    const changed = [{ ...tools[0], description: '换了一段描述' }]
    expect(() => assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好'), msg('assistant', '好')], changed)).toThrow(
      PrefixGateError,
    )
  })

  it('从尾部变短（上次发过的消息这次没了）：抛错', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好'), msg('assistant', '好')], tools)
    expect(() => assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)).toThrow(PrefixGateError)
  })

  it('从最旧一头裁掉一段（withinBudget 的形状）：放行', () => {
    assertPrefixStable(
      'c1',
      [msg('system', 'S'), msg('user', '旧一'), msg('assistant', '旧二'), msg('user', '旧三')],
      tools,
    )
    // 裁掉最旧两条 user/assistant，再接上新的往来
    expect(() =>
      assertPrefixStable(
        'c1',
        [msg('system', 'S'), msg('user', '旧三'), msg('assistant', '新四'), msg('user', '新五')],
        tools,
      ),
    ).not.toThrow()
  })

  it('缓存哨兵的纪元：前缀搬家（裁剪 / 重置）换届，跨届读数不比较', () => {
    // 同届内：读数账对得上
    noteCacheRead('c1', 16256)
    expect(lastCacheRead('c1')).toMatchObject({ epoch: 0, read: 16256 })
    expect(currentEpoch('c1')).toBe(0)
    // 裁剪（前缀搬家）：纪元换届——旧读数比不得
    assertPrefixStable(
      'c1',
      [msg('system', 'S'), msg('user', '旧一'), msg('assistant', '旧二'), msg('user', '旧三')],
      tools,
    )
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '旧三'), msg('assistant', '新四')], tools)
    expect(currentEpoch('c1')).toBe(1)
    expect(lastCacheRead('c1')!.epoch).toBe(0)
    // 换届后记的新读数带新纪元
    noteCacheRead('c1', 7552)
    expect(lastCacheRead('c1')).toMatchObject({ epoch: 1, read: 7552 })
    // 重置：账本整条清掉
    resetPrefixGate('c1')
    expect(lastCacheRead('c1')).toBeUndefined()
    expect(currentEpoch('c1')).toBe(2)
  })

  it('resetPrefixGate 之后账重新开始记', () => {
    assertPrefixStable('c1', [msg('system', 'S'), msg('user', '你好')], tools)
    resetPrefixGate('c1')
    expect(() => assertPrefixStable('c1', [msg('system', '换了'), msg('user', '完全不同')], tools)).not.toThrow()
  })

  it('不同会话各记各的账', () => {
    assertPrefixStable('c1', [msg('system', 'S1'), msg('user', '甲')], tools)
    expect(() => assertPrefixStable('c2', [msg('system', 'S2'), msg('user', '乙')], tools)).not.toThrow()
    expect(() => assertPrefixStable('c1', [msg('system', 'S1'), msg('user', '甲'), msg('assistant', '好')], tools)).not.toThrow()
  })
})
