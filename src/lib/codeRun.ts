/**
 * 跑一段「伪编译产物」：宿主这一半。
 *
 * 沙箱是 src/run/RunnerRuntime.js 里那份纯 JS（塞进 Blob 交给 Worker，与 agent 的
 * 沙箱同一套路数）。这里负责三件事：
 *
 * 1. **起与停**：起一个一次性的 Worker，跑完就 terminate。终止不是可选项——
 *    产物是模型写的，里面完全可能有一句 while(true)。死循环连 Worker 自己的定时器
 *    都跑不到，只有宿主这边 terminate() 收得掉。
 * 2. **输出**：Worker 那边把 console 的每一行抛过来，这里按顺序攒起来，
 *    既回调给界面（边跑边显示），也作为本次运行的最终结果返回。
 * 3. **联网**：这是沙箱唯一一条对外通道，也是**每次运行都要过的闸**。
 *    Worker 想联网时先举手（net-ask），由这里问用户；用户同意才把请求转给主进程
 *    （渲染层的 CSP 连不上外网，见 electron/runner.ts）。同意一次，本次运行内
 *    后续请求一并放行——「每次运行确认一次」，而不是每个请求都弹一次框。
 */
import runtimeSource from '../run/RunnerRuntime.js?raw'
import { t } from '../i18n'
import { native } from './native'

export type RunLevel = 'log' | 'info' | 'warn' | 'error' | 'return' | 'sys'

export interface RunLine {
  level: RunLevel
  text: string
}

export interface RunOutcome {
  ok: boolean
  /** 实际跑了多久（毫秒） */
  ms: number
  lines: RunLine[]
  /** 失败时的一句话 */
  error?: string
  /** 这次运行的联网情况：没联网 / 用户放行过 / 用户拒绝过 */
  net: 'none' | 'granted' | 'denied'
}

export interface RunOptions {
  /** 墙钟上限（默认 15 秒）。到点直接 terminate，不留情面 */
  timeoutMs?: number
  /** 每来一行输出回调一次（界面边跑边显示） */
  onLine?: (line: RunLine) => void
  /**
   * 代码要联网时问一句。返回 true = 本次运行放行。
   * 不传就等于「一律不许」——默认必须是拒绝的那个方向。
   */
  askNetwork?: (url: string) => Promise<boolean>
  signal?: AbortSignal
}

/** 默认墙钟上限 */
const DEFAULT_TIMEOUT_MS = 15_000

/** 宿主侧的兜底上限：Worker 那边有自己的 20 万字符闸，这里再拦一道，防的是坏掉的消息流 */
const MAX_LINES = 2000
const MAX_CHARS = 400_000

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function runCompiledJs(code: string, opts: RunOptions = {}): Promise<RunOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const lines: RunLine[] = []
  let chars = 0
  let net: RunOutcome['net'] = 'none'
  const started = Date.now()

  const push = (level: RunLevel, text: string): void => {
    const line: RunLine = { level, text }
    lines.push(line)
    chars += text.length
    opts.onLine?.(line)
  }

  const box = createWorker()
  if (!box) {
    return {
      ok: false,
      ms: 0,
      lines: [{ level: 'error', text: t('沙箱起不来：页面不允许创建 Worker（worker-src 被 CSP 限制）') }],
      error: t('沙箱起不来'),
      net: 'none',
    }
  }

  const { worker, url } = box
  return await new Promise<RunOutcome>((resolve) => {
    let settled = false
    const finish = (ok: boolean, error?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      opts.signal?.removeEventListener('abort', onAbort)
      try {
        worker.terminate()
      } catch {
        // 已经死了，无所谓
      }
      // 临时地址到这时才撤：建 Worker 的那一帧撤销**有可能**让脚本还没取到就被掐掉，
      // 而这类失败只在打包版里偶发（现象是「点运行没反应」），不值得去赌那一帧
      URL.revokeObjectURL(url)
      resolve({ ok, ms: Date.now() - started, lines, ...(error ? { error } : {}), net })
    }

    /** 硬闸：Worker 里的定时器管不到死循环，只有这一刀收得掉 */
    const deadline = setTimeout(() => {
      push('error', t('运行超时（{0} 秒），已强制停止', Math.round(timeoutMs / 1000)))
      // 不用「超时」这个短键作错误串：它已被别处登记成赛程含义的 Overtime
      finish(false, t('运行超时'))
    }, timeoutMs + 2000)

    const onAbort = (): void => {
      push('sys', t('已停止'))
      finish(false, t('已停止'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    worker.onerror = (event) => {
      push('error', event.message || t('沙箱内部错误'))
      finish(false, event.message || t('沙箱内部错误'))
    }

    worker.onmessage = (event: MessageEvent) => {
      const msg = (event.data ?? {}) as Record<string, unknown>
      if (msg.kind === 'out') {
        if (lines.length >= MAX_LINES || chars >= MAX_CHARS) return
        push((msg.level as RunLevel) ?? 'log', String(msg.text ?? ''))
        return
      }
      if (msg.kind === 'net-ask') {
        void (async () => {
          const url = String(msg.url ?? '')
          const allowed = opts.askNetwork ? await opts.askNetwork(url).catch(() => false) : false
          if (allowed) net = 'granted'
          else net = 'denied'
          worker.postMessage({ kind: 'net-ask-reply', id: msg.id, ok: allowed })
        })()
        return
      }
      if (msg.kind === 'net') {
        void (async () => {
          try {
            const init = (msg.init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string }
            const res = await native().runner.fetch(String(msg.url ?? ''), init)
            // init 里那些 undefined 字段过不了结构化克隆，回之前先摘干净
            worker.postMessage({
              kind: 'net-reply',
              id: msg.id,
              ok: res.ok,
              ...(res.ok
                ? { status: res.status, statusText: res.statusText, headers: res.headers, body: res.body }
                : { error: res.error }),
            })
          } catch (err) {
            worker.postMessage({ kind: 'net-reply', id: msg.id, ok: false, error: t('请求发不出去：{0}', errText(err)) })
          }
        })()
        return
      }
      if (msg.kind === 'done') {
        finish(msg.ok === true, typeof msg.error === 'string' ? msg.error : undefined)
      }
    }

    worker.postMessage({ kind: 'run', code, timeoutMs })
  })
}

/**
 * 起沙箱。返回 null = 起不来（CSP 拦了 blob: Worker，或者这个环境根本没有 Worker）。
 * 起不来这件事必须当场说清楚：它只在打包版里才会出现，而现象是「点运行没反应」。
 *
 * 临时地址连着 Worker 一起交出去，由调用方在收摊时撤销——**不在这里撤**：
 * 建完就 revoke 有可能让脚本还没取到就被掐掉（见 finish 里的说明）。
 */
function createWorker(): { worker: Worker; url: string } | null {
  try {
    const url = URL.createObjectURL(new Blob([runtimeSource], { type: 'text/javascript' }))
    return { worker: new Worker(url), url }
  } catch (err) {
    console.warn('[coderun] 沙箱创建失败', err)
    return null
  }
}
