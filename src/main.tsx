import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App.tsx'
import BootError from './components/BootError'
import ExamWindow from './components/exam/ExamWindow'
import { bootApp } from './lib/boot'
import { reportStartupMarks, startupMark } from './lib/startupTrace'
import { allProviderBaseUrls } from './ai/settings'
import { syncProxyHosts } from './ai/http'

/**
 * 启动：先把用户、会话与当前用户的数据读进内存，再渲染第一帧。
 *
 * 数据在磁盘上（见 lib/boot.ts），这一步是异步的；放到 render 之后再补，
 * 首帧会先空一下再跳出内容。外观（深浅色）也在 bootApp 里就应用好了。
 */
startupMark('r:module-eval')

const root = createRoot(document.getElementById('root')!)

/**
 * 全站禁拖：默认不让任何东西被拖走（拖走的文字/图片会留下半透明拖影，
 * 拖动还常常与点击冲突）。只有三类例外：**文档浏览区**与 **AI 对话列表**
 * （那两处的选中文字与图片是用户可能要拖去别处的），以及**显式声明了
 * `draggable="true"` 的元素**——那是应用自己登记的拖拽源（资源管理器的行，
 * 拖去页签栏 / 对话输入框，见 explorer 与 lib/chipSyntax），浏览器原生的
 * img/a 默认拖拽不携带这个属性，照旧被拦。禁选的范围见 index.css。
 *
 * 挂在捕获阶段：任何组件都不必再自己处理 dragstart。
 */
document.addEventListener(
  'dragstart',
  (e) => {
    const el = e.target instanceof Element ? e.target : null
    if (el?.closest('[draggable="true"], .note-preview, .moji-selectable')) return
    e.preventDefault()
  },
  true,
)

/**
 * 考试窗口是**第二个 BrowserWindow**，加载的是同一份渲染产物，靠这个参数分流
 * （见 electron/main.ts 的考试窗口一节）。它同样先 bootApp 一次：外观（主题、字号）
 * 与主窗口得是同一套，否则用户从深色主窗口切进一个亮晃晃的考试窗口。
 *
 * 数据不在这一侧：索引为 1 的那个窗口一笔都不写，作答全通过 examGuest 发回主窗口
 * （见 learn/useExamBridge）。所以这里不必读学习数据，只求「长得一样、能收发消息」。
 */
const inExamWindow = new URLSearchParams(location.search).get('examWindow') === '1'

startupMark('r:boot-start')
bootApp()
  .then((boot) => {
    startupMark('r:boot-done')
    if (inExamWindow) {
      root.render(
        <StrictMode>
          <ExamWindow />
        </StrictMode>,
      )
      return
    }
    // 提供商地址同步给主进程：llm-proxy 只放行白名单内的 host，
    // 名单晚到一步就会让启动瞬间的请求（如拉模型列表）吃 403。
    // 此刻当前用户的配置已经读进来了，直接用它算。
    void syncProxyHosts(allProviderBaseUrls())

    root.render(
      <StrictMode>
        <App boot={boot} />
      </StrictMode>,
    )
    startupMark('r:render-called')
    reportStartupMarks()
  })
  .catch((err: unknown) => {
    console.error('[boot] 启动失败：', err)
    root.render(<BootError error={err} />)
  })
