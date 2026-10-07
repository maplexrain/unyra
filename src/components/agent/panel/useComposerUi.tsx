/**
 * 输入区的接线：把 useComposer（草稿与附件）、usePlusMenu（「+」菜单）和 Composer
 * （怎么画）接到一起，外加拖动进来的文件那一点本地状态。
 *
 * 拆成 hook 是因为 Composer.tsx 里只该有 JSX——而这个文件负责「谁知道谁」：
 * 菜单的 ref、拖拽高亮、附件预览开哪一张，都在这里对齐。
 */

import { useState, type ReactNode } from 'react'
import type { AskAnswers, AskFormPayload } from '../../../agent/tools'
import type { Conversation, MessageUsage, PendingImage } from '../../../agent/types'
import type { ReasoningEffort } from '../../../ai/types'
import { Composer } from './Composer'
import type { ComposerApi } from './useComposer'
import { usePlusMenu, type PlusMenuApi } from './usePlusMenu'
import { docChipReceive } from '../../../lib/docChip'
import { CHIP_MIME, parseChipJson } from '../../../lib/chipSyntax'

export interface ComposerUiProps {
  composer: ComposerApi
  running: boolean
  hasKey: boolean
  /** 当前提供商的显示名，仅用于「未配置」提示 */
  providerLabel: string
  /**
   * 待回答的结构化表单（api.ask 发起的）：显示在输入框上方，提交前沙箱一直阻塞着。
   * id 是这一次表单的身份（重开一张表单时 key 换掉，旧答案不会串）。
   */
  ask: { id: string; form: AskFormPayload } | null
  onAskSubmit: (answers: AskAnswers) => void
  onAskCancel: () => void
  /** 这个对话里所有回复的 token 账：圆环据此汇总 */
  usages: MessageUsage[]
  onModelChanged: () => void
  onStop: () => void
  onNewConversation: () => void
  conversations: Conversation[]
  conversation: Conversation | null
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onRecall: () => void
  onSuperLab: () => void
  onCheckin: () => void
  /** 更多 → 工作流 → 浏览器操作：替用户驱动内置浏览器完成任务 */
  onBrowserUse: () => void
  onCompact: () => void
  compacting: boolean
  /** 自动压缩阈值（0~1），菜单项上如实说明「到多少会自己压」 */
  compactThreshold: number
  onOpenAgentSettings: () => void
  /** 斜杠 /exam：跑内置工作流「出卷」 */
  onExam: () => void
  /** 全局推理等级与它的入口（斜杠 /effort） */
  effort: ReasoningEffort
  onSetEffort: (e: ReasoningEffort) => void
  /** 点开输入框里的缩略图看大图 */
  onOpenPreview: (image: PendingImage) => void
  /** 子会话模式（见 Composer.subMode 的说明）：面板正看着一个子代理会话 */
  subMode?: { name: string; running: boolean }
  /** 子代理会话入口（按钮 + 弹出列表），插在模型选择器左侧 */
  subAgentSlot?: ReactNode
  /** 导师人格入口：插在子代理按钮的右侧，与提供商切换同一排 */
  personaSlot?: ReactNode
  /** 这枚面板是不是眼前的页签（原样透传给 Composer：隐藏面板不登记 chip 落点） */
  active?: boolean
}

export function ComposerUi(props: ComposerUiProps): ReactNode {
  const {
    composer,
    running,
    hasKey,
    compacting,
    compactThreshold,
    conversations,
    conversation,
    onNewConversation,
    onSelectConversation,
    onDeleteConversation,
    onRecall,
    onSuperLab,
    onCheckin,
    onBrowserUse,
    onCompact,
    onOpenAgentSettings,
  } = props
  /** 拖拽悬停：高亮输入框，告诉用户「松手就放这里」 */
  const [dragOver, setDragOver] = useState(false)

  const menu: PlusMenuApi = usePlusMenu({
    conversations,
    conversation,
    running,
    hasKey,
    compacting,
    compactThreshold,
    menuOpen: composer.menuOpen,
    menuMounted: composer.menuMounted,
    menuClosing: composer.menuClosing,
    setMenuOpen: composer.setMenuOpen,
    buttonMount: composer.onMenuButtonMount,
    panelMount: composer.onMenuPanelMount,
    onNewConversation,
    onSelectConversation,
    onDeleteConversation,
    onRecall,
    onSuperLab,
    onCheckin,
    onBrowserUse,
    onCompact,
    onOpenAgentSettings,
    // 附件那两个入口由输入区提供（见 useComposer）
    onAttach: () => void composer.pickAttachment(),
  })

  const dropInto = (e: React.DragEvent) => {
    // 资源管理器 / 外部拖进来的引用（HTML5 拖放那一路）：优先于文件——它是对话的一部分
    const chipRaw = e.dataTransfer.getData(CHIP_MIME)
    if (chipRaw) {
      e.preventDefault()
      setDragOver(false)
      const p = parseChipJson(chipRaw)
      if (p) docChipReceive(p)
      return
    }
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragOver(false)
    void composer.addDropped([...e.dataTransfer.files])
  }

  return (
    <Composer
      {...props}
      menuMounted={menu.menuMounted}
      menuClosing={menu.menuClosing}
      menuSub={menu.menuSub}
      menuOpen={menu.menuOpen}
      menuLeaving={menu.menuLeaving}
      menuDir={menu.menuDir}
      menuBodyH={menu.menuBodyH}
      panelMount={menu.panelMount}
      panelBodyMount={menu.panelBodyMount}
      buttonMount={menu.buttonMount}
      renderMenuPanel={menu.renderMenuPanel}
      goRoot={menu.goRoot}
      toggle={menu.toggle}
      plusButtonClass={menu.plusButtonClass}
      dragOver={dragOver}
      onDragOver={(e) => {
        // 文件与引用都亮起来：拖一段普通文字进来不该有反应。
        // dropEffect 显式给 copy：拖拽源声明的是 effectAllowed=copy，两处口径要一致
        if (!e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes(CHIP_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={dropInto}
    />
  )
}
