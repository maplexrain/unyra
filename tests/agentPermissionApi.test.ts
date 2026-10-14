import { beforeEach, describe, expect, it } from 'vitest'
import { buildApi } from '../src/agent/sandbox/api'
import type { SandboxCall, SandboxOptions } from '../src/agent/sandbox/types'
import { DEFAULT_AGENT_SETTINGS, saveAgentSettings } from '../src/agent/settings'
import { approvalVerdict, coverageOf, makePermissionOps } from '../src/agent/permissions'
import { loadAgentSettings } from '../src/agent/settings'

/**
 * permission 组（路径放行）的行为：list / revoke 走 agent 设置的 permissions.allowedDirs，
 * request 走 ask 的表单通道——「agent-用户-系统」：批准由宿主直接落配置，模型只拿结论。
 */

const dummyOpts: SandboxOptions = {
  nodeId: () => 'node-1',
  resolveNode: () => ({ ok: false, message: 'none' }),
  resolveDoc: () => ({ ok: false, message: 'none' }),
  docOps: {
    read: () => '',
    write: () => ({ ok: true, content: '' }),
    replace: () => ({ ok: true, content: '' }),
    append: () => ({ ok: true, content: '' }),
    annotate: () => ({ ok: true, content: '' }),
  },
  nodeOps: {
    list: () => [],
    read: () => ({ ok: false }),
    create: () => ({ ok: false, content: '' }),
    update: () => ({ ok: false, content: '' }),
    remove: () => ({ ok: false, content: '' }),
    move: () => ({ ok: false, content: '' }),
  },
}

type AskStub = (form: unknown) => Promise<unknown>

const approvingAsk: AskStub = async () => ({
  ok: true,
  cancelled: false,
  answers: [{ id: 'approve', type: 'single', picked: ['放行'], pickedIds: ['yes'] }],
})
const denyingAsk: AskStub = async () => ({
  ok: true,
  cancelled: false,
  answers: [{ id: 'approve', type: 'single', picked: ['拒绝'], pickedIds: ['no'] }],
})
const cancellingAsk: AskStub = async () => ({ ok: true, cancelled: true })

const permissionApiOf = (ask: AskStub) => {
  const log: SandboxCall[] = []
  const { api } = buildApi({ ...dummyOpts, permission: makePermissionOps({ ask }) }, log)
  return api.permission as {
    list: () => { ok: boolean; root: string; allowedDirs: string[] }
    revoke: (p: string) => Promise<{ ok: boolean; removed?: string; allowedDirs?: string[]; error?: string }>
    request: (p: { path: string; reason?: string }) => Promise<{
      ok: boolean
      approved?: boolean
      alreadyAccessible?: boolean
      cancelled?: boolean
      path?: string
      error?: string
    }>
  }
}

const dirsOf = (): string[] => loadAgentSettings().permissions?.allowedDirs ?? []

describe('permission api：路径放行', () => {
  beforeEach(() => {
    saveAgentSettings({ ...DEFAULT_AGENT_SETTINGS, permissions: { allowedDirs: [] } })
  })

  it('permission.list 回数据根与放行清单', async () => {
    saveAgentSettings({ ...loadAgentSettings(), permissions: { allowedDirs: ['C:\\外部数据'] } })
    const api = permissionApiOf(approvingAsk)
    const res = await api.list()
    expect(res.ok).toBe(true)
    expect(res.allowedDirs).toContain('C:/外部数据')
  })

  it('request 命中放行清单（或其子目录）时直接放行，不弹审批', async () => {
    saveAgentSettings({ ...loadAgentSettings(), permissions: { allowedDirs: ['D:/数据集'] } })
    let asked = 0
    const api = permissionApiOf(async (form) => {
      asked++
      return approvingAsk(form)
    })
    const res = await api.request({ path: 'D:/数据集/子目录' })
    expect(res.ok).toBe(true)
    expect(res.alreadyAccessible).toBe(true)
    expect(asked).toBe(0)
  })

  it('request 批准后由宿主落配置（allowedDirs 真的多了一条），理由进审批卡片', async () => {
    let seenForm: { title?: string; questions?: Array<{ prompt?: string; options?: Array<{ label: string }> }> } | null = null
    const api = permissionApiOf(async (form) => {
      seenForm = form as typeof seenForm
      return approvingAsk(form)
    })
    const res = await api.request({ path: 'D:/新目录', reason: '读取外部数据集' })
    expect(res.ok).toBe(true)
    expect(res.approved).toBe(true)
    expect(dirsOf().map((d) => d.toLowerCase())).toContain('d:/新目录')
    expect(seenForm!.title).toBe('路径放行审批')
    expect(seenForm!.questions![0].prompt).toContain('D:/新目录')
    expect(seenForm!.questions![0].prompt).toContain('读取外部数据集')
    expect(seenForm!.questions![0].options!.map((o) => o.label)).toEqual(['放行', '拒绝'])
  })

  it('request 被拒绝 / 取消时不改配置，回 approved:false', async () => {
    const denied = await permissionApiOf(denyingAsk).request({ path: 'D:/新目录' })
    expect(denied.ok).toBe(true)
    expect(denied.approved).toBe(false)
    expect(dirsOf()).toEqual([])

    const cancelled = await permissionApiOf(cancellingAsk).request({ path: 'D:/新目录' })
    expect(cancelled.approved).toBe(false)
    expect(cancelled.cancelled).toBe(true)
    expect(dirsOf()).toEqual([])
  })

  it('revoke 按归一化精确匹配撤掉已放行目录；没放行过的给出清单说明', async () => {
    saveAgentSettings({ ...loadAgentSettings(), permissions: { allowedDirs: ['D:/新目录'] } })
    const api = permissionApiOf(approvingAsk)
    // 大小写不同也算同一条（Windows 盘符大小写不敏感）
    const res = await api.revoke('d:/新目录/')
    expect(res.ok).toBe(true)
    expect(res.removed).toBe('D:/新目录')
    expect(dirsOf()).toEqual([])

    const missing = await api.revoke('D:/没放行过')
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('放行清单里没有')
  })

  it('coverageOf：放行目录的父目录不算覆盖（扩大作用域同样要过审批）', () => {
    saveAgentSettings({ ...loadAgentSettings(), permissions: { allowedDirs: ['D:/数据集/子集'] } })
    expect(coverageOf('D:/数据集/子集/更深').covered).toBe(true)
    expect(coverageOf('D:/数据集').covered).toBe(false)
    expect(coverageOf('D:/数据集').byRoot).toBe(false)
  })

  it('approvalVerdict：超时与中断不算批准，没作答也不算', () => {
    expect(approvalVerdict({ ok: false, timedOut: true, content: '超时' })).toBe('failed')
    expect(approvalVerdict({ ok: false, content: '用户停止了这一轮' })).toBe('failed')
    expect(approvalVerdict({ ok: true, cancelled: true })).toBe('cancelled')
    expect(approvalVerdict({ ok: true, cancelled: false, answers: [] })).toBe('unanswered')
    expect(approvalVerdict(null)).toBe('failed')
  })
})
