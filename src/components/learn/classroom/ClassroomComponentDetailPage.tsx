import { useState, useMemo } from 'react'
import {
  ArrowLeft,
  Copy,
  Check,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  Code2,
  Trash2,
  Info,
  CheckCircle2,
  Sliders,
  Volume2,
} from 'lucide-react'
import { getClassroomComponent, unregisterClassroomComponent } from '../../../learn/classroom/registry'
import { playSfx } from '../../../learn/classroom/sfx/sfxEngine'
import { listSfx } from '../../../learn/classroom/sfx/sfxLibrary'
import { getComponentSpec } from './componentSpecs'
import ClassroomComponentPreview, { type PreviewStageTheme } from './ClassroomComponentPreview'
import { t } from '../../../i18n'

export interface ClassroomComponentDetailPageProps {
  tag: string
  onBack: () => void
  onSelectComponent?: (tag: string) => void
  onUnregistered?: () => void
}

export default function ClassroomComponentDetailPage({
  tag,
  onBack,
  onUnregistered,
}: ClassroomComponentDetailPageProps) {
  const compDef = useMemo(() => getClassroomComponent(tag), [tag])
  const spec = useMemo(() => getComponentSpec(tag, compDef), [tag, compDef])
  const sounds = useMemo(() => listSfx(), [])

  const [dslCode, setDslCode] = useState(() => compDef?.example || spec.examples[0]?.code || `<${tag}></${tag}>`)
  const [copied, setCopied] = useState(false)
  const [stageTheme, setStageTheme] = useState<PreviewStageTheme>('dark')
  const [activeAnim, setActiveAnim] = useState<string | undefined>(spec.recommendedAnimations[0])
  const [activeSfx, setActiveSfx] = useState<string>('none')
  const [animTriggerKey, setAnimTriggerKey] = useState(0)

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  const handleReset = () => {
    const defaultCode = compDef?.example || spec.examples[0]?.code || `<${tag}></${tag}>`
    setDslCode(defaultCode)
    setAnimTriggerKey((k) => k + 1)
  }

  const handlePlayAnim = (verb: string) => {
    setActiveAnim(verb)
    setAnimTriggerKey((k) => k + 1)
    if (activeSfx && activeSfx !== 'none') {
      playSfx(activeSfx, { force: true })
    }
  }

  const handlePlaySfx = (sfxName: string) => {
    setActiveSfx(sfxName)
    if (sfxName !== 'none') {
      playSfx(sfxName, { force: true })
    }
  }

  const handleDelete = () => {
    if (confirm(t('确定要注销此外部组件「{0}」吗？', tag))) {
      if (unregisterClassroomComponent(tag)) {
        onUnregistered?.()
        onBack()
      }
    }
  }

  const isExternal = compDef?.source === 'external'

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-paper text-ink overflow-y-auto select-none">
      {/* 顶部二级导航与面包屑 */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-3.5 border-b border-line/60 bg-card/85 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-line/30 hover:bg-line/60 text-ink text-[12.5px] font-semibold transition cursor-pointer active:scale-95"
          >
            <ArrowLeft size={15} />
            <span>{t('返回组件库')}</span>
          </button>
          <div className="h-4 w-px bg-line/60" />
          <nav className="flex items-center gap-1.5 text-[12px] text-ink-soft">
            <span>{t('课堂组件与动效库')}</span>
            <span>/</span>
            <span className="text-seal font-medium">{spec.categoryLabel}</span>
            <span>/</span>
            <span className="font-mono font-bold text-ink-strong">&lt;{tag}&gt;</span>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {isExternal && (
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[12px] font-medium transition cursor-pointer"
            >
              <Trash2 size={13} />
              <span>{t('注销外部组件')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => handleCopy(dslCode)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-seal text-white hover:bg-seal-deep text-[12px] font-bold shadow-xs transition cursor-pointer active:scale-95"
          >
            {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
            <span>{copied ? t('已复制 DSL') : t('复制完整代码')}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        {/* 组件头部介绍区 */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-card border border-line shadow-xs">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-xl bg-seal/15 text-seal font-mono font-bold text-[15px] border border-seal/30 tracking-tight">
                &lt;{tag}&gt;
              </span>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  isExternal
                    ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                    : 'bg-seal/10 text-seal border border-seal/20'
                }`}
              >
                {isExternal ? t('外部动态注册') : t('官方内置组件')}
              </span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-line/40 text-ink-soft">
                {spec.categoryLabel}
              </span>
            </div>
            <h1 className="text-[22px] font-extrabold text-ink-strong">{spec.name}</h1>
            <p className="text-[13.5px] text-ink-soft leading-relaxed max-w-3xl">{spec.description}</p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <button
              type="button"
              onClick={() => handleCopy(`<${tag}></${tag}>`)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-paper border border-line text-[12px] text-ink-soft hover:text-ink transition cursor-pointer"
            >
              <Code2 size={13} />
              <span>{t('复制标签')}</span>
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* 左侧：16:9 实时舞台与演练场 */}
          <div className="lg:col-span-7 space-y-5">
            <div className="flex flex-col rounded-3xl bg-card border border-line shadow-md overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-line bg-paper-deep/50 shrink-0">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-line/40 text-[11px] font-mono text-ink-soft">
                  <Sliders size={12} className="text-seal" />
                  <span>16:9 渲染舞台</span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center p-0.5 rounded-lg bg-line/30 text-[11px]">
                    {(
                      [
                        ['dark', t('沉浸深色')],
                        ['paper', t('纸墨暖调')],
                        ['light', t('极简白昼')],
                        ['acrylic', t('晶透亚克力')],
                      ] as const
                    ).map(([modeKey, label]) => (
                      <button
                        key={modeKey}
                        type="button"
                        onClick={() => setStageTheme(modeKey)}
                        className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                          stageTheme === modeKey ? 'bg-card text-ink font-bold shadow-2xs' : 'text-ink-soft'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAnimTriggerKey((k) => k + 1)
                      if (activeSfx !== 'none') playSfx(activeSfx, { force: true })
                    }}
                    title={t('重新播放入场动效')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-seal/15 text-seal hover:bg-seal/25 text-[11.5px] font-bold transition cursor-pointer"
                  >
                    <Play size={11} fill="currentColor" />
                    <span>{t('播放动效')}</span>
                  </button>
                </div>
              </div>

              <div className="p-4 bg-paper-deep/30">
                <div className="w-full aspect-video">
                  <ClassroomComponentPreview
                    html={dslCode}
                    mode="stage"
                    theme={stageTheme}
                    interactive={true}
                    targetAnim={activeAnim}
                    animateKey={animTriggerKey}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-card border border-line shadow-xs overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-line bg-paper-deep/30">
                <div className="flex items-center gap-2">
                  <Code2 size={15} className="text-seal" />
                  <span className="text-[13px] font-bold text-ink-strong">{t('实时演练场 (实时热重载)')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-ink-soft hover:bg-line/40 hover:text-ink text-[11px] font-medium transition cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>{t('重置示例')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(dslCode)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-line/40 hover:bg-line text-ink text-[11px] font-medium transition cursor-pointer"
                  >
                    {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    <span>{copied ? t('已复制') : t('复制')}</span>
                  </button>
                </div>
              </div>
              <div className="p-4 bg-paper-deep/60">
                <textarea
                  rows={8}
                  value={dslCode}
                  onChange={(e) => setDslCode(e.target.value)}
                  placeholder={t('在此直接编辑组件 DSL 代码，上方舞台将实时响应更新...')}
                  className="w-full p-3.5 rounded-2xl bg-card/90 border border-line/70 font-mono text-[12.5px] text-ink leading-relaxed focus:outline-none focus:border-seal focus:ring-1 focus:ring-seal/30 transition resize-y"
                  spellCheck={false}
                />
                <p className="text-[11px] text-ink-soft mt-2 flex items-center gap-1">
                  <Info size={12} className="text-seal" />
                  <span>{t('提示：修改标签属性（如 title、badge、tone、icon）或正文，上方 16:9 画布将瞬时响应。')}</span>
                </p>
              </div>
            </div>
          </div>

          {/* 右侧：参数详表与动效/音效试配 */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl bg-card border border-line shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-line bg-paper-deep/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={15} className="text-seal" />
                  <span className="text-[13px] font-bold text-ink-strong">{t('参数契约详表 (Props)')}</span>
                </div>
                <span className="text-[11px] text-ink-soft">{t('{0} 项参数', spec.props.length)}</span>
              </div>

              <div className="divide-y divide-line/40">
                {spec.props.map((prop) => (
                  <div key={prop.name} className="p-4 hover:bg-line/10 transition space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-bold text-ink-strong">{prop.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-line/40 text-ink-soft">
                          {prop.type}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          prop.required
                            ? 'bg-rose-500/15 text-rose-500 border border-rose-500/20'
                            : 'bg-line/40 text-ink-soft'
                        }`}
                      >
                        {prop.required ? t('必填') : t('可选')}
                      </span>
                    </div>

                    <p className="text-[12px] text-ink-soft leading-relaxed">{prop.description}</p>

                    {prop.defaultValue && (
                      <div className="text-[11px] text-ink-faint">
                        <span>{t('默认值：')}</span>
                        <code className="px-1.5 py-0.5 rounded bg-line/30 font-mono text-ink">
                          {prop.defaultValue}
                        </code>
                      </div>
                    )}

                    {prop.options && prop.options.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-[11px] text-ink-faint">{t('可选值：')}</span>
                        {prop.options.map((opt) => (
                          <span
                            key={opt}
                            className="px-1.5 py-0.5 rounded bg-seal/10 text-seal font-mono text-[10.5px]"
                          >
                            {opt}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 推荐动效搭配 */}
            <div className="rounded-3xl bg-card border border-line shadow-xs p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-seal" />
                <span className="text-[13px] font-bold text-ink-strong">{t('推荐动效搭配')}</span>
              </div>
              <p className="text-[12px] text-ink-soft leading-relaxed">
                {t('点击下方动效按钮，可即时在上方 16:9 舞台中播放并联动试听音效：')}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {spec.recommendedAnimations.map((animVerb) => {
                  const isCurrent = activeAnim === animVerb
                  return (
                    <button
                      key={animVerb}
                      type="button"
                      onClick={() => handlePlayAnim(animVerb)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-[12px] font-bold transition cursor-pointer active:scale-95 ${
                        isCurrent
                          ? 'bg-seal text-white shadow-xs'
                          : 'bg-paper border border-line hover:border-seal/40 text-ink'
                      }`}
                    >
                      <Play size={11} fill="currentColor" />
                      <span>{animVerb}</span>
                    </button>
                  )
                })}
              </div>

              {/* 搭配音效选择 */}
              <div className="pt-2 border-t border-line/40 space-y-2">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft">
                  <Volume2 size={13} className="text-emerald-500" />
                  <span>{t('联动音效试配')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePlaySfx('none')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono transition cursor-pointer ${
                      activeSfx === 'none'
                        ? 'bg-ink-strong text-paper font-bold'
                        : 'bg-paper border border-line text-ink-soft hover:text-ink'
                    }`}
                  >
                    none
                  </button>
                  {sounds.slice(0, 10).map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => handlePlaySfx(s.name)}
                      title={s.label}
                      className={`px-2 py-1 rounded-lg text-[11px] font-mono transition cursor-pointer ${
                        activeSfx === s.name
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-paper border border-line text-ink-soft hover:border-emerald-500/40'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-card border border-line shadow-xs p-5 space-y-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-500" />
                <span className="text-[13px] font-bold text-ink-strong">{t('设计场景与教学建议')}</span>
              </div>
              <p className="text-[12px] text-ink-soft leading-relaxed bg-paper p-3.5 rounded-2xl border border-line/60">
                {spec.bestPractices}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
