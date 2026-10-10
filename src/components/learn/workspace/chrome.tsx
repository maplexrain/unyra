/*
 * 这个文件负责：工作区的三块「外壳」视图——
 * 顶栏与面包屑（Topbar / NodeTrail）、文档列里的节点提示与空态（NodeHints / EmptyDoc）、
 * 以及还没有任何目标时的初始页（GoalInput）。
 *
 * 它们都是纯展示：数据与回调全部由 props 传入，不读 store 的派生逻辑、也不碰磁盘。
 * 原先它们与工作区本体挤在同一个文件里，搬出来之后「改顶栏一颗按钮」不必再翻三千行正文。
 */

import { useRef, useState, type ReactNode } from 'react'
import { ArrowUp, BookOpen, Check, Contact, Globe, Loader2, Menu, Paperclip } from 'lucide-react'
import type { PendingFile } from '../../../agent/types'
import type { KnowledgeNode, LearnStore } from '../../../learn/types'
import { nodeById, pathToRoot } from '../../../learn/graph'
import { plainSnippet } from '../../../learn/text'
import { pendingFromFile, pendingFromRead } from '../../../learn/attachments'
import { isElectron, native } from '../../../lib/native'
import { NO_AUTOFILL } from '../../../lib/autofill'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import {
  THEME_LABEL,
  THEME_MODES,
  THEME_SWATCH,
  getAppearance,
  setAppearance,
  useAppearance,
  type ThemeMode,
} from '../../../lib/appearance'
import type { User } from '../../../user/types'
import UserMenu from '../../user/UserMenu'
import UpdateButton from '../../update/UpdateButton'
import WindowControls from '../../WindowControls'
import Bullseye from '../../Bullseye'
import GoalParticles from '../GoalParticles'
import ModelPicker from '../../agent/ModelPicker'
import { FileChip } from '../../agent/panel/Images'
import { t } from '../../../i18n'

export function Topbar({
  activeNode,
  onSelectNode,
  goalQuestion,
  store,
  user,
  onOpenSidebar,
  onOpenUser,
  onSignOut,
  onOpenSettings,
  onOpenUsage,
  onOpenUpdate,
  onOpenWebTab,
  onToast,
  pomodoro,
  checkin,
  review,
  reading,
}: {
  /** 番茄钟入口（墙上时钟 + 进度条 + 倒计时，见下面的 PomodoroDock） */
  pomodoro: ReactNode
  /** 打卡入口（今天的状态 + 日历 tip，见下面的 CheckinDock） */
  checkin: ReactNode
  /** 复习入口（到期清单 + 未来两周 + 补建，见下面的 ReviewDock） */
  review: ReactNode
  /** 有效阅读入口（今天读了多久 + 节点清单 + 近七天，见下面的 ReadingDock） */
  reading: ReactNode
  /** **当前文档指向的那个节点**（本地文件页签、或一个页签都没有时为 null） */
  activeNode: KnowledgeNode | null
  /** 面包屑点某一级 → 跳到那个祖先节点 */
  onSelectNode: (id: string) => void
  goalQuestion: string
  store: LearnStore
  user: User | null
  onOpenSidebar: () => void
  onOpenUser: () => void
  onSignOut: () => void
  onOpenSettings: () => void
  /** 打开用量统计页签（入口在用户菜单，见 UserMenu） */
  onOpenUsage: () => void
  onOpenUpdate: () => void
  /** 打开新浏览器标签页 */
  onOpenWebTab?: () => void
  /** 顶栏那几个「还没做好」的按钮据此说明一句，而不是点了没反应 */
  onToast: (msg: string) => void
}) {
  const appearance = useAppearance()
  /** 主题按钮的右键菜单：完整主题列表弹在这；null = 没弹 */
  const [themeMenu, setThemeMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      {/*
        这一层必须自带 z-index：backdrop-blur 会让顶栏成为层叠上下文，
      于是里面那个 z-30 的下拉菜单被封在顶栏这一层里，只能按「顶栏的位置」
      参与绘制。而 AI 面板里助手消息那层是 position: relative（z-index auto），
      在 DOM 里排在顶栏之后——同层级里靠后者压前者，菜单就被消息盖住了。
      给顶栏一个正数 z-index，整个顶栏（连同菜单）才真正浮在正文之上。
      取 20 是留出层次：正文浮层（z-30）在它上面，移动端抽屉与其遮罩（z-30/40）、
        各类弹窗（z-50/60）也在它上面。
      */}
      <div className="app-drag no-print relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-gradient-to-b from-card/90 to-paper/70 px-3 backdrop-blur">
      <button
        type="button"
        title={t('打开知识节点')}
        onClick={onOpenSidebar}
        className="flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-ink-soft transition hover:text-ink md:hidden"
      >
        <Menu size={17} />
      </button>

      {/* 目标名：应用的身份区，同时也是拖窗口的手感区。
          logo 与「已掌握 x/y」都不在这里了——侧栏本来就有 logo，掌握进度要看去状态面板，
          顶栏每多一个徽标，真正要看的「目标是什么」就淡一分 */}
      <div className="flex min-w-0 items-center gap-2.5">
        {goalQuestion ? (
          <>
            <Bullseye size={14} className="shrink-0 text-seal" />
            {/* 宽度收窄一档：右边还挤着「当前位置」那一簇（见 NodeTrail） */}
            <span className="max-w-[26vw] truncate text-[13px] text-ink-strong" title={goalQuestion}>
              {goalQuestion}
            </span>
          </>
        ) : (
          <span className="text-[13px] font-medium tracking-wide text-ink-soft">归一</span>
        )}
      </div>

      {/* 当前位置（面包屑）：从文档区顶上那条面包屑行上移过来，正文区因此省下一行 */}
      <NodeTrail node={activeNode} store={store} onSelect={onSelectNode} />

      {/* 右侧只留账号与窗口控制：保存状态与「新建目标」都不再放进顶栏——
          数据本就是实时保存的，而新建目标与知识节点栏右上角那颗按钮是同一件事 */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* 更新入口：只有新版本**下载完成**之后它才存在，见 components/update/UpdateButton */}
        <UpdateButton onOpenUpdate={onOpenUpdate} />
        {/* 新建浏览器标签页入口 */}
        {onOpenWebTab && (
          <button
            type="button"
            title={t('新建浏览器标签页')}
            onClick={onOpenWebTab}
            className="group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium text-ink-soft transition-all duration-150 hover:text-ink"
          >
            <Globe size={14} className="text-ink-faint transition group-hover:text-seal" />
            <span className="hidden text-[12px] sm:inline">{t('浏览器')}</span>
          </button>
        )}
        {/* 四个入口都是「我今天的节奏」，与账号那一簇同属右侧。
            番茄钟排在最前：它是唯一一个「开始之后不看也要一直在跑」的东西，
            固定在最左边，开关它的时候手指不必每次都去找位置 */}
        {pomodoro}
        {reading}
        {checkin}
        {review}
        <UserMenu
          user={user}
          onOpenUser={onOpenUser}
          onOpenSettings={onOpenSettings}
          onOpenUsage={onOpenUsage}
          onSignOut={onSignOut}
        />

        {/*
          主题：点一下在「跟随系统 → 浅色 → 深色」之间轮换。
          为什么是轮换而不是弹出三选一：它是个高频的小动作（夜里换成深色、白天换回来），
          轮换两次之内一定能到想要的档位，而菜单要「展开 → 选 → 收起」三步。
          图标本身就是当前档位（显示器 / 太阳 / 月亮），不必再解释。
        */}
        {/*
          主题：快速按钮只在「跟随系统 → 浅色 → 深色」之间轮换（高频的小动作）；
          粉 / 蓝 / 绿 / 纯白 / 纯黑这些独立配色是低频选择，入口归设置页——
          从扩展主题点这一下会先落到浅色，再点就是熟悉的三档轮换。
        <div className="mx-0.5 h-4 w-px bg-line/60" />

        <button
          type="button"
          title={t('主题：{0}（点击切换，右键看全部主题）', t(THEME_LABEL[appearance.theme]))}
          onContextMenu={(e) => {
            // 右键不弹系统的，弹完整的主题列表（低频的扩展配色走这条路，左键仍是三档快切）
            e.preventDefault()
            setThemeMenu({ x: e.clientX, y: e.clientY })
          }}
          onClick={() => {
            const next: ThemeMode =
              appearance.theme === 'system'
                ? 'light'
                : appearance.theme === 'light'
                  ? 'dark'
                  : appearance.theme === 'dark'
                    ? 'system'
                    : 'light'
            setAppearance({ ...getAppearance(), theme: next })
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-all hover:bg-line/60 hover:text-ink"
        >
          {appearance.theme === 'system' ? (
            <Monitor size={15} />
          ) : isDarkTheme(appearance.theme) ? (
            <Moon size={15} />
          ) : (
            <Sun size={15} />
          )}
        </button>

        {/* 文档与联系方式：位置先占住（需求里明确说「先留空」），点了说明白还没做好 */}
        <button
          type="button"
          title={t('文档')}
          onClick={() => onToast(t('「文档」还在做：之后这里放教学文档的入口'))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-all hover:bg-line/60 hover:text-ink"
        >
          <BookOpen size={15} />
        </button>
        <button
          type="button"
          title={t('联系方式')}
          onClick={() => onToast(t('「联系方式」还是空的：之后放反馈与作者的入口'))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-all hover:bg-line/60 hover:text-ink"
        >
          <Contact size={15} />
        </button>

        <WindowControls />
      </div>
      </div>

      {/*
        主题菜单必须渲染在顶栏那个 div **外面**：顶栏的 backdrop-blur 会把自己变成
        fixed 定位的包含块，菜单的 fixed 坐标会被解释成「相对顶栏」，弹到视口外去。
      */}
      {themeMenu && (
        <ThemeMenu
          menu={themeMenu}
          current={appearance.theme}
          onPick={(mode) => {
            setAppearance({ ...getAppearance(), theme: mode })
            setThemeMenu(null)
          }}
          onClose={() => setThemeMenu(null)}
        />
      )}
    </>
  )
}

/**
 * 主题按钮的右键菜单：全部主题（含左键轮换里轮不到的扩展配色）一次列全。
 *
 * 左键仍是「跟随系统 → 浅色 → 深色」的三档快切（高频动作，两次之内必到）；
 * 暖纸、石墨、纯黑这些低频选择归这条菜单——不用再绕去设置页。
 * 每行左侧一枚小色板（这套主题的纸色 + 强调色圆点，见 lib/appearance 的 THEME_SWATCH），
 * 当前档位带一枚勾。
 */
function ThemeMenu({
  menu,
  current,
  onPick,
  onClose,
}: {
  menu: { x: number; y: number }
  current: ThemeMode
  onPick: (mode: ThemeMode) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)
  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] max-h-[70vh] min-w-[172px] overflow-y-auto rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {THEME_MODES.map((mode) => {
        const on = mode === current
        const swatch = THEME_SWATCH[mode]
        return (
          <button
            key={mode}
            type="button"
            role="menuitem"
            onClick={() => onPick(mode)}
            className={
              'flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2 pr-2.5 text-left text-[12px] transition hover:bg-line/60 ' +
              (on ? 'font-medium text-ink-strong' : 'text-ink')
            }
          >
            {/* 色板：纸色打底、强调色一枚圆点——不看名字也能认出是哪套配色 */}
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong"
              style={{ background: swatch.paper }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: swatch.accent }} />
            </span>
            <span className="min-w-0 flex-1 truncate">{t(THEME_LABEL[mode])}</span>
            {on && <Check size={13} className="shrink-0 text-seal" />}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- 文档列里的节点提示 / 空态 ---------- */


/**
 * 节点关系提示：还差哪些前置没掌握。
 *
 * 它原先挤在文档栏那一行里（与文档标签、试卷入口同一行）。页签接管那一行之后，
 * 这一块单独留在这里：它说的是**当前这个节点**的处境，与「正开着哪份文档」无关，
 * 因此不跟着页签走，也不必占页签栏的地方。不常出现，出现时才多占一行。
 *
 * 「前置已就绪，可以回溯」那一条**删掉了**（用户定的）：节点掌握之后，这一格顶上
 * 就冒出一条提示加一串跳转按钮，而掌握本身就是「可以往下走了」——该去哪儿由学习状态
 * 与那棵树说了算（状态现在是侧栏标题前的那颗标记）。一句每次都冒出来的提示，
 * 只会把正文往下挤。
 */
export function NodeHints(_props: { node?: KnowledgeNode; store?: LearnStore }) {
  return null
}

/**
 * 一个页签都没有时的文档区。
 *
 * 页签是可以全部关掉的（右键菜单里就有「全部关闭」），那时给一句话说清去哪儿找东西，
 * 而不是留一片白——空白面板看起来像坏了。
 */
export function EmptyDoc({ onPickLocal, onOpenWeb }: { onPickLocal: () => void; onOpenWeb?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[13px] text-ink-soft">{t('没有打开的文档')}</p>
      <p className="max-w-[380px] text-[11.5px] leading-relaxed text-ink-faint">
        {t('点左侧资源管理器里的知识点，会在这里开一个页签；也可以把 txt / markdown 文件 拖进窗口，或')}
        <button
          type="button"
          onClick={onPickLocal}
          className="mx-0.5 rounded px-1 text-seal-deep underline decoration-dotted underline-offset-2 transition hover:bg-seal/10"
        >
          {t('打开一个本地文件')}
        </button>
        {onOpenWeb && (
          <>
            {t('，或')}
            <button
              type="button"
              onClick={onOpenWeb}
              className="mx-0.5 rounded px-1 text-seal-deep underline decoration-dotted underline-offset-2 transition hover:bg-seal/10"
            >
              {t('打开一个网页')}
            </button>
          </>
        )}
        。
      </p>
    </div>
  )
}


/**
 * 顶栏里的「我在哪」：一条面包屑。
 *
 * 这一簇原先是文档区顶上的一条独立行，现在提到顶栏：左边是「学什么」（目标），
 * 右边是「学到哪」（当前节点），一行读完，正文区省下一行。
 *
 * 学习状态徽标与关系摘要（前置几个、被几个依赖）都从这儿撤了：它们是次要信息，
 * 常驻顶栏只会把面包屑挤成一段省略号——状态面板与节点详情才是它们该在的地方。
 *
 * 停在目标根节点上时不画面包屑——那一段与左边的目标名重复。
 */
export function NodeTrail({
  node,
  store,
  onSelect,
}: {
  node: KnowledgeNode | null
  store: LearnStore
  onSelect: (id: string) => void
}) {
  const rootId = node ? (store.goals.find((g) => g.id === node.goalId)?.rootNodeId ?? null) : null

  if (!node) return null
  const trail = (rootId ? pathToRoot(store, rootId, node.id) : null) ?? []

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-ink-faint">
      <span className="mx-0.5 h-5 w-px shrink-0 bg-line-strong/60" />

      {/* 面包屑本身就是入口：点任意一级回到那个祖先节点 */}
      {trail.length > 1 &&
        trail.map((id, i) => {
          const n = nodeById(store, id)
          if (!n) return null
          const last = i === trail.length - 1
          return (
            <span key={id} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="shrink-0 text-line-strong">›</span>}
              <button
                type="button"
                onClick={() => onSelect(id)}
                disabled={last}
                // 悬停显示该节点的描述（描述不再占用正文版面）
                title={n.description ? `${n.title}\n\n${plainSnippet(n.description, 600)}` : n.title}
                className={`min-w-0 max-w-[11em] truncate rounded px-1 py-px transition ${
                  last ? 'font-medium text-ink-strong' : 'hover:bg-line/60 hover:text-ink'
                }`}
              >
                {n.title}
              </button>
            </span>
          )
        })}

      {node.id === rootId && (
        <span className="shrink-0 rounded border border-line bg-paper px-1.5 py-px text-[10px] text-ink-faint">
          {t('目标')}
        </span>
      )}
    </div>
  )
}

/* ---------- 初始页 ---------- */

export function GoalInput({
  busy,
  hasGoals,
  onSubmit,
  onModelChanged,
}: {
  busy: boolean
  hasGoals: boolean
  onSubmit: (q: string, files?: PendingFile[]) => void
  /** 模型选择器改了全局默认后的回调（外层据此刷新 hasKey 等派生状态） */
  onModelChanged: () => void
}) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const addFiles = (newFiles: PendingFile[]) => {
    if (!newFiles.length) return
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + '_' + f.bytes))
      const toAdd = newFiles.filter((f) => !existing.has(f.name + '_' + f.bytes))
      return [...prev, ...toAdd]
    })
  }

  const handlePickAttach = async () => {
    // 桌面端环境：统一走 Electron 原生文件选择对话框，绝不触发 input.click 导致弹出双窗口
    if (isElectron()) {
      try {
        const res = await native().local.pickAttach()
        if (!res || !res.ok || !res.paths?.length) return
        const picked: PendingFile[] = []
        for (const p of res.paths) {
          const read = await native().local.readAttach(p)
          if (read.ok) {
            const item = pendingFromRead(read, p)
            if (item) picked.push(item)
          }
        }
        if (picked.length > 0) {
          addFiles(picked)
        }
      } catch (err) {
        console.error('Electron pickAttach failed:', err)
      }
      return
    }

    // 纯 Web 环境：走浏览器 input 元素
    fileInputRef.current?.click()
  }

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || !list.length) return
    const picked: PendingFile[] = []
    for (let i = 0; i < list.length; i++) {
      picked.push(await pendingFromFile(list[i]))
    }
    addFiles(picked)
    e.target.value = ''
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    const droppedFiles = e.dataTransfer.files
    if (!droppedFiles || !droppedFiles.length) return
    const picked: PendingFile[] = []
    for (let i = 0; i < droppedFiles.length; i++) {
      picked.push(await pendingFromFile(droppedFiles[i]))
    }
    addFiles(picked)
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault()
      const pasted: PendingFile[] = []
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        pasted.push(await pendingFromFile(e.clipboardData.files[i]))
      }
      addFiles(pasted)
    }
  }

  const submit = () => {
    const text = value.trim()
    if ((!text && files.length === 0) || busy) return
    onSubmit(text, files.length > 0 ? files : undefined)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-card px-6 py-10">
      {/* 背景粒子与“归一”回溯心流动画 */}
      <GoalParticles />

      {/* 加宽到 860px：输入框更接近参考图那种「一横条」的观感 */}
      <div className="relative my-auto w-full max-w-[860px]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-12 w-12 select-none items-center justify-center rounded-xl bg-seal/10 text-seal">
            <Bullseye size={26} />
          </div>
          <div>
            <h1 className="text-[20px] font-semibold text-ink-strong">
              {hasGoals ? t('开始一个新的学习目标') : t('从一个目标开始')}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              {t('写下想弄懂的问题或上传参考资料，超级导师会陪你从基础逐层逆向拆解并回溯归一')}
            </p>
          </div>
        </div>

        {/*
          输入区卡片：参照 Agent 栏 Composer 结构与视觉风格，
          附件栏置顶横向排列、无斜杠菜单、左下角为上传附件按钮
        */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDraggingOver(true)
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          onPaste={handlePaste}
          className={`mt-5 rounded-2xl border bg-transparent backdrop-blur-[2px] transition ${
            isDraggingOver
              ? 'border-seal/60 ring-2 ring-seal/20'
              : 'border-line/80 focus-within:border-seal/50 focus-within:ring-2 focus-within:ring-seal/10'
          }`}
        >
          {/* 待发送附件列表：与 Agent 栏 Composer 一致置于文字区上方 */}
          {files.length > 0 && (
            <div className="flex items-center gap-2 border-b border-line/60 px-2.5 py-2">
              <div className="moji-scroll-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                {files.map((file) => (
                  <FileChip key={file.id} file={file} onRemove={() => removeFile(file.id)} />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFiles([])}
                title={t('移除全部附件')}
                className="shrink-0 rounded-md px-1.5 py-1 text-[10.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
              >
                {t('清空')}
              </button>
            </div>
          )}

          <div className="relative">
            <textarea
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // 直接 Enter 就开讲（Shift+Enter 换行）；输入法组字期间不拦
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={files.length > 0 ? 3 : 4}
              placeholder={
                files.length > 0
                  ? t('已添加附件。可在输入框补充说明（例如：根据附件资料制定学习计划），直接回车亦可开始…')
                  : t('例如：为什么 Transformer 能处理长距离依赖？')
              }
              className="block min-h-[80px] w-full resize-none rounded-t-2xl bg-transparent px-3.5 pt-3 pb-2 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
              {...NO_AUTOFILL}
            />
          </div>

          <div className="flex items-center gap-2 rounded-b-2xl px-2.5 py-2">
            {/* 左侧：原 Composer 更多菜单位置，替换为上传附件按钮 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onFileInputChange}
            />
            <button
              type="button"
              onClick={handlePickAttach}
              title={t('上传附件（支持图片、Markdown、TXT、代码等）')}
              aria-label={t('上传附件')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/60 hover:text-ink"
            >
              <Paperclip size={16} />
            </button>
            {isDraggingOver && (
              <span className="text-[11.5px] font-medium text-seal animate-pulse">
                {t('松开鼠标放入文件')}
              </span>
            )}

            {/* 右侧：提供商/模型选择 + 开始学习按钮 */}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <ModelPicker onChanged={onModelChanged} />
              <button
                type="button"
                onClick={submit}
                disabled={(!value.trim() && files.length === 0) || busy}
                title={t('开始学习（Enter）')}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-35"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* 底部快捷键与拖拽说明 */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-ink-faint">
          <span>{t('支持点击添加、拖入或粘贴文件作为目标参考')}</span>
          <span>{t('Enter 开始 · Shift + Enter 换行')}</span>
        </div>
      </div>
    </div>
  )
}