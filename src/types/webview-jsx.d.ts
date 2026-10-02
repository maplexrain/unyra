import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/**
 * <webview> 的 JSX 声明。Electron 的 d.ts 只给了 DOM 接口（Electron.WebviewTag），
 * 没给 React 的 IntrinsicElements——TSX 里直接写 <webview> 会报「不是合法的元素」。
 * 属性只列我们用到的三个（src / partition / allowpopups）：多余的属性通不过编译，
 * 正好挡住「随手往 guest 里塞 webPreferences」这类口子（主进程还有一道
 * will-attach-webview 的收缴，见 electron/app/webSession）。
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: boolean
      }
    }
  }
}
