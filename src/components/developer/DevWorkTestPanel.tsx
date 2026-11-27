/**
 * 开发者控制台右侧的「内嵌 work 状态」测试面板。
 *
 * 用纯内存 fixture 构造一条带 `[标题](work: id)` 的示例消息，交给正文同一套
 * `splitWorkRefs` 解析，再渲染 `WorkInline`——验证的是消息正文里的真实组件，
 * 不是另写一份预览样式的假组件。不会读取或写入用户数据。
 *
 * 每次点「渲染测试」切换一个样例：运行中 → 已完成 → 出错，覆盖状态、耗时和
 * 第二行动态行；更新 fixture 时组件重新挂载，避免复用上一份状态。
 */
import { useMemo, useState } from 'react'
import { FlaskConical, Play } from 'lucide-react'
import type { WorkSession } from '../../agent/types'
import { splitWorkRefs, type WorkInlineRun, type WorkInlineSource } from '../../lib/workInline'
import { t } from '../../i18n'
import { WorkInline } from '../agent/panel/WorkInline'

type WorkCaseId = 'running' | 'done' | 'error'

const CASE_ORDER: WorkCaseId[] = ['running', 'done', 'error']
const WORK_ID = 'w-dev-work-test'
const WORK_NAME = 'ml-onboarding'

interface WorkCase {
  id: WorkCaseId
  message: string
  source: WorkInlineSource
}

function sessionOf(patch: Partial<WorkSession>): WorkSession {
  return {
    id: WORK_ID,
    name: WORK_NAME,
    roleId: 'tutor',
    roleConversationId: 'c-dev-work-test',
    status: 'idle',
    runs: 0,
    createdAt: 1_000,
    lastActiveAt: 1_000,
    runtimeMs: 0,
    systemPrompt: '',
    messages: [],
    execTrace: [],
    ...patch,
  }
}

function buildCase(id: WorkCaseId): WorkCase {
  const now = Date.now()
  const messageOf = (prefix: string): string => `${prefix}\n\n[${t('机器学习入门')}](work: ${WORK_NAME})`

  if (id === 'running') {
    const session = sessionOf({
      status: 'running',
      runs: 2,
      lastActiveAt: now,
      runningSince: now - 9_000,
      runtimeMs: 12_000,
    })
    const live: WorkInlineRun[] = [
      {
        workId: WORK_ID,
        runId: 'run-dev-work-test',
        ts: now,
        parts: [
          { type: 'thinking', text: '正在梳理第一章的知识点…' },
          {
            type: 'tool',
            id: 'tool-dev-work-test',
            name: 'doc.read',
            args: JSON.stringify({ description: '读取当前学习目标' }),
            result: '',
            ok: true,
            status: 'done',
          },
        ],
      },
    ]
    return {
      id,
      message: messageOf(t('下面这条 work 正在运行：')),
      source: { sessions: [session], live },
    }
  }

  if (id === 'done') {
    const session = sessionOf({
      status: 'idle',
      runs: 3,
      lastActiveAt: now,
      runtimeMs: 73_000,
      messages: [
        {
          id: 'm-dev-work-test',
          role: 'assistant',
          ts: now,
          parts: [{ type: 'text', text: '本轮已完成：已整理好「什么是过拟合」。' }],
        },
      ],
    })
    return {
      id,
      message: messageOf(t('下面这条 work 已完成：')),
      source: { sessions: [session], live: [] },
    }
  }

  const session = sessionOf({
    status: 'error',
    runs: 2,
    lastActiveAt: now,
    runtimeMs: 44_000,
    lastIssue: '工具执行失败：doc.write 写入超时',
  })
  return {
    id,
    message: messageOf(t('下面这条 work 执行出错：')),
    source: { sessions: [session], live: [] },
  }
}

function statusText(id: WorkCaseId): string {
  if (id === 'running') return t('运行中')
  if (id === 'done') return t('已完成')
  return t('出错')
}

export function DevWorkTestPanel() {
  const [caseId, setCaseId] = useState<WorkCaseId | null>(null)
  const [testSeq, setTestSeq] = useState(0)
  const current = useMemo(
    () => (caseId ? buildCase(caseId) : null),
    // testSeq 只用于强制重建样例：同一个状态再次点开时也拿到新的 runningSince
    [caseId, testSeq],
  )
  const segments = useMemo(() => (current ? splitWorkRefs(current.message) : []), [current])

  const runTest = (): void => {
    const nextIndex = caseId ? (CASE_ORDER.indexOf(caseId) + 1) % CASE_ORDER.length : 0
    setCaseId(CASE_ORDER[nextIndex] ?? 'running')
    setTestSeq((n) => n + 1)
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-white/[0.07] bg-[#0d1219] lg:w-[340px]">
      <div className="shrink-0 border-b border-white/[0.07] px-3.5 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-[#161d27] text-[#56d4dd]">
            <FlaskConical size={13} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[#e6edf3]">{t('组件测试')}</div>
            <p className="mt-0.5 text-[10.5px] leading-[1.5] text-[#7d8590]">
              {t('验证消息正文里的 work 状态块能否正常渲染。')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={runTest}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#39c5cf]/30 bg-[#39c5cf]/10 px-3 py-1.5 text-[11.5px] font-medium text-[#7ee7ee] transition hover:border-[#39c5cf]/50 hover:bg-[#39c5cf]/15"
        >
          <Play size={12} />
          {t('渲染测试')}
        </button>

        <p className="mt-2 text-[10px] leading-[1.5] text-[#58606b]">
          {t('每次点击切换一个样例：运行中 → 已完成 → 出错。')}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        {!current ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-[#7d8590]">
            <FlaskConical size={22} className="text-[#39c5cf]/60" />
            <div className="text-[11.5px]">{t('尚未渲染')}</div>
            <div className="text-[10.5px] leading-[1.6] text-[#58606b]">
              {t('点击「渲染测试」在消息气泡里渲染一条 work 引用。')}
            </div>
          </div>
        ) : (
          <div data-dev-work-preview={current.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#7d8590]">
                {t('示例消息')}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#161d27] px-2 py-0.5 text-[10px] text-[#aab4c0]">
                <span
                  className={
                    'h-1.5 w-1.5 rounded-full ' +
                    (current.id === 'running'
                      ? 'animate-pulse bg-[#39c5cf]'
                      : current.id === 'done'
                        ? 'bg-[#3fb950]'
                        : 'bg-[#f85149]')
                  }
                />
                {statusText(current.id)}
              </span>
            </div>

            <div className="rounded-lg border border-white/[0.08] bg-[#151a22] p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] text-[#7d8590]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#39c5cf]/10 text-[#56d4dd]">
                  导
                </span>
                <span>{t('导师龟')}</span>
              </div>

              <div className="space-y-1.5 text-[12px] leading-[1.65] text-[#c9d1d9]">
                {segments.map((segment, i) =>
                  segment.type === 'work' ? (
                    <WorkInline
                      key={`${testSeq}:${i}:${segment.workRef}`}
                      title={segment.title}
                      workRef={segment.workRef}
                      source={current.source}
                    />
                  ) : segment.text.trim() ? (
                    <div key={`${testSeq}:text:${i}`} className="whitespace-pre-wrap">
                      {segment.text}
                    </div>
                  ) : null,
                )}
              </div>
            </div>

            <p className="mt-2.5 text-[10px] leading-[1.6] text-[#58606b]">
              {t('这是一条纯内存样例，不读取或写入用户数据。')}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
