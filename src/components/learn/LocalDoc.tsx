import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { TriangleAlert as FileWarning, Loader2 } from 'lucide-react'
import type { DocView } from '../../learn/types'
import { extOf, fileNameOf, isMediaFile, isPreviewable } from '../../learn/tabs'
import { readLocalFile, readLocalMediaFile } from '../../lib/localFiles'
import { renderNoteGfm } from '../../lib/markdown'
import { createLocalDocImageResolver } from '../../lib/docImages'
import { copySelectionAsMarkdown } from '../../lib/copySource'
import type { OutlineHandle } from '../../lib/outline'
import MarkdownView from '../MarkdownView'
import SourceEditor, { type SaveState } from './SourceEditor'
import { useDocOutline } from './note/useDocView'
import { t } from '../../i18n'

/**
 * 本地文件（拖进来的 txt / markdown / html）的文档视图。
 *
 * 与节点文档最大的不同：**它不在数据目录里**，内容不进 store 的文档树，也不参与差异比对，
 * 而是打开时现读、保存时写回原文件（见 lib/localFiles）。
 *
 * 「现读」这个词在这一版里更准确了：编辑器里的正文来自**暂存区**（改了没保存的那一份，
 * 见 learn/drafts），落盘只发生在 Ctrl+S。以前这里是自己管防抖写盘的（停手 0.7 秒就存），
 * 那意味着「改了一半」也会被写进用户磁盘上的那个文件——而它可能是别的程序正在用的文件。
 *
 * 预览只支持 markdown 与 html（见 learn/tabs 的 isPreviewable），其余一律源码视图：
 * 给一个纯文本文件渲染出一个「预览」是骗人的。
 */

interface Props {
  path: string
  view: DocView
  /** 正文字号系数（与节点文档共用同一个设置） */
  scale: number
  /** 暂存区里这一份的正文（没改过就是 undefined，编辑器显示磁盘上的那一份） */
  draft?: string
  /**
   * 刚保存成功的那一版正文：它比「打开时读到的那一份」新。
   *
   * 少了它，保存完暂存被撤掉、编辑器回落到打开时读到的那一份，正文会**当场跳回旧版**
   * ——看起来就像保存没成功（甚至像被谁改回去了）。上层写盘成功时把那一份交下来。
   */
  savedText?: string
  /** 改动写进暂存区；传 null 表示「又改回和磁盘上一样了」，撤掉这一条 */
  onDraft: (text: string | null) => void
  /** 正在保存：底栏显示「保存中…」（写盘由上层做，见 LearnWorkspace 的 saveDocNow） */
  saving: boolean
  /** 保存失败的原因 */
  saveError?: string
  /** 文件读不到了（被删/被移走）：上层据此把它从列表里摘掉并关掉页签 */
  onMissing: () => void
  /** 大纲句柄槽（见 lib/outline 的 OutlineHandle）：外部 md 同样挂标题大纲（见 DocFloat） */
  outlineSlot?: { current: OutlineHandle | null }
  /** md 打开时是空的：默认视图会从预览切到编辑（空预览是一片白，用户要的是往里写） */
  onNeedEdit?: () => void
}

export default function LocalDoc({
  path,
  view,
  scale,
  draft,
  savedText,
  onDraft,
  saving,
  saveError,
  onMissing,
  outlineSlot,
  onNeedEdit,
}: Props) {
  const name = fileNameOf(path)
  const previewable = isPreviewable(path)
  const media = isMediaFile(path)
  /** 媒体文件读到的 data URL（mime 由后缀定，见 electron/storage/local 的 readLocalMedia） */
  const [mediaSrc, setMediaSrc] = useState<{ mime: string; dataUrl: string } | null>(null)
  /** 打开时从磁盘读到的那一份（基准的初值，见下面 base 的说明） */
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  /** 「文件读不到」的回调放进 ref：见下面那个 effect 的说明（依赖数组里不能有它） */
  const missingRef = useRef(onMissing)
  useEffect(() => {
    missingRef.current = onMissing
  }, [onMissing])

  /*
   * 打开时读一次盘。
   *
   * 依赖里只有 path：上层给本组件绑了 key={路径}，换文件是重挂，初始态本来就是
   * 「载入中、未保存、没有错误」，因此这里不必（也不该）再同步 setState 一遍——
   * 那会白跑一轮渲染。更要紧的是 onMissing 这类回调用 ref 拿：它在父组件里是每次
   * 渲染都新建的箭头函数，写进依赖数组会让这个 effect 每渲染一次就重读一遍文件，
   * 边改边被读回来的内容覆盖掉。
   */
  useEffect(() => {
    // 媒体文件不走文本读取（白名单也会拒它）：下面专门有一个 effect 读它
    if (media) return
    let alive = true
    void readLocalFile(path).then((r) => {
      if (!alive) return
      setLoading(false)
      if (!r.ok) {
        setError(r.error ?? t('读取失败'))
        missingRef.current()
        return
      }
      setContent(r.content)
    })
    return () => {
      alive = false
    }
  }, [path, media])

  // 媒体文件：读一次二进制（data URL），图片 / 音频 / 视频各按 mime 渲染
  useEffect(() => {
    if (!media) return
    let alive = true
    void readLocalMediaFile(path).then((r) => {
      if (!alive) return
      setLoading(false)
      if (!r.ok) {
        setError(r.error ?? t('读取失败'))
        return
      }
      setMediaSrc({ mime: r.mime ?? '', dataUrl: r.dataUrl ?? '' })
    })
    return () => {
      alive = false
    }
  }, [path, media])

  /*
   * md 打开时是空的：把默认视图从预览切到编辑（效果体在下面 base 定义之后，
   * 那里才是「空与不空」第一次可知的位置）。
   */
  const needEditRef = useRef(onNeedEdit)
  useEffect(() => {
    needEditRef.current = onNeedEdit
  }, [onNeedEdit])
  const isMd = /\.(md|markdown)$/i.test(path)

  /**
   * 编辑器里的正文：暂存区里有就用它。
   *
   * 磁盘上那一份只作基准，不参与显示——否则用户改了两行再切走又切回来，看到的是
   * 「改之前的」，会以为自己的改动丢了（其实它在暂存区里，页签上那颗圆点也在）。
   */
  const base = savedText ?? content
  const text = draft ?? base
  /** 改回原样时把暂存撤掉：那颗「未保存」的圆点该跟着消失 */
  const edit = (next: string) => onDraft(next === base ? null : next)

  /*
   * md 打开时是空的：把默认视图从预览切到编辑。空预览是一片白，用户打开一个空笔记
   * 就是要往里写（与节点空笔记的 viewOf(empty) 同一条道理，但本地文件的空与不空
   * 只有读完才知道，所以在这里补这一下）。用户自己选过视图（tab.view 已设）就听他的。
   */
  useEffect(() => {
    if (view !== 'preview' || !isMd || loading || error || draft !== undefined || base !== '') return
    needEditRef.current?.()
  }, [view, isMd, loading, error, draft, base])

  const state: SaveState = saving
    ? 'saving'
    : saveError
      ? 'error'
      : draft === undefined
        ? 'saved'
        : 'dirty'

  // 预览也读暂存区那一份：改了正文切到预览却还是旧的，是最容易让人以为「没生效」的一种。
  // 外部 md 走 GFM 严格语义（软换行不折行）：徽章这类「一行一个」的写法在预览里
  // 要像 GitHub 那样并排流开，而不是被 <br> 摞成一列（见 lib/markdown 的 renderNoteGfm）
  const html = useMemo(() => (previewable && path.toLowerCase().endsWith('.md') ? renderNoteGfm(text) : ''), [text, previewable, path])
  const isHtml = /\.html?$/i.test(path)
  /**
   * 文档旁边的图片（相对路径引用，如 `![图](hero.png)`）：按这份外部文件**自己的目录**
   * 解析并读成 data URL（见 lib/docImages）。生产 CSP 不放行 file:，这条水合通道是
   * 外地文档的图能显示出来的唯一一条路。path 变了（换了文件）解析器跟着换。
   */
  const resolveLocalImage = useMemo(() => createLocalDocImageResolver(path), [path])

  /*
   * 外部 md 的大纲（悬浮大纲按钮用，见 DocFloat）。与 NodeNote 同一套钩子：
   * 源码视图或非 md 文件时正文那两块根本不渲染，ref 是 null，抽出来自然是空数组。
   * 句柄装进槽的规矩与 NodeNote 一致——不设依赖、每轮渲染重装、卸载时清掉。
   */
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { outline, activeIndex, jumpTo } = useDocOutline({ bodyRef, scrollRef, html })
  useEffect(() => {
    if (outlineSlot) outlineSlot.current = outline.length ? { items: outline, activeIndex, jump: jumpTo } : null
  })
  useEffect(() => {
    const slot = outlineSlot
    return () => {
      if (slot) slot.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12.5px] text-ink-faint">
        <Loader2 size={14} className="animate-spin" />
        {t('正在读取 {0}…', name)}
      </div>
    )
  }

  // 读不到文件时给一页说明——但暂存区里有改动就仍然进编辑器：那是用户的东西，得让他看得见
  if (error && draft === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <FileWarning size={22} className="text-ink-faint" />
        <p className="text-[13px] text-ink">{error}</p>
        <p className="max-w-[380px] text-[11.5px] leading-relaxed text-ink-faint">
          {t('归一只记录了这个文件的路径，不会把内容复制进数据目录。文件被移走或改名之后， 这里就再也读不到它了——它已经从这个列表里移除。')}
        </p>
      </div>
    )
  }

  // 媒体文件：图片 / 音频 / 视频各按 mime 渲染，居中展示（没有「源码」这种东西可看）
  if (media) {
    if (loading) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12.5px] text-ink-faint">
          <Loader2 size={14} className="animate-spin" />
          {t('正在读取 {0}…', name)}
        </div>
      )
    }
    if (error || !mediaSrc) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <FileWarning size={22} className="text-ink-faint" />
          <p className="text-[13px] text-ink">{error ?? t('读取失败')}</p>
        </div>
      )
    }
    const mime = mediaSrc.mime
    const controls =
      mime.startsWith('video/') ? (
        <video src={mediaSrc.dataUrl} controls className="max-h-full max-w-full" />
      ) : mime.startsWith('audio/') ? (
        <div className="flex w-full max-w-[520px] flex-col items-center gap-3">
          <span className="text-[12px] text-ink-faint">{name}</span>
          <audio src={mediaSrc.dataUrl} controls className="w-full" />
        </div>
      ) : (
        <img src={mediaSrc.dataUrl} alt={name} className="max-h-full max-w-full object-contain" />
      )
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-card p-4">
        {controls}
      </div>
    )
  }

  if (view === 'source' || !previewable) {
    return (
      <SourceEditor
        value={text}
        onChange={edit}
        state={state}
        error={saveError ?? error}
        label={path}
        scale={scale}
        ext={extOf(path)}
      />
    )
  }

  if (isHtml) {
    return (
      <div className="print-flat flex min-h-0 flex-1 flex-col bg-white">
        {/*
          预览 html 用 iframe + 空 sandbox，而不是把内容塞进 DOM：
          本地 html 里可能有自己的样式与脚本，塞进宿主 DOM 会**污染整个应用的样式**，
          脚本更不该跑（那是「预览」，不是「运行这个页面」）。
          空 sandbox 意味着：不给脚本、不给同源、不给表单，只把它当一张会排版的图片看。
        */}
        <iframe
          title={name}
          sandbox=""
          srcDoc={text}
          className="h-full w-full border-0 bg-white"
        />
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="print-flat min-h-0 flex-1 overflow-y-auto bg-card">
      {/* 复制同样走源文：预览里选的这一段，进剪贴板的该是它 Markdown 的样子（见 lib/copySource） */}
      <div
        ref={bodyRef}
        className="note-preview moji-node-note doc-measure px-7 py-6"
        style={{ '--doc-scale': scale } as CSSProperties}
        onCopy={(e) => copySelectionAsMarkdown(e, e.currentTarget, text)}
      >
        <MarkdownView html={html} resolveLocalImage={resolveLocalImage} />
      </div>
    </div>
  )
}
