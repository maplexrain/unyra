export interface ToastData {
  msg: string
  key: number
  action?: { label: string; onClick: () => void }
}

interface Props {
  toast: ToastData | null
  onHide: () => void
}

export default function Toast({ toast, onHide }: Props) {
  if (!toast) return null
  /*
   * 两层结构：外层只管**居中**（left-1/2 + -translate-x-1/2），内层只管**出场动画**。
   *
   * 曾经是一层：Tailwind 的 -translate-x-1/2 与 keyframes 里的 transform 落在同一个元素上，
   * 而 Tailwind v4 的 translate 工具类写的是独立的 translate 属性——两者会**叠加**而不是覆盖。
   * 于是入场那 0.22 秒里，气泡先被推到了 -100% 处（看着是「中偏左」），动画一结束 transform
   * 归位，它才「啪」地跳回正中。分开到两个元素上，这两件事就再也不会互相踩。
   */
  return (
    <div key={toast.key} className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="animate-toast-in pointer-events-auto flex items-center gap-3 rounded-lg bg-ink-strong px-4 py-2.5 text-[13px] text-paper shadow-lg">
        <span>{toast.msg}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick()
              onHide()
            }}
            className="font-medium text-[#f0b5a3] transition hover:text-[#ffd9cc]"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}
