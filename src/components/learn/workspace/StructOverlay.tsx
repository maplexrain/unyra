/*
 * 这个文件负责：节点宇宙浮层——快捷键 learn.structPopout（默认 F1，见 lib/shortcuts）
 * 弹出的那扇「窗」。它不是系统窗口，是文档区上方的一层浮层：画布本体就是大纲页签里
 * 那同一个 StructureCanvas，store 与统一通道全是真的——建 / 删 / 连在浮层里发生，
 * 大纲页签（若开着）与侧栏立刻跟着动，收起浮层什么都不丢，原来那份文档原样还在原地。
 *
 * 没有抬头与关闭按钮（用户定的）：收回靠再按一次快捷键、Esc、或点浮层外的暗处。
 * 遮罩颜色跟主题走：深色主题蒙黑、浅色主题蒙白——bg-ink 在深色主题里是亮色，
 * 蒙出来会发白，所以不用它。
 *
 * 层次纪律：遮罩与面板祖先都**不带 backdrop-blur / transform**——StructureCanvas 里有
 * fixed 定位的浮层（画布右键菜单、拖拽影子），带这些属性的祖先会把它们劫持成
 * 相对自己定位。入场动画只动 opacity。面板比例按用户给的参考（约 91vw × 76vh，居中）。
 */
import type { LearnStore } from '../../../learn/types'
import type { StructureMap } from '../../../learn/structure'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import OutlineView, { type CanvasChannelProps } from '../OutlineView'
import { useDismissOn } from '../../../lib/useDismiss'
import { isDarkTheme, useAppearance } from '../../../lib/appearance'

export interface StructOverlayProps {
  /** 浮层跟着的目标：画布按它取图（弹出那一刻由 LearnWorkspace 定死，浮层不换目标） */
  goalId: string
  store: LearnStore
  onChangeStructure: (goalId: string, next: StructureMap) => void
  docs: NodeDocActions
  exams: ExamActions
  channel: CanvasChannelProps
  onToast: (msg: string) => void
  onClose: () => void
}

export default function StructOverlay({ goalId, store, onChangeStructure, docs, exams, channel, onToast, onClose }: StructOverlayProps) {
  // 点浮层外的暗处 / Esc 收回（滚动、缩放不收——浮层是驻留的工作面，画布滚轮缩放不该把它收走）；
  // 面板内点按 stopPropagation，不会被自己关掉
  useDismissOn({ onClose, scroll: false, resize: false })
  const dark = isDarkTheme(useAppearance().theme)

  return (
    <div
      className={
        (dark ? 'bg-black/40' : 'bg-white/40') +
        ' fixed inset-0 z-[80] flex items-center justify-center animate-in fade-in duration-150'
      }
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        className="relative flex h-[76vh] w-[91vw] overflow-hidden bg-paper shadow-[0_24px_80px_rgba(31,27,23,0.35)] dark:bg-card"
      >
        <div className="relative min-h-0 flex-1">
          <OutlineView
            store={store}
            goalId={goalId}
            onChangeStructure={onChangeStructure}
            docs={docs}
            exams={exams}
            onToast={onToast}
            channel={channel}
          />
        </div>
      </div>
    </div>
  )
}
