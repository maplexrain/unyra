import ClassroomShowcasePage from './ClassroomShowcasePage'

export interface ClassroomShowcaseModalProps {
  isOpen: boolean
  onClose: () => void
  initialTag?: string
}

/**
 * 课堂组件与动效库模态框（兼容性保留，内部统一委托给 ClassroomShowcasePage 全功能页面）
 */
export default function ClassroomShowcaseModal({ isOpen, onClose, initialTag }: ClassroomShowcaseModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-6xl h-[90vh] rounded-3xl bg-paper border border-line shadow-2xl text-ink overflow-hidden animate-in zoom-in-95 duration-200">
        <ClassroomShowcasePage onBack={onClose} initialTag={initialTag} />
      </div>
    </div>
  )
}
