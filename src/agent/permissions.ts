/**
 * 这个文件负责什么：**外部路径放行的宿主逻辑**——沙箱里 permission.*（list / revoke /
 * request）背后的那份行为（见 sandbox/types 的 PermissionOps）。
 *
 * 放行配置住在 agent 设置的 permissions.allowedDirs（超级导师设置 →「工具」页里那份
 * 清单，见 components/agent-settings/ToolsTab）；主进程侧逐次读写时的真正校验是
 * electron/base/permissions 的 checkPathPermission。这里改完 saveAgentSettings 会把
 * 新清单同步给主进程（settings.ts 的 syncNativePermissions），即刻生效。
 *
 * 安全口径（已知且暂接受的取舍）：放行配置对 agent 是可写的——request 一经用户批准
 * 即落配置，revoke 也是 api 直改，这里不设第二道防线。
 *
 * 路径归一化用纯字符串运算（不用 node:path）：这一侧跑在渲染层。
 */
import { userAbsPrefix } from '../lib/storage'
import { loadAgentSettings, saveAgentSettings } from './settings'
import type { AskFormPayload, PermissionOps, PermissionRequestPayload } from './sandbox/types'

/**
 * 归一化一个候选目录：反斜杠统一成正斜杠、压掉重复与尾斜杠；
 * 绝对路径（Windows 盘符或 POSIX 根）原样保留，相对路径解析到数据根之下；
 * 空串与 '.' 指数据根本身（与 api.ts 的 resolveSandboxedPath、主进程的
 * checkPathPermission 同一条解析规则）。
 */
export function normalizeDir(raw: string): string {
  const root = (userAbsPrefix() ?? '').replace(/\\/g, '/')
  let p = (raw ?? '').trim().replace(/\\/g, '/')
  if (!p || p === '.') {
    p = root
  } else if (!/^[A-Za-z]:\//.test(p) && !p.startsWith('/')) {
    p = (root ? root.replace(/\/+$/, '') + '/' : '') + p
  }
  return p.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
}

/** base 是否覆盖 dir（等于或是它的祖先目录）。小写比较：Windows 盘符大小写不敏感 */
function covers(dir: string, base: string): boolean {
  if (!base) return false
  const d = dir.toLowerCase()
  const b = base.toLowerCase()
  return d === b || d.startsWith(b + '/')
}

const allowedDirsOf = (): string[] => loadAgentSettings().permissions?.allowedDirs ?? []

/**
 * 一个目录此刻的可访问判定：covered 表示 files.* / process.* 已经放得行——
 * 在数据根之下，或在某个已放行目录之内。**放行目录的父目录不算覆盖**：
 * 放行 `C:/a/b` 不等于放行 `C:/a`，扩到父级同样要过审批。
 */
export function coverageOf(dir: string): { covered: boolean; byRoot: boolean; normalized: string } {
  const normalized = normalizeDir(dir)
  const byRoot = covers(normalized, normalizeDir(''))
  return {
    covered: byRoot || allowedDirsOf().some((d) => covers(normalized, normalizeDir(d))),
    byRoot,
    normalized,
  }
}

/** permission.list：当前可访问作用域（数据根 + 放行清单） */
export function accessibleScope(): { ok: true; root: string; allowedDirs: string[]; note: string } {
  return {
    ok: true,
    root: normalizeDir(''),
    allowedDirs: allowedDirsOf().map(normalizeDir),
    note: '数据根目录及其子树始终可访问（不可撤销）；allowedDirs 是用户放行的外部目录（files.* 与 process.* 的每次读写都在主进程按它校验）。',
  }
}

/** permission.revoke：从放行清单里撤掉一个目录（归一化后精确匹配） */
export function revokeAllowedDir(
  raw: string,
): { ok: true; removed: string; allowedDirs: string[]; note: string } | { ok: false; error: string } {
  const target = normalizeDir(raw)
  if (!target) return { ok: false, error: 'permission.revoke 需要一个 path（要撤销放行的目录）' }
  const dirs = allowedDirsOf()
  const idx = dirs.findIndex((d) => normalizeDir(d).toLowerCase() === target.toLowerCase())
  if (idx < 0) {
    const current = dirs.map((d) => normalizeDir(d))
    return {
      ok: false,
      error:
        '放行清单里没有这个目录（按归一化后精确匹配）：' + target +
        '。当前清单：' + (current.join('、') || '（空）') +
        '。数据根目录始终可访问，不在清单里、也无可撤销。',
    }
  }
  const removed = normalizeDir(dirs[idx])
  const next = dirs.filter((_, i) => i !== idx)
  saveAgentSettings({ ...loadAgentSettings(), permissions: { allowedDirs: next } })
  return { ok: true, removed, allowedDirs: next.map(normalizeDir), note: '已撤销，主进程侧的逐次校验即刻按新清单走。' }
}

/** 审批通过后的落账：目录进放行清单（已在作用域内的拒绝重复放行） */
export function approveAllowedDir(
  raw: string,
): { ok: true; added: string; allowedDirs: string[] } | { ok: false; error: string } {
  const target = normalizeDir(raw)
  if (!target) return { ok: false, error: '要放行的目录路径不能为空' }
  if (coverageOf(target).covered) {
    return { ok: false, error: '该目录已在可访问作用域内（数据根之下或已放行目录之内），无需重复放行' }
  }
  const dirs = [...allowedDirsOf(), target]
  saveAgentSettings({ ...loadAgentSettings(), permissions: { allowedDirs: dirs } })
  return { ok: true, added: target, allowedDirs: dirs.map(normalizeDir) }
}

/** 审批卡片的表单：path 与理由摆出来，放行 / 拒绝二选一（复用 ask 的表单通道） */
export function permissionRequestForm(req: PermissionRequestPayload, normalized: string): AskFormPayload {
  const reason = req.reason?.trim()
  return {
    title: '路径放行审批',
    questions: [
      {
        id: 'approve',
        type: 'single',
        prompt:
          'Agent 请求放行目录：' + normalized +
          (reason ? '\n理由：' + reason : '') +
          '\n放行后，agent 的文件与进程操作（files.* / process.*）可以直接访问该目录及其全部子目录。是否放行？',
        options: [
          { id: 'yes', label: '放行' },
          { id: 'no', label: '拒绝' },
        ],
      },
    ],
  }
}

export type ApprovalVerdict = 'approved' | 'denied' | 'cancelled' | 'unanswered' | 'failed'

/**
 * 从 ask 通道的返回值里读审批结论：提交 → 看选了哪项；取消 / 超时 / 中断 /
 * 没作答都不是批准——「没有明确的批准」一律不放行。
 */
export function approvalVerdict(res: unknown): ApprovalVerdict {
  if (!res || typeof res !== 'object') return 'failed'
  const r = res as { ok?: boolean; cancelled?: boolean; timedOut?: boolean; answers?: unknown }
  if (r.cancelled) return 'cancelled'
  if (r.ok === false || r.timedOut) return 'failed'
  const answers = Array.isArray(r.answers) ? (r.answers as Array<Record<string, unknown>>) : []
  const a = answers.find((x) => x?.id === 'approve') as { pickedIds?: string[]; picked?: string[] } | undefined
  if (!a) return 'unanswered'
  const picked = [...(a.pickedIds ?? []), ...(a.picked ?? [])].map((x) => String(x).trim().toLowerCase())
  if (picked.includes('yes') || picked.includes('放行')) return 'approved'
  return 'denied'
}

/**
 * permission 组的宿主实现。只需要一个依赖：ask 的表单通道（阻塞到用户提交/取消）。
 * 审批走的是与 api.ask 同一条 pendingAsk 管线——展示、限时、停止中断都免费拿到；
 * 区别只在结果的去向：答案不回给模型，批准这件事由宿主直接落进配置。
 */
export function makePermissionOps(deps: { ask: (form: AskFormPayload) => Promise<unknown> }): PermissionOps {
  return {
    list: () => accessibleScope(),
    revoke: (path) => revokeAllowedDir(path),
    request: async (payload) => {
      const req =
        payload && typeof payload === 'object'
          ? (payload as PermissionRequestPayload)
          : { path: String(payload ?? '') }
      const normalized = normalizeDir(req.path ?? '')
      if (!normalized) return { ok: false, error: 'permission.request 需要 path（要放行的目录），可附 reason 说明给用户看' }
      const cov = coverageOf(normalized)
      if (cov.covered) {
        return {
          ok: true,
          approved: true,
          alreadyAccessible: true,
          path: normalized,
          note: cov.byRoot
            ? '该目录在数据根之下，本来就可访问，无需放行。'
            : '该目录已在放行清单的覆盖范围内，无需重复放行。',
        }
      }
      const res = await deps.ask(permissionRequestForm(req, normalized))
      const verdict = approvalVerdict(res)
      if (verdict === 'approved') {
        const applied = approveAllowedDir(normalized)
        if (!applied.ok) return applied
        return {
          ok: true,
          approved: true,
          path: applied.added,
          allowedDirs: applied.allowedDirs,
          note: '用户已放行，配置即刻生效（主进程侧的逐次校验按新清单走）。',
        }
      }
      return {
        ok: true,
        approved: false,
        path: normalized,
        ...(verdict === 'cancelled' ? { cancelled: true } : {}),
        note:
          verdict === 'denied'
            ? '用户拒绝了这次放行。不要反复重试同一个路径——把需要它的原因讲给用户，或改用数据根内的路径。'
            : verdict === 'cancelled'
              ? '用户关掉了审批卡片，没有放行。'
              : '审批没有完成（超时或这一轮被停止），没有放行。',
      }
    },
  }
}
