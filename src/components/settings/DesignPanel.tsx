/**
 * 设置 → 设计（原「文档设计」）。
 *
 * 左栏是四个资源库的列表（文档组件 / 课堂组件 / 课堂动效 / 课堂音效），右栏是
 * 选中项的详情与实时预览。外部资源全部是 `doc-design/*.tsx`，用应用自己的文件页签
 * （SourceEditor）打开编辑；本页不提供任何独立源码弹窗。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Copy,
  FileCode2,
  FileText,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import {
  createDocumentComponentFile,
  deleteDocumentComponent,
  onDocumentComponentsChange,
  renderComponentPreview,
} from '../../lib/componentBlock'
import {
  createClassroomAnimationFile,
  createClassroomComponentFile,
  createClassroomSoundFile,
  subscribeClassroomRegistry,
  unregisterClassroomAnimation,
  unregisterClassroomComponent,
  unregisterClassroomSound,
} from '../../learn/classroom/registry'
import { playSfx } from '../../learn/classroom/sfx/sfxEngine'
import ClassroomComponentPreview from '../learn/classroom/ClassroomComponentPreview'
import { native } from '../../lib/native'
import type { DesignPreviewStatus } from '../../../shared/ipc'
import { t } from '../../i18n'
import {
  buildDesignItems,
  designKindLabel,
  designKindShort,
  type DesignItem,
  type DesignKind,
} from './design/designCatalog'

interface Props {
  onToast: (msg: string) => void
  /** 用应用文件页签打开 doc-design 下的 TSX；参数是相对用户目录的路径 */
  onOpenFile?: (rel: string, title?: string) => void
}

const KIND_TABS: Array<{ kind: DesignKind; icon: typeof FileText }> = [
  { kind: 'doc', icon: FileText },
  { kind: 'classroom-component', icon: LayoutGrid },
  { kind: 'classroom-animation', icon: Sparkles },
  { kind: 'classroom-sound', icon: Volume2 },
]

function fileNameOf(rel?: string): string {
  return rel ? rel.split('/').pop() || rel : ''
}

export function DesignPanel({ onToast, onOpenFile }: Props) {
  const [kind, setKind] = useState<DesignKind>('doc')
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [copied, setCopied] = useState(false)
  const [animateKey, setAnimateKey] = useState(0)
  const [previewStatus, setPreviewStatus] = useState<DesignPreviewStatus | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  const items = useMemo(() => buildDesignItems(kind, query), [kind, query, revision])
  const selected = items.find((item) => item.id === selectedId) ?? items[0]

  useEffect(() => {
    const offDoc = onDocumentComponentsChange(() => setRevision((v) => v + 1))
    const offClassroom = subscribeClassroomRegistry(() => setRevision((v) => v + 1))
    return () => {
      offDoc()
      offClassroom()
    }
  }, [])

  useEffect(() => {
    if (items.length === 0) {
      if (selectedId) setSelectedId('')
      return
    }
    if (!items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id)
    }
  }, [items, selectedId])

  const reloadPreviewStatus = useCallback(async () => {
    try {
      const status = await native().designPreview.status()
      setPreviewStatus(status)
    } catch (err) {
      setPreviewStatus({
        running: false,
        port: 0,
        url: '',
        fileCount: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  useEffect(() => {
    void reloadPreviewStatus()
    const timer = window.setInterval(() => {
      void reloadPreviewStatus()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [reloadPreviewStatus])

  const switchKind = (next: DesignKind) => {
    setKind(next)
    setQuery('')
    setSelectedId('')
    setCopied(false)
  }

  const createItem = async () => {
    const result =
      kind === 'doc'
        ? await createDocumentComponentFile()
        : kind === 'classroom-component'
          ? await createClassroomComponentFile()
          : kind === 'classroom-animation'
            ? await createClassroomAnimationFile()
            : await createClassroomSoundFile()
    if (!result.ok) {
      const failed = result as { error?: string; message?: string }
      const message = failed.error || failed.message
      onToast(message || t('新建失败'))
      return
    }
    const file = result.file
    onToast(t('已创建 {name}，正在用文件页签打开', fileNameOf(file) || t('新文件')))
    setRevision((v) => v + 1)
    if (file) {
      if (onOpenFile) onOpenFile(file, fileNameOf(file))
      else onToast(t('文件已创建；当前页面没有文件页签入口'))
    } else {
      onToast(t('文件已创建'))
    }
  }

  const openSource = () => {
    if (!selected?.file) return
    if (onOpenFile) onOpenFile(selected.file, fileNameOf(selected.file))
    else onToast(t('当前页面没有文件页签入口'))
  }

  const removeItem = async () => {
    if (!selected || selected.source !== 'external' || !selected.file) return
    if (!window.confirm(t('删除 {name}？对应 TSX 文件会一起删除。', selected.name))) return
    const ok =
      selected.kind === 'doc'
        ? await deleteDocumentComponent(selected.id).then((r: { ok: boolean }) => r.ok)
        : selected.kind === 'classroom-component'
          ? await unregisterClassroomComponent(selected.id)
          : selected.kind === 'classroom-animation'
            ? await unregisterClassroomAnimation(selected.id)
            : await unregisterClassroomSound(selected.id)
    if (!ok) {
      onToast(t('删除失败'))
      return
    }
    onToast(t('已删除 {name}', selected.name))
    setSelectedId('')
    setRevision((v) => v + 1)
  }

  const copyExample = async () => {
    if (!selected?.example) return
    try {
      await navigator.clipboard.writeText(`\`\`\`component\n${selected.example}\n\`\`\``)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      onToast(t('复制失败，请手动选择文本'))
    }
  }

  const ensurePreview = async () => {
    setPreviewBusy(true)
    try {
      setPreviewStatus(await native().designPreview.ensure())
    } finally {
      setPreviewBusy(false)
    }
  }

  const openPreviewPage = async () => {
    const url = previewStatus?.url
    if (!url) return
    await native().shell.openExternal(url)
  }

  const externals = items.filter((item) => item.source === 'external')
  const builtins = items.filter((item) => item.source === 'builtin')

  return (
    <div className="flex h-full min-h-0 w-full" data-design-panel>
      <aside className="flex w-[292px] shrink-0 flex-col border-r border-line/60 bg-paper-deep/20">
        <div className="shrink-0 border-b border-line/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <LayersMark />
              <h2 className="truncate text-[13px] font-semibold text-ink-strong">{t('设计资源')}</h2>
            </div>
            <button
              type="button"
              onClick={() => void createItem()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-seal px-2 py-1.5 text-[11px] font-medium text-white transition hover:opacity-90"
            >
              <Plus className="h-3 w-3" />
              {t('新建')}
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {KIND_TABS.map(({ kind: k, icon: Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition ${
                  kind === k
                    ? 'border-seal/40 bg-seal/10 text-ink-strong'
                    : 'border-line/50 bg-paper/40 text-ink-soft hover:border-line hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{designKindShort(k)}</span>
              </button>
            ))}
          </div>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索名称、标签或文件…')}
              className="w-full rounded-md border border-line/70 bg-paper py-1.5 pl-8 pr-2 text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {externals.length > 0 && (
            <LibraryGroup
              title={t('外部 · 可编辑')}
              items={externals}
              selectedId={selected?.id ?? ''}
              onSelect={setSelectedId}
            />
          )}
          {builtins.length > 0 && (
            <LibraryGroup
              title={t('内置 · 只读')}
              items={builtins}
              selectedId={selected?.id ?? ''}
              onSelect={setSelectedId}
            />
          )}
          {items.length === 0 && (
            <div className="px-2 py-6 text-center text-[11.5px] leading-relaxed text-ink-faint">
              {query ? t('没有匹配的资源') : t('这个分类还没有外部文件，点「新建」生成一个 TSX 模板。')}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line/60 px-3 py-2.5 text-[10.5px]">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${previewStatus?.running ? 'bg-emerald-500' : 'bg-ink-faint'}`}
            />
            <span className="truncate text-ink-soft">
              {previewStatus?.running
                ? t('预览服务 · {0} 个外部文件', String(previewStatus.fileCount))
                : t('预览服务未运行')}
            </span>
            <button
              type="button"
              onClick={() => void reloadPreviewStatus()}
              className="ml-auto rounded p-1 text-ink-faint hover:text-ink"
              title={t('刷新状态')}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          {previewStatus?.running ? (
            <button
              type="button"
              onClick={() => void openPreviewPage()}
              className="mt-1.5 block w-full truncate text-left font-mono text-[10px] text-seal/90 hover:underline"
            >
              {previewStatus.url}
            </button>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ink-faint" title={previewStatus?.error}>
                {previewStatus?.error || t('端口网页未启动')}
              </span>
              <button
                type="button"
                disabled={previewBusy}
                onClick={() => void ensurePreview()}
                className="shrink-0 rounded border border-line/60 px-1.5 py-1 text-[10px] text-ink-soft hover:text-ink disabled:opacity-50"
              >
                {previewBusy ? t('启动中…') : t('启动')}
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line/60 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-[16px] font-semibold text-ink-strong">{selected.name}</h1>
                  <span className="rounded border border-line/60 bg-paper-deep/40 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                    {selected.tag}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      selected.source === 'external'
                        ? 'bg-seal/10 text-seal'
                        : 'bg-line/30 text-ink-faint'
                    }`}
                  >
                    {selected.source === 'external' ? t('外部 TSX') : t('内置只读')}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-ink-soft">{selected.description}</div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {selected.file && (
                  <button
                    type="button"
                    onClick={openSource}
                    className="inline-flex items-center gap-1.5 rounded-md border border-seal/40 bg-seal/5 px-2.5 py-1.5 text-[11px] font-medium text-seal transition hover:bg-seal/10"
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    {t('打开 TSX')}
                  </button>
                )}
                {selected.example && (
                  <button
                    type="button"
                    onClick={() => void copyExample()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line/60 px-2 py-1.5 text-[11px] text-ink-soft transition hover:text-ink"
                  >
                    {copied ? <CheckMark /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? t('已复制') : t('复制示例')}
                  </button>
                )}
                {selected.source === 'external' && (
                  <button
                    type="button"
                    onClick={() => void removeItem()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line/60 px-2 py-1.5 text-[11px] text-ink-faint transition hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('删除')}
                  </button>
                )}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="px-5 pt-4">
                <section className="overflow-hidden rounded-xl border border-line/70 bg-paper">
                  <div className="flex items-center justify-between gap-2 border-b border-line/60 bg-paper-deep/30 px-4 py-2">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-ink-soft">
                      <Sparkles className="h-3.5 w-3.5 text-seal/80" />
                      {t('组件预览')}
                    </div>
                    {selected.kind === 'classroom-animation' && (
                      <button
                        type="button"
                        onClick={() => setAnimateKey((v) => v + 1)}
                        className="rounded border border-line/60 px-2 py-1 text-[10.5px] text-ink-soft hover:text-ink"
                      >
                        {t('播放动效')}
                      </button>
                    )}
                    {selected.kind === 'classroom-sound' && (
                      <button
                        type="button"
                        onClick={() => playSfx(selected.id, { force: true })}
                        className="inline-flex items-center gap-1 rounded border border-line/60 px-2 py-1 text-[10.5px] text-ink-soft hover:text-ink"
                      >
                        <Volume2 className="h-3 w-3" />
                        {t('播放音效')}
                      </button>
                    )}
                  </div>
                  <div className="min-h-[220px] bg-[radial-gradient(circle_at_1px_1px,rgba(120,105,85,.08)_1px,transparent_0)] bg-[length:14px_14px] p-5">
                    <DesignPreview item={selected} animateKey={animateKey} />
                  </div>
                </section>
              </div>

              <div className="grid gap-4 px-5 py-5 xl:grid-cols-2">
                <section className="rounded-lg border border-line/60 bg-paper-deep/20 p-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    {t('详细信息')}
                  </h3>
                  <dl className="mt-3 space-y-2 text-[11.5px]">
                    <DetailRow label={t('类型')} value={designKindLabel(selected.kind)} />
                    <DetailRow label={t('标签')} value={selected.tag} mono />
                    {selected.file && <DetailRow label={t('文件')} value={selected.file} mono />}
                    <DetailRow
                      label={t('来源')}
                      value={selected.source === 'external' ? t('用户外部文件') : t('应用内置')}
                    />
                    {selected.doc?.slots && selected.doc.slots.length > 0 && (
                      <div className="pt-1">
                        <dt className="text-ink-faint">{t('插槽')}</dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {selected.doc.slots.map((slot) => (
                            <span key={slot.name} className="rounded bg-line/20 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft" title={slot.description}>
                              #{slot.name}
                            </span>
                          ))}
                        </dd>
                      </div>
                    )}
                    {selected.doc?.attrs && selected.doc.attrs.length > 0 && (
                      <div className="pt-1">
                        <dt className="text-ink-faint">{t('属性')}</dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {selected.doc.attrs.map((attr) => (
                            <span key={attr.name} className="rounded bg-line/20 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft" title={attr.description}>
                              {attr.name}
                            </span>
                          ))}
                        </dd>
                      </div>
                    )}
                    {selected.component?.defaultProps && (
                      <div className="pt-1">
                        <dt className="text-ink-faint">{t('默认属性')}</dt>
                        <dd className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                          {Object.entries(selected.component.defaultProps)
                            .map(([key, value]) => `${key}=${value}`)
                            .join(' · ')}
                        </dd>
                      </div>
                    )}
                    {selected.animation && (
                      <>
                        <DetailRow label={t('时长')} value={`${selected.animation.duration ?? 600} ms`} />
                        <DetailRow label={t('缓动')} value={selected.animation.easing || 'easeOutCubic'} mono />
                      </>
                    )}
                    {selected.sound && (
                      <>
                        <DetailRow label={t('情绪')} value={selected.sound.mood || '—'} />
                        <DetailRow label={t('用途')} value={selected.sound.use || '—'} />
                      </>
                    )}
                  </dl>
                </section>

                <section className="rounded-lg border border-line/60 bg-paper-deep/20 p-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    {t('使用示例')}
                  </h3>
                  {selected.example ? (
                    <pre className="mt-2 max-h-[210px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line/50 bg-paper p-3 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                      {`\`\`\`component\n${selected.example}\n\`\`\``}
                    </pre>
                  ) : selected.animation ? (
                    <pre className="mt-2 max-h-[210px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line/50 bg-paper p-3 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                      {JSON.stringify(selected.animation.keyframes ?? {}, null, 2)}
                    </pre>
                  ) : (
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                      {t('把这个音效名写进 data-sfx 或 params.sfx 即可。')}
                    </p>
                  )}
                </section>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <LayersMark large />
            <p className="text-[13px] font-medium text-ink-soft">{t('还没有可管理的设计资源')}</p>
            <button
              type="button"
              onClick={() => void createItem()}
              className="mt-1 rounded-md bg-seal px-3 py-1.5 text-[11.5px] font-medium text-white"
            >
              {t('新建一个 {kind}', designKindLabel(kind))}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function LibraryGroup({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string
  items: DesignItem[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1.5 text-[10px] font-medium tracking-[0.08em] text-ink-faint">{title}</div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={`mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition ${
            selectedId === item.id ? 'bg-seal/10 text-ink-strong' : 'text-ink-soft hover:bg-line/10 hover:text-ink'
          }`}
        >
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.source === 'external' ? 'bg-seal/80' : 'bg-ink-faint/50'}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-medium">{item.name}</span>
            <span className="mt-0.5 block truncate font-mono text-[9.5px] text-ink-faint">{item.tag}</span>
          </span>
          {item.source === 'external' && <FileCode2 className="mt-1 h-3 w-3 shrink-0 text-ink-faint" />}
        </button>
      ))}
    </div>
  )
}

function DesignPreview({ item, animateKey }: { item: DesignItem; animateKey: number }) {
  if (item.kind === 'doc') {
    return (
      <div
        className="text-[13px] leading-relaxed text-ink"
        dangerouslySetInnerHTML={{ __html: renderComponentPreview(item.example) }}
      />
    )
  }
  if (item.kind === 'classroom-component' || item.kind === 'classroom-animation') {
    return (
      <ClassroomComponentPreview
        html={item.example}
        mode="stage"
        theme="dark"
        interactive
        targetAnim={item.kind === 'classroom-animation' ? item.tag : undefined}
        animateKey={animateKey}
        className="min-h-[190px]"
      />
    )
  }
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-seal/10 text-seal">
        <Volume2 className="h-5 w-5" />
      </span>
      <div>
        <div className="text-[14px] font-semibold text-ink-strong">{item.name}</div>
        <div className="mt-1 font-mono text-[10.5px] text-ink-faint">{item.tag}</div>
      </div>
      <button
        type="button"
        onClick={() => playSfx(item.id, { force: true })}
        className="rounded-md border border-line/60 px-3 py-1.5 text-[11px] text-ink-soft hover:text-ink"
      >
        播放音效
      </button>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-14 shrink-0 text-ink-faint">{label}</dt>
      <dd className={`min-w-0 flex-1 break-words text-ink-soft ${mono ? 'font-mono text-[10.5px]' : ''}`}>{value}</dd>
    </div>
  )
}

function LayersMark({ large }: { large?: boolean }) {
  return (
    <span
      className={`flex items-center justify-center rounded-md bg-seal/10 text-seal ${
        large ? 'h-9 w-9' : 'h-6 w-6'
      }`}
    >
      <LayoutGrid className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
    </span>
  )
}

function CheckMark() {
  return <span className="text-[11px]">✓</span>
}
