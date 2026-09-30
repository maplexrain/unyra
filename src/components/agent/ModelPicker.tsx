/**
 * 「提供商 · 模型」选择器：agent 栏右下角的那颗按钮，点开是三层菜单。
 *
 * 层级按用户的使用频率排：
 *   一级 思考等级（low / high / max）—— 最常调，滑条就地改，不进下一层
 *   二级 提供商列表             —— 换一家服务
 *   三级 该提供商的模型           —— 换具体模型
 *
 * 两层列表之间用「滑出」过渡：往里走时新面板从左滑入、旧面板向右滑出，
 * 点面包屑返回时方向相反。层级关系因此是看得见的，而不是「啪」地换一屏。
 *
 * 选择会写回「全局默认」（见 ai/settings 的 selectGlobal*），因此这里改一次，
 * 超级导师、描述生成、出题阅卷以及日后的 AI 小功能都跟着变——这正是要求里
 * 「全局提供商 / 全局模型作为基底」的用意。
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check, ChevronRight, Cpu, Server } from 'lucide-react'
import {
  globalEffort,
  globalModel,
  globalProvider,
  labelOf,
  loadAiSettings,
  modelEntriesOf,
  modelsOf,
  protocolOf,
  saveAiSettings,
  subscribeAiSettings,
  type AiSettings,
  type ProviderConfig,
} from '../../ai/settings'
import {
  REASONING_HINT,
  REASONING_LABEL,
  REASONING_NEON,
  compatLabel,
  type ReasoningEffort,
} from '../../ai/types'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'
import EffortSlider from './EffortSlider'

/** 三层菜单的层号 */
type Level = 1 | 2 | 3
/** 1 = 往里走一层，-1 = 退回上一层；决定滑动方向 */
type Dir = 1 | -1

/** 滑动时长，与 index.css 里的 .moji-slide-* 动画保持一致（略短，动画播完才卸载旧面板） */
const SLIDE_MS = 260
/** 退场时长，与 index.css 的 .moji-bloom-up-out 对齐（略长一点，动画播完才卸载） */
const PANEL_EXIT_MS = 170
/** 面板内容最高这么高，再高就在面板内部滚动 */
const PANEL_MAX_H = 300

interface Props {
  /** 设置变化后通知外层刷新（外层据此更新 hasKey 等派生状态） */
  onChanged: () => void
}

export default function ModelPicker({ onChanged }: Props) {
  // 浮层要等退场动画播完才卸载，展开状态交给 useHoverMenu 管（不自带悬停开合：这颗按钮是点开的）
  // 这一处的外点 / Esc 监听挂在 document 上（原样保留）；PersonaPicker 与顶栏那几个挂的是 window
  const { open, setOpen, mounted, wrapProps, panelProps } = useHoverMenu({
    exitMs: PANEL_EXIT_MS,
    outsideClick: true,
    listenOn: 'document',
  })
  const [level, setLevel] = useState<Level>(1)
  /** 正在滑出的那一层；动画播完置空，期间与当前层叠在一起 */
  const [leaving, setLeaving] = useState<{ level: Level; dir: Dir } | null>(null)
  const [dir, setDir] = useState<Dir>(1)
  /** 面板区高度：内容随层级变，量出来做高度过渡，展开/收起才不会跳 */
  const [bodyH, setBodyH] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const leaveTimer = useRef<number | null>(null)
  /**
   * 直接订阅设置，而不是挂载时取一次快照：
   * 设置面板里加完提供商/模型后，这个组件并没有重新挂载（它是盖在设置面板
   * 底下的那一层），拿旧快照就会出现「明明配好了，模型菜单里还是旧列表」。
   * loadAiSettings 返回的是缓存对象本身，引用稳定，适合做快照。
   */
  const settings = useSyncExternalStore(subscribeAiSettings, loadAiSettings)

  // 用 globalProvider 取值：它会按「可用性」回退，因此这里显示的永远是实际生效的那家
  const provider = globalProvider(settings)
  const model = globalModel(settings)
  // 按钮上优先显示模型的展示名（配了才有），否则用 ID
  const modelLabel = provider ? modelEntriesOf(provider).find((m) => m.id === model)?.name || model : ''
  const effort = globalEffort(settings)

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    },
    [],
  )

  /**
   * 面板高度跟着内容走：面板本身是绝对定位（要叠着做滑动），
   * 不给外层定高就会塌成 0。用 ResizeObserver 盯住当前面板——
   * 换层、提供商/模型列表变化都会重新量到，且只在真的变了时才写回 state。
   */
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!mounted || !el) return
    const sync = () => {
      const h = Math.min(el.offsetHeight, PANEL_MAX_H)
      setBodyH((prev) => (prev === h ? prev : h))
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mounted, level, settings])

  /** 换层：记下方向与「正在离开的那一层」，动画结束后再把旧层丢掉 */
  const go = (next: Level) => {
    if (next === level) return
    const d: Dir = next > level ? 1 : -1
    setDir(d)
    setLeaving({ level, dir: d })
    setLevel(next)
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setLeaving(null)
    }, SLIDE_MS)
  }

  /** 写回全局默认（settings 模块内部会把结果规范化，比如模型回落），订阅会带来重渲染 */
  const apply = (patch: Partial<AiSettings['global']>) => {
    const cur = loadAiSettings()
    saveAiSettings({ ...cur, global: { ...cur.global, ...patch } })
    onChanged()
  }

  const pickEffort = (e: ReasoningEffort) => apply({ effort: e })

  const pickProvider = (p: ProviderConfig) => {
    // 换提供商时清空模型，让它回落到该家的第一个
    apply({ providerId: p.id, model: '' })
    go(3)
  }

  const pickModel = (m: string) => {
    apply({ model: m })
    setOpen(false)
  }

  const noModels = !provider || modelsOf(provider).length === 0

  /** 一层的内容。抽成函数是因为过渡期间要同时渲染「新来的」和「正走的」两层 */
  const renderPanel = (lv: Level) => {
    if (lv === 1) {
      return (
        <>
          <div className="px-2.5 pb-1 pt-2 text-[10.5px] tracking-wide text-ink-faint">{t('思考等级')}</div>
          <div className="px-2.5 pb-1">
            <EffortSlider compact value={effort} onChange={pickEffort} />
          </div>
          <p className="px-2.5 pb-2 pt-1 text-[10.5px] leading-relaxed text-ink-faint">
            {t(REASONING_HINT[effort])}
          </p>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            onClick={() => go(2)}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-line/50"
          >
            <Server size={13} className="text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-strong">{t('切换提供商 · 模型')}</span>
            <ChevronRight size={13} className="shrink-0 text-ink-faint" />
          </button>
        </>
      )
    }

    if (lv === 2) {
      return (
        <>
          <div className="px-2.5 py-1 text-[10.5px] tracking-wide text-ink-faint">{t('提供商')}</div>
          {settings.providers.length === 0 && (
            <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-faint">
              {t('还没有配置提供商，请先到设置里添加。')}
            </p>
          )}
          {settings.providers.map((p) => {
            const ready = p.apiKey.trim() !== ''
            const count = modelsOf(p).length
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickProvider(p)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-line/50"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${ready ? 'bg-ok' : 'bg-line-strong'}`}
                  title={ready ? t('已配置 Key') : t('未配置 Key')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink-strong">{labelOf(p)}</span>
                  <span className="block text-[10.5px] text-ink-faint">
                    {compatLabel(protocolOf(p))} · {count ? t('{0} 个模型', count) : t('还没有模型')}
                  </span>
                </span>
                {p.id === provider?.id && <Check size={13} className="shrink-0 text-seal" />}
                <ChevronRight size={13} className="shrink-0 text-ink-faint" />
              </button>
            )
          })}
        </>
      )
    }

    return (
      <>
        <div className="truncate px-2.5 py-1 text-[10.5px] tracking-wide text-ink-faint">
          {t('{0} 的模型', provider ? labelOf(provider) : t('该提供商'))}
        </div>
        {noModels && (
          <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-faint">
            {t('该提供商还没有可用模型，请到设置里添加。')}
          </p>
        )}
        {(provider ? modelEntriesOf(provider) : []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => pickModel(entry.id)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-line/50"
          >
            <Cpu size={12} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] text-ink-strong">{entry.name || entry.id}</span>
              {entry.name && (
                <span className="block truncate font-mono text-[10px] text-ink-faint">{entry.id}</span>
              )}
            </span>
            {entry.id === model && <Check size={13} className="shrink-0 text-seal" />}
          </button>
        ))}
      </>
    )
  }

  return (
    <div className="relative" {...wrapProps}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open)
          setLevel(1)
          setLeaving(null)
        }}
        title={t('切换提供商与模型')}
        className="flex h-8 max-w-[240px] items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-ink-soft transition hover:text-ink"
      >
        <Cpu size={12} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 truncate font-mono">{modelLabel || t('未选模型')}</span>
        <span className="flex shrink-0 items-center gap-1 rounded bg-line/70 px-1 text-[10px] text-ink-soft">
          {/* 荧光点与滑条同色：收起状态下也能看出当前开到哪一档 */}
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: REASONING_NEON[effort] }} />
          {REASONING_LABEL[effort]}
        </span>
        <ChevronRight size={12} className={`shrink-0 text-ink-faint transition ${open ? 'rotate-90' : ''}`} />
      </button>

      {mounted && (
        <div
          className={`absolute right-0 bottom-full z-30 mb-2 w-[290px] overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_16px_44px_rgba(31,27,23,0.22)] ${
            // 从面板底边中点向上、向左右展开（见 index.css 的 .moji-bloom-up-*）
            panelProps.className
          }`}
        >
          {/* 面包屑：点回上一层（滑动方向随之反向） */}
          <div className="flex items-center gap-1 border-b border-line bg-paper-deep/60 px-2.5 py-2 text-[11px]">
            <button
              type="button"
              onClick={() => go(1)}
              className={level === 1 ? 'font-medium text-ink-strong' : 'text-ink-soft hover:text-ink'}
            >
              {t('思考等级')}
            </button>
            {level >= 2 && (
              <>
                <ChevronRight size={11} className="text-ink-faint" />
                <button
                  type="button"
                  onClick={() => go(2)}
                  className={level === 2 ? 'font-medium text-ink-strong' : 'truncate text-ink-soft hover:text-ink'}
                >
                  {t('提供商')}
                </button>
              </>
            )}
            {level >= 3 && (
              <>
                <ChevronRight size={11} className="text-ink-faint" />
                <span className="truncate font-medium text-ink-strong">{t('模型')}</span>
              </>
            )}
          </div>

          {/*
            两层叠着做滑动：当前层在流内（撑出高度），离开的那层绝对定位盖在上面。
            外层 overflow-hidden 裁掉滑出去的部分，滑完再卸载。
          */}
          <div
            className="relative overflow-hidden transition-[height] duration-200 ease-out"
            style={bodyH === null ? undefined : { height: bodyH }}
          >
            {leaving && (
              <div
                className={`absolute inset-x-0 top-0 ${
                  leaving.dir === 1 ? 'moji-slide-out-forward' : 'moji-slide-out-back'
                }`}
                aria-hidden="true"
              >
                <div className="max-h-[300px] overflow-y-auto py-1">{renderPanel(leaving.level)}</div>
              </div>
            )}
            <div
              ref={panelRef}
              key={level}
              className={`relative ${
                leaving ? (dir === 1 ? 'moji-slide-in-forward' : 'moji-slide-in-back') : ''
              }`}
            >
              <div className="max-h-[300px] overflow-y-auto py-1">{renderPanel(level)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
