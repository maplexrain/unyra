/**
 * 消息底部的交付组件：这一轮改了什么文件（本轮交付）、引用了哪些来源（参考来源）。
 *
 * 为什么是两块、而不是一块「本轮交付 · N 个文件 · N 条参考」：来源不是交付物。
 * 把网页引证算进「交付」会让这一栏在纯问答里也出现，且语义混乱——所以文件与来源
 * 分区展示，中间用一条细线隔开；只有来源时整块只显示「参考来源」。
 *
 * 为什么单独做成一块、而不是让模型在正文里复述：正文写法每次都不同，界面没法统一
 * 展示，也没法随会话留下来。数据由 api.delivery.submit 登记（见 agent/delivery）。
 *
 * 视觉上刻意压得很轻：它是收尾的账本，不是正文的一部分——一条记录只占一行，超长一律
 * 省略（完整内容在 title 里）；没有交付也没有来源就整块不渲染。
 */
import { memo } from 'react'
import { FilePenLine, FilePlus2, FileX2, Link2, PackageCheck } from 'lucide-react'
import { hasDelivery, type DeliveryAction, type DeliveryFile, type DeliveryRecord } from '../../../agent/delivery'
import { openChipRef } from '../../../lib/docChip'
import { openWebLink } from '../../../lib/externalLink'
import { t, useLocale } from '../../../i18n'

/** 行首的小图标：一眼分清新增 / 修改 / 删除 */
function ActionIcon({ action }: { action: DeliveryAction }) {
  if (action === 'created') return <FilePlus2 size={11} className="shrink-0 text-ok-deep" />
  if (action === 'deleted') return <FileX2 size={11} className="shrink-0 text-danger" />
  return <FilePenLine size={11} className="shrink-0 text-ink-faint" />
}

const actionLabel = (action: DeliveryAction): string =>
  action === 'created' ? t('新增') : action === 'deleted' ? t('删除') : t('修改')

/** 来源行右端挂个域名，比整条 URL 好认，也不会把标题挤没 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * 点开一条交付记录。
 *
 * 交付物的落点分类：
 * 1. 磁盘绝对路径：交给本地文件打开器（onOpenFile）。
 * 2. 试卷/考试记录：打开 attempt 副本。
 * 3. 工作区文件（代码工程、源码、资源、配置等）：
 *    - 含有 workspace/，或带代码/数据等物理扩展名（非纯节点标题）
 *    - 走 openChipRef({ type: 'ws' }) 打开内部文件页签，支持代码高亮与工程定位。
 * 4. 普通节点文档（如「微积分/极限」或「鹈鹕骑自行车 · 3D 动画工程」）：
 *    - 走 openChipRef({ type: 'doc' }) 打开节点的教学文档。
 */
const DOC_KIND_SUFFIX = /\/(教学|讲义|笔记|大纲|试卷|考试|试卷记录|作答记录)$/

function openDelivered(
  file: DeliveryFile,
  fallbackGoalId?: string,
  onOpenFile?: (pathOrRel: string, title?: string) => void,
) {
  const p = file.path.replace(/\\/g, '/').trim()
  if (!p) return
  const goalId = file.goalId || fallbackGoalId

  // 1. 磁盘绝对路径：交给本地文件打开器
  const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(p)
  if (isAbs) {
    onOpenFile?.(p, file.note || p.split('/').pop())
    return
  }

  // 2. 试卷/考试记录
  const isExam = /\/(试卷|考试|试卷记录|作答记录)$/.test(p)
  if (isExam) {
    openChipRef({ type: 'attempt', path: p.replace(DOC_KIND_SUFFIX, ''), goalId })
    return
  }

  // 3. 工作区文件（代码工程、资源、配置文件等）：
  // 包含 workspace/ 段，或者带有代码/数据等非 md 物理扩展名，或路径中带有多级目录的代码文件
  const last = p.split('/').pop() ?? ''
  const extMatch = last.match(/\.([a-z0-9]{1,8})$/i)
  const ext = extMatch ? extMatch[1].toLowerCase() : ''
  const isWorkspace = /(^|\/)workspace(\/|$)/i.test(p) || (ext !== '' && ext !== 'md')

  if (isWorkspace) {
    openChipRef({
      type: 'ws',
      path: p,
      goalId,
      nodeId: file.nodeId,
      title: file.note || last,
    })
    return
  }

  // 4. 普通节点文档：剥除可能由模型附加的 .md 后缀或 /教学 等类型词
  if (file.nodeId) {
    openChipRef({ type: 'doc', nodeId: file.nodeId, path: p, goalId })
    return
  }

  const cleanDocPath = p.replace(/\.md$/i, '').replace(DOC_KIND_SUFFIX, '').trim()
  openChipRef({ type: 'doc', path: cleanDocPath, goalId })
}

export const DeliveryBlock = memo(function DeliveryBlock({
  delivery,
  onOpenFile,
  goalId,
}: {
  delivery: DeliveryRecord
  onOpenFile?: (pathOrRel: string, title?: string) => void
  goalId?: string
}) {
  // memo 挡住了父组件的重渲染：语言切换要自己订阅
  useLocale()
  if (!hasDelivery(delivery)) return null

  const hasFiles = delivery.files.length > 0
  const hasSources = delivery.sources.length > 0

  return (
    <div className="mt-2 rounded-lg border border-line/70 bg-card/40 px-2.5 py-2">
      {hasFiles && (
        <section>
          <div className="flex items-center gap-1.5 text-[12px] font-medium leading-5 text-ink-soft">
            <PackageCheck size={12} className="shrink-0 text-seal" />
            <span>{t('本轮交付')}</span>
            <span className="text-[11px] font-normal tabular-nums text-ink-faint">
              · {t('{0} 个文件', String(delivery.files.length))}
            </span>
          </div>
          <ul>
            {delivery.files.map((f) => (
              <li key={'f:' + f.path} className="flex min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => openDelivered(f, goalId, onOpenFile)}
                  title={f.path}
                  aria-label={`${actionLabel(f.action)}：${f.path}`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11.5px] leading-5 text-ink-soft transition hover:text-ink"
                >
                  <ActionIcon action={f.action} />
                  <span className="min-w-0 flex-1 truncate">{f.path}</span>
                  {f.note && (
                    <span className="max-w-[45%] min-w-0 shrink-0 truncate text-ink-faint" title={f.note}>
                      {f.note}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasFiles && hasSources && <div className="my-1.5 border-t border-line/60" />}

      {hasSources && (
        <section>
          <div className="flex items-center gap-1.5 text-[12px] font-medium leading-5 text-ink-soft">
            <Link2 size={12} className="shrink-0 text-ink-faint" />
            <span>{t('参考来源')}</span>
          </div>
          <ul>
            {delivery.sources.map((s) => (
              <li key={'s:' + s.url} className="flex min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => openWebLink(s.url)}
                  title={s.url}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11.5px] leading-5 text-ink-soft transition hover:text-ink"
                >
                  <span className="min-w-0 flex-1 truncate underline underline-offset-2">
                    {s.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-faint">{hostOf(s.url)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
})
