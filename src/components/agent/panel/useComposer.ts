/**
 * 输入区的状态：草稿文字、待发送的图片与文件、拖进来的东西、发送与停止。
 *
 * 「待发送」这四个字是这一块的关键：附件**只在内存里**（见 agent/types 的 PendingImage），
 * 贴进来不落盘、不进资源库，真正发送时才由 learn/useAgent 转存——所以放掉预览地址、
 * 卸载时清一遍都归这里管。画出来的是 Composer.tsx，菜单是 PlusMenu.tsx。
 */

import { useEffect, useRef, useState } from 'react'
import type { PendingFile, PendingImage } from '../../../agent/types'
import { MAX_FILES, pendingFromFile, pendingFromRead } from '../../../learn/attachments'
import { MAX_IMAGES, MAX_SOURCE_BYTES } from '../../../learn/images'
import { setAgentFocusHandler } from '../../../lib/agentFocus'
import { native } from '../../../lib/native'
import { usePresence } from '../../../lib/presence'
import { MENU_EXIT_MS } from './constants'
import { makePendingImage, releasePending } from './imagePending'
import { t } from '../../../i18n'

export interface ComposerApi {
  /** 草稿文字 */
  value: string
  setValue: (next: string) => void
  /** 待发送的图片（只在内存里） */
  images: PendingImage[]
  setImages: React.Dispatch<React.SetStateAction<PendingImage[]>>
  /** 待发送的文件（文本 / 二进制） */
  files: PendingFile[]
  /** 从剪贴板粘进来的图：不进输入框（否则会粘成一串文件名），只当附件 */
  pasteImages: (e: React.ClipboardEvent) => void
  /** 外面拖进来的一批文件：图片与文本都从这一条路进 */
  addDropped: (list: File[]) => Promise<void>
  removeImage: (id: string) => void
  removeFile: (id: string) => void
  /** 清空待发送附件：预览地址一并放掉（见 releasePending） */
  clearAttachments: () => void
  /** 「更多 → 文件」用的那一套：把一批已经进来的文件收纳成附件 */
  addPendingFiles: (list: PendingFile[]) => void
  /** 「更多 → 文件」：走系统对话框，把选中的文件读成待发送的附件（见 PlusMenu） */
  pickAttachment: () => Promise<void>
  /** 发送。交出去的是 File 原件；预览地址此刻就可以放掉了（转存读的是 file，不是它） */
  submit: () => void
  /** 输入框从一行起步，随内容长高（值一变就重量一次）。名字不带 Ref：见下面的说明 */
  textareaMount: (el: HTMLTextAreaElement | null) => void
  /*
   * 三个挂载回调（不叫 xxxRef 是有意的）：它们把节点登记到 hook 内部的 ref 上，
   * 传给 JSX 的是函数本身。react(refs) 规则会把名字里带 Ref 的标识符一律当成
   * 「渲染期访问 ref」，于是这里按「挂载时回调」命名——语义也更准。
   */
  /** 「+」菜单那颗按钮：判断点在不在「自己人」身上（见 PlusMenu） */
  onMenuButtonMount: (el: HTMLButtonElement | null) => void
  /** 弹出来的那一块自己：同上 */
  onMenuPanelMount: (el: HTMLDivElement | null) => void
  menuOpen: boolean
  menuMounted: boolean
  menuClosing: boolean
  setMenuOpen: (next: boolean) => void
}

export interface ComposerOptions {
  running: boolean
  /** 当前模型收不收图（决定能不能贴图）。见 ai/settings 的 supportsImage */
  vision: boolean
  onSend: (text: string, images: PendingImage[], files: PendingFile[]) => void
  /** 提示一句话（图片不合适、模型不支持图片输入等） */
  onNotice: (message: string) => void
  /** 主动发问就是想看回复：发送后回到跟随状态（见 useScrollFollow 的 restoreFollow） */
  onSent: () => void
}

export function useComposer({
  running,
  vision,
  onSend,
  onNotice,
  onSent,
}: ComposerOptions): ComposerApi {
  const [value, setValue] = useState('')
  /**
   * 待发送的图片附件。**只在内存里**（见 agent/types 的 PendingImage）：
   * 贴进来不落盘、不进资源库，等真正发送时才转存（见 learn/useAgent）。
   * 代价是切走节点/关掉应用会丢草稿附件——换来的是资源库里不再有没人引用的孤儿。
   */
  const [images, setImages] = useState<PendingImage[]>([])
  /**
   * 待发送的**文件**附件（文本 / 二进制；图片不进这里，它走上面那条图片通道）。
   *
   * 与图片一样只在内存里：发出去的那一刻才决定它进不进上下文、要不要落到资源库
   * （见 learn/attachments）。
   */
  const [files, setFiles] = useState<PendingFile[]>([])
  /**
   * 输入框左下角那颗「+」弹出的菜单（见 PlusMenu）。
   *
   * 展开状态交给 usePresence：收起时先播退场动画再卸载（与全站浮层同一条规矩）。
   * 菜单有**两级**（工作流 / 对话历史各是一层），层级状态收在 PlusMenu 里。
   */
  const {
    open: menuOpen,
    setOpen: setMenuOpen,
    mounted: menuMounted,
    closing: menuClosing,
  } = usePresence(false, MENU_EXIT_MS)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  /** 弹出来的那一块自己：点在它上面不算「点别处」（见 PlusMenu 里那个 effect） */
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * 输入框从一行起步，随内容长高；长到 max-h（见 textarea 的类名）后改为内部滚动。
   * 先置 auto 再读 scrollHeight，这样删字、发送清空后能缩回去——
   * 直接读 scrollHeight 只会量到当前高度，永远缩不回来。
   */
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  /*
   * Ctrl+Q 要「把光标放进输入框」，而它住在上面的学习区里（见 lib/agentFocus）。
   * 登记一次就够：ref 的 identity 是稳定的，回调每次现读 .current。
   *
   * 这段原先住在 AgentPanel 里（拆分成 panel/ 时漏掉了）：登记的是**输入框**，
   * 输入框现在归这里管，所以登记也跟着过来。
   */
  useEffect(() => {
    setAgentFocusHandler(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      // 光标放到末尾：那是「接着写」的位置，而选中的一段旧文字会让人一敲就删掉它。
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
    return () => setAgentFocusHandler(null)
  }, [])

  /**
   * 把一批图片加进待发送列表。
   *
   * 这里**只进内存**：留着 File 原件与一个预览用的 object URL，不落盘、不登记资源。
   * 转存推迟到真正发送的那一刻（见 learn/useAgent 的 transferPendingImages），
   * 于是「贴了又删」「没配 Key 发不出去」的图不会在目标资源库里留下孤儿文件。
   *
   * 四道闸按顺序：是不是图片 → 模型收不收图 → 还能放几张 → 单张体积。
   * 任何一道没过都只说一句话，不打断用户正在写的内容。
   */
  const addImages = (files: File[] | null) => {
    const pics = (files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!pics.length) return
    if (!vision) {
      onNotice(t('当前模型不支持图片输入：可在设置里给这个模型勾上「图像」'))
      return
    }
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      onNotice(t('一条消息最多 {0} 张图', MAX_IMAGES))
      return
    }
    if (pics.length > room) onNotice(t('最多 {0} 张图，多出来的没有添加', MAX_IMAGES))
    const added: PendingImage[] = []
    for (const [i, file] of pics.slice(0, room).entries()) {
      // 体积在这里就拦下：等发送时才报错，用户已经写完一大段话了
      if (file.size > MAX_SOURCE_BYTES) {
        onNotice(t('「{0}」超过 12MB，没有添加', file.name || t('粘贴的图片')))
        continue
      }
      added.push(makePendingImage(file, images.length + i))
    }
    if (added.length) setImages((prev) => [...prev, ...added])
  }

  /** 从剪贴板粘进来的图：不进输入框（否则会粘成一串文件名），只当附件 */
  const pasteImages = (e: React.ClipboardEvent) => {
    const data = e.clipboardData
    if (!data) return
    const files = [...data.items]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (!files.length) return
    e.preventDefault()
    addImages(files)
  }

  /**
   * 收纳一批「刚进来的文件」：图片并进图片那条路（视觉、张数、体积四道闸都在 addImages 里），
   * 其余进文件列表。两个入口（更多 → 文件、从外面拖进来）共用它。
   */
  const addPendingFiles = (list: PendingFile[]) => {
    if (!list.length) return
    const pics = list.filter((p) => p.image).map((p) => p.image as File)
    if (pics.length) addImages(pics)
    const docs = list.filter((p) => !p.image)
    if (!docs.length) return
    const room = MAX_FILES - files.length
    if (room <= 0) {
      onNotice(t('一条消息最多 {0} 个文件附件', MAX_FILES))
      return
    }
    if (docs.length > room) onNotice(t('最多 {0} 个文件附件，多出来的没有添加', MAX_FILES))
    setFiles((prev) => [...prev, ...docs.slice(0, room)])
  }

  /** 拖进来的文件：图片与文本都从这一条路进（判据在 pendingFromFile 里） */
  const addDropped = async (list: File[]) => {
    const pending: PendingFile[] = []
    for (const file of list) pending.push(await pendingFromFile(file))
    addPendingFiles(pending)
  }

  /**
   * 「更多 → 文件」：走系统对话框，**不设扩展名过滤**。
   *
   * 内容由主进程读好（见 electron/storage 的 readAttach）：图片给 dataUrl、文本给正文、
   * 其余只报体积。这里只负责把它变成待发送的附件。
   *
   * （菜单收在 PlusMenu 里，所以这一支由那边拿着用：pickAttachment 作为 prop 传下去。）
   */
  const pickAttachment = async () => {
    const res = await native().local.pickAttach()
    if (!res.ok || !res.paths?.length) return
    const pending: PendingFile[] = []
    for (const p of res.paths) {
      const read = await native().local.readAttach(p)
      if (!read.ok) {
        onNotice(t('「{0}」{1}', p.split(/[\\/]/).pop() ?? '', read.error ?? t('读取失败')))
        continue
      }
      const item = pendingFromRead(read, p)
      if (item) pending.push(item)
    }
    addPendingFiles(pending)
  }

  const removeImage = (id: string) => {
    setImages((prev) => {
      releasePending(prev.filter((img) => img.id === id))
      return prev.filter((img) => img.id !== id)
    })
  }

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id))

  /** 清空待发送附件：预览地址一并放掉（见 releasePending） */
  const clearAttachments = () => {
    releasePending(images)
    setImages([])
    setFiles([])
  }

  /**
   * 卸载时放掉还没发出去的附件的预览地址。
   *
   * 现在这些图只在内存里，没有「磁盘孤儿」要清（那正是改成延迟转存要解决的问题）；
   * 但 object URL 自己不回收，切对话、切目标、关面板都会走到这里。
   *
   * 用 ref 存一份当前列表：清理只在卸载时跑一次，若把 images 写进依赖，
   * 每贴一张图都会跑一遍清理。
   */
  const pendingRef = useRef<PendingImage[]>([])
  useEffect(() => {
    pendingRef.current = images
  })
  useEffect(
    () => () => {
      releasePending(pendingRef.current)
    },
    [],
  );

  const submit = () => {
    const text = value.trim()
    // 只有附件没有字也允许发：贴一张图问「这是什么问题」、丢一份文件说「看看这个」都是常见用法
    if ((!text && !images.length && !files.length) || running) return
    // 交出去的是 File 原件；预览地址此刻就可以放掉了（转存读的是 file，不是它）
    onSend(text, images, files)
    setValue('')
    releasePending(images)
    setImages([])
    setFiles([])
    // 主动发问就是想看回复：无论刚才读到哪儿，都回到跟随状态
    onSent()
  }

  return {
    value,
    setValue,
    images,
    setImages,
    files,
    pasteImages,
    addDropped,
    removeImage,
    removeFile,
    clearAttachments,
    addPendingFiles,
    pickAttachment,
    submit,
    textareaMount: (el: HTMLTextAreaElement | null) => {
      inputRef.current = el
    },
    onMenuButtonMount: (el: HTMLButtonElement | null) => {
      menuBtnRef.current = el
    },
    onMenuPanelMount: (el: HTMLDivElement | null) => {
      menuRef.current = el
    },
    menuOpen,
    menuMounted,
    menuClosing,
    setMenuOpen,
  }
}
