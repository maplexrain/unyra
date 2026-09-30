/**
 * 命令式的确认框：从「不是 React 的地盘」里弹一个应用风格的确认。
 *
 * 为什么要它：代码块的右侧菜单是渲染期往 DOM 里**命令式**挂上去的（与图像、注解同一层，
 * 见 lib/codeBlockMenu），那里没有组件树可挂。而「这段代码要联网，允不允许」必须问过用户，
 * 又要问得与应用里其它确认框长得一样——于是临时挂一个 React 根，问完就卸。
 *
 * 用一次挂一次而不是常驻：这种弹窗在整条链路上是极低频事件（一次编译、一次运行至多几次），
 * 常驻一个根反而要处理「谁在什么时候重置状态」。
 */
import { createRoot } from 'react-dom/client'
import { t } from '../i18n'
import ConfirmDialog from '../components/ConfirmDialog'

export interface ConfirmRequest {
  title: string
  /** 正文，支持换行 */
  message: string
  confirmLabel?: string
}

/** 弹一次确认框；用户点确认给 true，取消 / 点空白 / Esc 都算 false */
export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let done = false
    const settle = (value: boolean): void => {
      if (done) return
      done = true
      resolve(value)
      // 退场动画要放完再卸（ConfirmDialog 自己会播那一小段），卸早了会看见它「啪」地消失
      window.setTimeout(() => {
        root.unmount()
        host.remove()
      }, 260)
    }
    root.render(
      <ConfirmDialog
        title={req.title}
        message={req.message}
        confirmLabel={req.confirmLabel ?? t('确定')}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />,
    )
  })
}
