/**
 * 这个模块为什么存在：七个模态弹窗各自写了一遍「固定铺满的遮罩 + 点遮罩关闭 + 退场动画」，
 * 逐字相同的两份（ConfirmDialog 与 UserDialog）与同模板变体五份，抽在这里。
 *
 * 三处差异做成参数，不许一刀切：
 * - z：原本分 z-50 / z-[60] / z-[70] 三档，按各自的原值传进来，一处都不挪档；
 * - leaving：带退场动画的四家用它切换 moji-fade-out / moji-fade-in，另外三家是常驻 moji-fade-in；
 * - closeOnBackdrop：导出中、安装进行中两处点遮罩不算数，免得把正在跑的事丢在半路。
 *
 * 内层那块弹窗面板（各自的宽度、阴影、role 与进出场动画）留在调用点上，这里只发外壳。
 */
import type { ReactNode } from 'react'

interface Props {
  /** 遮罩的层级档位：各弹窗原本是 z-50 / z-[60] / z-[70] 三档，原样传进来 */
  z: 'z-50' | 'z-[60]' | 'z-[70]'
  /** 点遮罩（外层）关闭；面板内部的按键各弹窗自己管 */
  onClose: () => void
  /** 正在播退场动画：换 fade-out 并交出点击；不传就是原样的常驻 moji-fade-in */
  leaving?: boolean
  /** 遮罩按下是否算「要点关闭」：默认算；导出中 / 安装中传 false */
  closeOnBackdrop?: boolean
  children: ReactNode
}

export default function ModalScrim({
  z,
  onClose,
  leaving = false,
  closeOnBackdrop = true,
  children,
}: Props) {
  return (
    <div
      className={`no-print fixed inset-0 ${z} flex items-center justify-center modal-scrim p-4 backdrop-blur-[2px] ${
        leaving ? 'moji-fade-out pointer-events-none' : 'moji-fade-in'
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closeOnBackdrop) onClose()
      }}
    >
      {children}
    </div>
  )
}
