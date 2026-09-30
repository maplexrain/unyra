import { useEffect, useState } from 'react'
import { Check, Download, FileCode, FileText, FolderOpen, Loader2, Printer, X } from 'lucide-react'
import {
  EXPORT_FORMATS,
  exportFileName,
  type ExportFormat,
  type ExportPageSize,
  type ExportTheme,
} from '../../lib/exportDoc'
import ModalScrim from '../ModalScrim'
import { pane } from '../Pane'
import Switch from '../Switch'
import { t } from '../../i18n'

/**
 * 导出文档：Ctrl+E 打开（也在页签栏右侧那颗按钮上）。
 *
 * 与学习状态、试卷那两块 tip 不同，这是一个**模态弹窗**：导出一件事做完就完，
 * 不需要留在屏幕上，也不需要拖动摆放。做完之后弹窗不自己关——把落盘路径留在原地，
 * 顺手给一个「在文件夹中显示」，比关掉再弹一条吐司更有用（吐司几秒就没了，路径记不住）。
 *
 * 这里不认识 store，也不认识磁盘：源文怎么读、文件怎么写全在 onExport 里
 * （见 LearnWorkspace 的 runExport）。因此这个组件可以单独看。
 */

export interface ExportOptions {
  format: ExportFormat
  theme: ExportTheme
  /** 附上用户的注解（只有「有注解的节点文档」才给这个开关） */
  annotations: boolean
  /** 把资源图片内嵌成 data URL */
  embedImages: boolean
  pageSize: ExportPageSize
  /** PDF 页脚打页码 */
  pageNumbers: boolean
  /** PDF 横向 */
  landscape: boolean
}

export interface ExportResult {
  ok: boolean
  /** 用户在原生对话框里点了取消：不算失败，什么都不必说 */
  canceled?: boolean
  path?: string
  error?: string
}

interface Props {
  /** 要导出的那份文档的标题（也是建议文件名） */
  title: string
  /** 页头标题下面那行元信息（节点路径、文档种类、字数） */
  meta: string[]
  /** 这份文档有没有可附上的注解 */
  hasAnnotations: boolean
  /** 预览里有没有已经画好的函数图像（没有就不必说「图像会一起导出」） */
  hasPlots: boolean
  onExport: (opts: ExportOptions) => Promise<ExportResult>
  onReveal: (path: string) => void
  onClose: () => void
}

const ICONS: Record<ExportFormat, typeof FileText> = {
  md: FileText,
  html: FileCode,
  pdf: Printer,
}

const THEMES: Array<{ id: ExportTheme; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
]

const PAPERS: ExportPageSize[] = ['A4', 'A3', 'Letter']

export default function ExportDialog({
  title,
  meta,
  hasAnnotations,
  hasPlots,
  onExport,
  onReveal,
  onClose,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>('html')
  const [theme, setTheme] = useState<ExportTheme>('light')
  const [annotations, setAnnotations] = useState(true)
  const [embedImages, setEmbedImages] = useState(true)
  const [pageSize, setPageSize] = useState<ExportPageSize>('A4')
  const [pageNumbers, setPageNumbers] = useState(true)
  const [landscape, setLandscape] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  const info = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0]
  const fileName = exportFileName(title, format)
  /** 源文件不需要配色与注解（它就是源文本身）；PDF/HTML 才有一堆可选项 */
  const rich = format !== 'md'

  const run = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const r = await onExport({ format, theme, annotations, embedImages, pageSize, pageNumbers, landscape })
      if (r.ok) setSaved(r.path ?? '')
      else if (!r.canceled) setError(r.error || t('导出失败'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('导出失败'))
    } finally {
      setBusy(false)
    }
  }

  // Esc 关闭、回车导出。导出进行中两个都不响应：中途把弹窗摘掉，那次导出就没人收尾了
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <ModalScrim z="z-[60]" onClose={onClose} closeOnBackdrop={!busy}>
      <div
        role="dialog"
        aria-label={t('导出文档')}
        className="moji-dialog-in flex max-h-[88vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.3)]"
      >
        <header className="flex items-start gap-2.5 border-b border-line px-5 py-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            <Download size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-ink-strong">{t('导出文档')}</h2>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-faint" title={title}>
              {title}
            </p>
          </div>
          <button
            type="button"
            title={t('关闭（Esc）')}
            disabled={busy}
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </header>

        <div className={pane(3)}>
          {/* 三种格式：点一下换一种，下面那行说明跟着换 */}
          <div className="grid grid-cols-3 gap-2">
            {EXPORT_FORMATS.map((f) => {
              const on = f.id === format
              const Icon = ICONS[f.id]
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFormat(f.id)}
                  className={
                    'flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left transition ' +
                    (on
                      ? 'border-seal/55 bg-seal/8'
                      : 'border-line bg-card hover:border-line-strong')
                  }
                >
                  <span
                    className={
                      'flex h-7 w-7 items-center justify-center rounded-lg ' +
                      (on ? 'bg-seal/12 text-seal' : 'bg-line/50 text-ink-soft')
                    }
                  >
                    <Icon size={15} />
                  </span>
                  <span className={'text-[12.5px] ' + (on ? 'font-medium text-ink-strong' : 'text-ink')}>
                    {t(f.label)}
                  </span>
                  <span className="text-[10.5px] text-ink-faint">.{f.ext}</span>
                </button>
              )
            })}
          </div>

          <p className="px-0.5 text-[11.5px] leading-relaxed text-ink-faint">{t(info.hint)}</p>

          {rich && (
            <>
              <Seg
                label={t('配色')}
                note={t('浅色适合打印与分享，深色跟随屏幕阅读')}
                value={theme}
                items={THEMES}
                onChange={setTheme}
              />

              {hasAnnotations && (
                <Switch
                  on={annotations}
                  onChange={setAnnotations}
                  label={t('附上我的注解')}
                  hint={t('正文里被标注的词会保留虚线下划线，鼠标悬停能看到注解内容')}
                />
              )}

              <Switch
                on={embedImages}
                onChange={setEmbedImages}
                label={t('把资源图片内嵌进文件')}
                hint={t('图片以 data URL 写进导出件，换台机器也看得到；关掉则只在原位留一句说明，文件会小很多')}
              />

              {hasPlots && (
                <p className="px-0.5 text-[11px] leading-relaxed text-ink-faint">
                  {t('文档里的函数图像会按预览里画好的样子一起导出。')}
                </p>
              )}

              {format === 'pdf' && (
                <>
                  <Seg label={t('纸张')} note="" value={pageSize} items={PAPERS.map((p) => ({ id: p, label: p }))} onChange={setPageSize} />
                  <Switch on={pageNumbers} onChange={setPageNumbers} label={t('页脚打页码')} hint={t('页脚左边是文档标题，右边是「第 n / 共 m 页」')} />
                  <Switch on={landscape} onChange={setLandscape} label={t('横向排版')} hint={t('宽表格、宽公式多的时候更合适')} />
                </>
              )}
            </>
          )}

          {!rich && (
            <p className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
              {t('源文原样导出：公式仍是 LaTeX，图片仍是')} <span className="text-ink-strong">moji:static</span> {t('引用。')}
              {t('要一份离开归一也能看的文件，选 HTML 或 PDF。')}
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-seal/40 bg-seal/8 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-seal-deep">
              {error}
            </p>
          )}

          {saved && (
            <div className="flex items-start gap-2 rounded-lg border border-ok/40 bg-ok/8 px-3.5 py-2.5">
              <Check size={14} className="mt-0.5 shrink-0 text-ok-deep" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-ink-strong">{t('已导出')}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed break-all text-ink-soft">{saved}</p>
              </div>
              <button
                type="button"
                onClick={() => onReveal(saved)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[11px] text-ink transition hover:border-line-strong"
              >
                <FolderOpen size={12} /> {t('打开所在文件夹')}
              </button>
            </div>
          )}

          {meta.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-0.5 text-[11px] text-ink-faint">
              {meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint" title={fileName}>
            {fileName}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:opacity-40"
          >
            {saved ? t('完成') : t('取消')}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-seal px-4 py-1.5 text-[12px] font-medium text-white transition hover:bg-seal-deep disabled:opacity-60"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy ? t('导出中…') : t('导出')}
          </button>
        </footer>
      </div>
    </ModalScrim>
  )
}

/** 一行分段选择（配色 / 纸张）：选项少、互斥，用一排小按钮比下拉框快 */
function Seg<T extends string>({
  label,
  note,
  value,
  items,
  onChange,
}: {
  label: string
  note: string
  value: T
  items: Array<{ id: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2">
      <span className="text-[12.5px] text-ink-strong">{t(label)}</span>
      {note && <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{t(note)}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-paper p-0.5">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={
              'rounded px-2 py-0.5 text-[11.5px] transition ' +
              (it.id === value ? 'bg-seal/12 text-seal-deep' : 'text-ink-soft hover:bg-line/60 hover:text-ink')
            }
          >
            {t(it.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

