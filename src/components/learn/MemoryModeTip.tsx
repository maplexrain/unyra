import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { rerollMemorySeed, setMemoryPercent, subscribeMemoryMode, type MemoryModeState } from '../../lib/memoryMode'
import { t } from '../../i18n'

/**
 * 记忆模式的悬停 tip（DocFloat 的记忆模式按钮）：一根 slider 调覆盖范围
 * （最左 = 不遮任何元素，最右 = 全覆盖）+「刷新随机分布」换一颗种子重排遮罩。
 * 种子与范围都按文档存（localStorage），重开应用还是同一批遮罩。
 */
export default function MemoryModeTip({ docKey, state }: { docKey: string; state: MemoryModeState }) {
  // state 只作挂载初值；之后的一切变化（slider、刷新、开关）都经广播回流，订阅自己跟上
  const [view, setView] = useState<MemoryModeState>(state)
  useEffect(() => subscribeMemoryMode((key, s) => {
    if (key === docKey) setView(s)
  }), [docKey])

  return (
    <div
      role="tooltip"
      className="absolute left-full top-0 ml-2 z-30 w-64 rounded-none border border-line-strong/80 bg-card/95 p-3 shadow-xl backdrop-blur select-none animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between border-b border-line/60 pb-2">
        <span className="text-[12px] font-semibold tracking-wide text-ink-strong">{t('记忆模式')}</span>
        <span className="font-mono text-[10.5px] text-seal">{view.percent}%</span>
      </div>

      <div className="py-2 text-[11px] leading-relaxed text-ink-faint">
        {t('把正文切成词组盖住一部分，鼠标停在遮罩上显示原文。最左全显示，最右全覆盖。')}
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={view.percent}
        onChange={(e) => setMemoryPercent(docKey, Number(e.target.value))}
        className="w-full cursor-pointer accent-seal"
        aria-label={t('覆盖范围')}
      />
      <div className="flex justify-between text-[10px] text-ink-faint">
        <span>{t('不覆盖')}</span>
        <span>{t('全覆盖')}</span>
      </div>

      <button
        type="button"
        onClick={() => rerollMemorySeed(docKey)}
        className="mt-1 flex w-full items-center justify-between border border-line px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft transition hover:border-seal/60 hover:bg-seal/10 hover:text-ink-strong cursor-pointer"
        title={t('换一颗随机种子重排遮罩（范围保持不变）')}
      >
        <span className="flex items-center gap-1.5">
          <RefreshCw size={13} className="text-seal" />
          <span>{t('刷新随机分布')}</span>
        </span>
        <span className="font-mono text-[10px] text-ink-faint">{view.seed.toString(16).padStart(8, '0').slice(0, 8)}</span>
      </button>
    </div>
  )
}
