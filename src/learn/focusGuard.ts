/**
 * 严格专注的守卫（focusGuard）：**纯逻辑**——判定怎么解析、画面怎么判、报告长什么样。
 *
 * 与 learn/pomodoro 的关系：番茄钟仍是「一个自己会走的计时器」，守卫只是**旁观者**，
 * 每隔一轮看一眼（屏幕截图 / 摄像头画面交给模型），给出一个判定；真正的动作
 * （警告、暂停计时、熔断停表）由守卫运行时（agent/guardRuntime）转给宿主执行。
 * 这里不碰 store、不发请求、不持 MediaStream——全部可以单独测。
 *
 * 三条策略上的定死（改这里之前先想清楚）：
 * 1. **隐私风险是最高优先级**：只要判定里 privacy 为真，不管别的字段说什么，
 *    一律熔断——摄像头走光这类事，晚一轮都算晚。
 * 2. **「在不在屏幕前」只认眼睛能看到的证据**：有摄像头就信摄像头；
 *    只有屏幕时退而求其次用「最近一次与应用交互」的旧程度当代理——
 *    人不在键盘前不代表不在屏幕前，所以这个阈值取得很宽（见 AWAY_INPUT_MS）。
 * 3. **「在学没在学」只有看得到屏幕才有发言权**：只开摄像头时模型被明确告知
 *    不要评判内容（on_task 恒真），宁可不警告，也不能凭一张脸断言分心。
 */

/* ---------- 可调的那几个数 ---------- */

/** 守卫一轮的间隔（毫秒）：两轮之间留足看的时间，也把 token 花费压在可感知之下 */
export const GUARD_ROUND_MS = 60_000
/**
 * 只开屏幕（没摄像头）时，多久没有与应用交互算「人不在」。
 * 摄像头看脸，屏幕只能看「手」；但看视频课、读纸质书都是合法的「不动」，
 * 所以这个数必须比「切走刷手机」的典型时长宽——3 分半是一个折中。
 */
export const AWAY_INPUT_MS = 3.5 * 60_000
/** 开了专注多久之后停止，才值得生成报告（更短的停止就是误触，不记账） */
export const REPORT_MIN_MS = 3 * 60_000
/** 同一条警告的冷却：模型每轮都可能说分心，弹窗不能每轮都砸用户脸上 */
export const WARN_COOLDOWN_MS = 60_000
/** 带进上下文的历史轮数上限：更早的轮次从最旧一头剪掉（判定是当下的事，不是累积推理） */
export const MAX_HISTORY_ROUNDS = 40

/** 守卫的一句判定（模型按要求回的 JSON，解析失败为 null） */
export interface GuardVerdict {
  /** 画面里（摄像头）能不能看到学生；只开屏幕时由交互旧程度代理，模型不用答 */
  present: boolean
  /** 屏幕上的内容与学习相关吗（只开摄像头时恒真——看不到屏幕就没有发言权） */
  onTask: boolean
  /** 画面涉及隐私底线（走光 / 私密行为）：真 → 立即熔断 */
  privacy: boolean
  /** 一句话说明（给警告弹窗、报告与守卫页签看） */
  reason: string
}

/** 守卫根据判定要做的动作 */
export type GuardAction = 'none' | 'warn' | 'pause' | 'fuse'

/** 这一轮开了哪些监控（勾选什么就送什么，模型按能看到的调整策略） */
export interface GuardMonitors {
  screen: boolean
  camera: boolean
}

/**
 * 解析模型的一轮回复。约定是**只回一个 JSON**，但现实里模型会裹 fenced code、
 * 会前后加话说——这里把第一个 `{...}` 挖出来解析；解析不动就回 null
 * （调用方把这一轮记成「没看懂」，下一轮重试，绝不瞎动作）。
 *
 * 缺字段的口径：privacy 缺 = 没有风险（不能凭沉默熔断）；
 * present / onTask 缺 = 按好的一边算（沉默不定罪）。
 */
export function parseVerdict(raw: string): GuardVerdict | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  return {
    present: boolOf(data.present, true),
    onTask: boolOf(data.on_task ?? data.onTask, true),
    privacy: boolOf(data.privacy, false),
    reason: typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim() : '',
  }
}

const boolOf = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback

/**
 * 判定 → 动作。优先级 fuse > pause > warn > none，依据见文件头的三条定死。
 * msSinceInput 只在没开摄像头时当「人不在」的代理；null（还没收到过交互）视为不在。
 */
export function decideGuardAction(
  verdict: GuardVerdict,
  monitors: GuardMonitors,
  msSinceInput: number | null,
): GuardAction {
  if (verdict.privacy) return 'fuse'
  const present = monitors.camera ? verdict.present : msSinceInput !== null && msSinceInput < AWAY_INPUT_MS
  if (!present) return 'pause'
  if (monitors.screen && !verdict.onTask) return 'warn'
  return 'none'
}

/* ---------- 系统提示词 ---------- */

/**
 * 守卫的系统提示词。按勾选的监控现算——模型只该被问它看得到的事。
 * 输出契约是**只回一个 JSON**：这一轮的判定要走 parseVerdict，多余的话只会碍事。
 *
 * 写成一份完整的判据手册而不是三五句概述，除了判定质量，还有一个工程上的理由：
 * 它是每一轮请求前缀的**第一段**，服务商的前缀缓存普遍有最低门槛（OpenAI 系
 * 1024 token）——前缀太短，从第一轮起就永远不进缓存。这份手册让纯文本前缀
 * 在第一轮就跨过门槛，命中从第二轮起就能爬起来。
 */
export function guardSystemPrompt(monitors: GuardMonitors): string {
  const sees: string[] = []
  if (monitors.screen) sees.push('学生的屏幕截图（学习应用所在的整块屏幕）')
  if (monitors.camera) sees.push('摄像头画面（学生本人）')
  return [
    '你是一个学习守护者（守卫 agent），在学生开启严格专注模式期间周期性地看一眼画面，判断学习状态。',
    '你每一轮能看到：' + sees.join(' 与 ') + '。',
    '',
    '## 判什么',
    monitors.screen
      ? '屏幕画面：判断内容是否与学习相关。你在看的是整块屏幕——学习应用自己开了什么、旁边还开着什么窗口，都算在判断里。'
      : '你看不到屏幕，不要对「是否在学习」下任何结论。',
    monitors.camera
      ? '摄像头画面：判断是否看得到学生本人（在座位上/镜头里）。看不到人 = 学生离开了（present: false）。'
      : '你看不到学生本人，不要判断「人在不在」。',
    '',
    '## 「在学」的口径（屏幕监控开启时）',
    '算在学：看教材、课件、题目；做题、写作业、写笔记；查资料；上网课或视频课；使用学习类应用或网站；写与学习相关的代码或文档；用 AI 助手讨论学习内容。多个窗口并存时，只要有实质的学习内容在进行就算。',
    '算分心：打游戏、刷短视频、刷社交娱乐、追剧看电影（非课程内容）、购物、与学习无关的闲聊。',
    '拿不准按在学算：误报会打断学习，漏报还有后面每一轮兜着；警告是提醒不是审判。',
    '',
    '## 隐私底线（最高优先级，任何监控组合都适用）',
    '画面里出现以下任何一种，立即 privacy: true，其他字段怎么填都不影响：裸露或走光、更衣、洗浴、如厕、亲密行为、身份证件或银行卡等敏感信息特写。',
    'privacy 为 true 时监控会立即停止、本次专注强制结束，这个动作不可撤回——所以宁可敏感、不可迟疑；但也不要把正常的起身、伸懒腰、喝水算进来。',
    '',
    '## 输出契约',
    '每一轮都只回一个 JSON，不要解释、不要代码块标记：',
    '{"present": 画面里看得到学生吗(布尔), "on_task": 屏幕内容与学习相关吗(布尔), "privacy": 涉及隐私底线吗(布尔), "reason": "一句话说明(30字以内)"}',
  ].join('\n')
}

/* ---------- 专注报告 ---------- */

/** 报告里的一轮监控（只留判定与动作，图像字节不进报告——报告是给人回看的，不是存监控） */
export interface FocusReportRound {
  at: number
  screen: boolean
  camera: boolean
  verdict: GuardVerdict | null
  action: GuardAction
  /** 模型的一句话说明（verdict 为 null 时是错误信息） */
  reason: string
}

/** 一次专注怎么收场的 */
export type FocusOutcome = 'completed' | 'stopped' | 'fused'

/**
 * 一份专注模式报告。正常跑完、开始三分钟后停止、熔断，都会各落一份——
 * 报告是**回看的凭据**：这段时间专注了多久、被警告几次、为什么暂停、为什么熔断。
 */
export interface FocusReport {
  id: string
  startedAt: number
  endedAt: number
  /** 开始时设的参数（与番茄钟会话一致） */
  focusMinutes: number
  groups: number
  /** 这场会跑完的专注段数（从番茄钟 log 里数出来的） */
  completedGroups: number
  monitors: GuardMonitors
  outcome: FocusOutcome
  /** 守卫判离开而暂停的总量与次数（严格专注才有） */
  pausedMs: number
  pauseCount: number
  /** 每次暂停的起止（resumedAt 为 null = 收场时还暂停着） */
  pauseSpans: { at: number; resumedAt: number | null }[]
  warnings: { at: number; reason: string }[]
  fused?: { at: number; reason: string }
  rounds: FocusReportRound[]
  /** 收尾时守卫写的两三句总结（可选；生成失败就没有） */
  summary?: string
}

export function newReportId(now = Date.now()): string {
  return 'f' + now.toString(36) + Math.random().toString(36).slice(2, 6)
}

export interface FocusReportInput {
  startedAt: number
  endedAt: number
  focusMinutes: number
  groups: number
  completedGroups: number
  monitors: GuardMonitors
  outcome: FocusOutcome
  pausedMs: number
  pauseCount: number
  pauseSpans: { at: number; resumedAt: number | null }[]
  warnings: { at: number; reason: string }[]
  fused?: { at: number; reason: string }
  rounds: FocusReportRound[]
  summary?: string
}

export function buildFocusReport(input: FocusReportInput): FocusReport {
  return {
    id: newReportId(input.endedAt),
    startedAt: Math.max(0, Math.round(input.startedAt)),
    endedAt: Math.max(input.startedAt, Math.round(input.endedAt)),
    focusMinutes: input.focusMinutes,
    groups: input.groups,
    completedGroups: Math.max(0, Math.round(input.completedGroups)),
    monitors: { screen: !!input.monitors.screen, camera: !!input.monitors.camera },
    outcome: input.outcome,
    pausedMs: Math.max(0, Math.round(input.pausedMs)),
    pauseCount: Math.max(0, Math.round(input.pauseCount)),
    pauseSpans: input.pauseSpans.filter((s) => typeof s.at === 'number'),
    warnings: input.warnings.filter((w) => typeof w.reason === 'string'),
    ...(input.fused ? { fused: input.fused } : {}),
    rounds: input.rounds.filter((r) => typeof r.at === 'number'),
    ...(input.summary ? { summary: input.summary } : {}),
  }
}

/**
 * 从磁盘读回一份报告。手改过的文件按形状收：坏掉的字段回到默认值，
 * id / 起止时刻对不上的整份不认（调用方当「报告不见了」处理）。
 */
export function normalizeFocusReport(raw: unknown): FocusReport | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && /^f[0-9a-z]+$/i.test(r.id) ? r.id : ''
  const startedAt = numOr(r.startedAt, 0)
  const endedAt = numOr(r.endedAt, 0)
  if (!id || startedAt <= 0 || endedAt < startedAt) return null
  const outcome: FocusOutcome =
    r.outcome === 'completed' || r.outcome === 'stopped' || r.outcome === 'fused' ? r.outcome : 'stopped'
  const monitors = (r.monitors ?? {}) as Record<string, unknown>
  const rounds: FocusReportRound[] = Array.isArray(r.rounds)
    ? r.rounds.flatMap((item: unknown) => {
        if (!item || typeof item !== 'object') return []
        const x = item as Record<string, unknown>
        const v = x.verdict as unknown
        const vo = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
        return [
          {
            at: numOr(x.at, 0),
            screen: !!x.screen,
            camera: !!x.camera,
            verdict: vo
              ? {
                  present: !!vo.present,
                  onTask: !!vo.onTask,
                  privacy: !!vo.privacy,
                  reason: typeof vo.reason === 'string' ? vo.reason : '',
                }
              : null,
            action: (x.action === 'warn' || x.action === 'pause' || x.action === 'fuse' ? x.action : 'none') as GuardAction,
            reason: typeof x.reason === 'string' ? x.reason : '',
          },
        ]
      })
    : []
  return {
    id,
    startedAt,
    endedAt,
    focusMinutes: numOr(r.focusMinutes, 0),
    groups: numOr(r.groups, 0),
    completedGroups: numOr(r.completedGroups, 0),
    monitors: { screen: !!monitors.screen, camera: !!monitors.camera },
    outcome,
    pausedMs: numOr(r.pausedMs, 0),
    pauseCount: numOr(r.pauseCount, 0),
    pauseSpans: Array.isArray(r.pauseSpans)
      ? r.pauseSpans.flatMap((s: unknown) =>
          s && typeof s === 'object' && typeof (s as Record<string, unknown>).at === 'number'
            ? [
                {
                  at: (s as Record<string, unknown>).at as number,
                  resumedAt: typeof (s as Record<string, unknown>).resumedAt === 'number' ? ((s as Record<string, unknown>).resumedAt as number) : null,
                },
              ]
            : [],
        )
      : [],
    warnings: Array.isArray(r.warnings)
      ? r.warnings.flatMap((w: unknown) =>
          w && typeof w === 'object' && typeof (w as Record<string, unknown>).at === 'number'
            ? [{ at: (w as Record<string, unknown>).at as number, reason: String((w as Record<string, unknown>).reason ?? '') }]
            : [],
        )
      : [],
    ...(r.fused && typeof r.fused === 'object'
      ? { fused: { at: numOr((r.fused as Record<string, unknown>).at, 0), reason: String((r.fused as Record<string, unknown>).reason ?? '') } }
      : {}),
    rounds,
    ...(typeof r.summary === 'string' && r.summary ? { summary: r.summary } : {}),
  }
}

const numOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** 报告一行摘要里的时段（MM-DD HH:mm — MM-DD HH:mm），资源管理器与页签共用 */
export function reportSpanLabel(startedAt: number, endedAt: number): string {
  const fmt = (at: number): string => {
    const d = new Date(at)
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return fmt(startedAt) + ' – ' + fmt(endedAt)
}
