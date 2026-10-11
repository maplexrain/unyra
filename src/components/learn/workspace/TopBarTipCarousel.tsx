import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { t } from '../../../i18n'

/** 技巧列表 */
const TIPS: Array<{ key: string; text: string }> = [
  {
    key: 'swap-pane',
    text: '双击顶栏空白处可快速将文档与导师对话栏对调位置',
  },
  {
    key: 'zen-mode',
    text: '按 F11 或点击右上角纯净阅读，沉浸无干扰阅读正文',
  },
  {
    key: 'zoom-font',
    text: '按住 Ctrl + 鼠标滚轮可平滑缩放正文与对话字号',
  },
  {
    key: 'select-text',
    text: '划选文档文字可「学习」、「了解」、「注解」或「询问」',
  },
  {
    key: 'custom-bg',
    text: '在设置-外观中可开启全局自定义壁纸与幻灯片轮播',
  },
  {
    key: 'outline-nav',
    text: '点击文档区右上角「大纲」按钮可快速跳转小节',
  },
  {
    key: 'code-compile',
    text: '代码块右上角可一键复制代码或交给超级导师编译',
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
