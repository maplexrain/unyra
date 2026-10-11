import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { t } from '../../../i18n'

/** 技巧列表 */
const TIPS: Array<{ key: string; text: string }> = [
  {
    key: 'swap-pane',
    text: '双击文档与导师栏中间的分隔线，可快速对调左右两侧位置',
  },
  {
    key: 'zen-mode',
    text: '按 F11、点击右上角或双击文档空白处，即可快速进入纯净阅读',
  },
  {
    key: 'zoom-font',
    text: '按住 Ctrl + 鼠标滚轮可平滑缩放正文与对话字号',
  },
  {
    key: 'select-text',
    text: '划选文档文字后，可按 1~4 快捷选择「学习」、「了解」、「注解」或「询问」',
  },
  {
    key: 'agent-toggle',
    text: '按 Ctrl + Q 可一键收起或展开导师对话栏，光标自动聚焦输入框',
  },
  {
    key: 'doc-export',
    text: '按 Ctrl + E 可将当前文档一键导出为 Markdown、HTML 网页或 PDF',
  },
  {
    key: 'doc-search',
    text: '按 Ctrl + F 快速在文档内搜索关键词，源码模式下按 Ctrl + H 支持文本替换',
  },
  {
    key: 'custom-bg',
    text: '在设置-外观中可开启全局自定义壁纸与幻灯片轮播',
  },
  {
    key: 'outline-nav',
    text: '点击文档区右上角「大纲」按钮可快速跳转小节，支持思维导图视图',
  },
  {
    key: 'code-compile',
    text: '代码块右上角可复制代码、交由导师编译，并支持在沙箱中直接运行调试',
  },
  {
    key: 'tab-wheel',
    text: '鼠标悬停在页签栏上时，滑动滚轮可横向平滑滚动标签页',
  },
  {
    key: 'tab-context',
    text: '右键点击页签可执行批量管理：关闭无关联、关闭子级或关闭非文档',
  },
  {
    key: 'web-browser',
    text: '按 Ctrl + L 可在当前分栏快速开启内置网页浏览器标签页',
  },
  {
    key: 'pomodoro',
    text: '点击顶栏番茄钟开启专注计时，养成专注学习节奏',
  },
  {
    key: 'mind-map',
    text: '知识图谱支持拖拽缩放与回溯，点击节点即刻切换学习',
  },
]

/** 单个 tip 展示时长：10秒 */
const INTERVAL_MS = 10000

export default function TopBarTipCarousel() {
  const [index, setIndex] = useState(0)
  const [fading, setFading] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const timerRef = useRef<number | null>(null)

  const advanceNext = () => {
    setFading(true)
    window.setTimeout(() => {
      setIndex((prev) => (prev + 1) % TIPS.length)
      setFading(false)
    }, 200)
  }

  useEffect(() => {
    if (isHovered) {
      if (timerRef.current) window.clearInterval(timerRef.current)
      return
    }

    timerRef.current = window.setInterval(() => {
      advanceNext()
    }, INTERVAL_MS)

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [isHovered])

  const currentTip = TIPS[index]

  return (
    <button
      type="button"
      onClick={advanceNext}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={t('小技巧（每10秒自动切换，点击切换下一条）')}
      className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line/60 bg-paper/60 px-3 py-1 text-[11.5px] text-ink-soft shadow-xs backdrop-blur-xs transition hover:border-line-strong hover:bg-card hover:text-ink select-none max-w-[40vw] text-left"
    >
      <Sparkles size={12} className="shrink-0 text-seal/80 animate-pulse" />
      <span
        className={`min-w-0 truncate transition-opacity duration-200 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {t(currentTip.text)}
      </span>
    </button>
  )
}
