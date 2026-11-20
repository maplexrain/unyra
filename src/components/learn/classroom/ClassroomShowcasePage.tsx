import { useState, useRef, useMemo } from 'react'
import {
  listClassroomComponents,
  listClassroomAnimations,
  registerClassroomComponent,
  registerClassroomAnimation,
  unregisterClassroomComponent,
  unregisterClassroomAnimation,
} from '../../../learn/classroom/registry'
import { runAnimeAnimation } from '../../../learn/classroom/animations'
import { playSfx } from '../../../learn/classroom/sfx/sfxEngine'
import { listSfx } from '../../../learn/classroom/sfx/sfxLibrary'
import ClassroomComponentPreview from './ClassroomComponentPreview'
import ClassroomComponentDetailPage from './ClassroomComponentDetailPage'
import ClassroomSfxSection from './ClassroomSfxSection'
import {
  ArrowLeft,
  Sparkles,
  Play,
  Copy,
  Check,
  Search,
  Plus,
  Trash2,
  Layers,
  Film,
  Tag,
  Volume2,
  ArrowRight,
} from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomShowcasePageProps {
  onBack?: () => void
  initialTag?: string
}

type TabCategory = 'all' | 'components' | 'animations' | 'sounds' | 'external'
type ComponentSubCategory = 'all' | 'layout' | 'content' | 'interactive' | 'visual'

export default function ClassroomShowcasePage({ onBack, initialTag }: ClassroomShowcasePageProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag || null)
  const [activeTab, setActiveTab] = useState<TabCategory>('all')
  const [subCategory, setSubCategory] = useState<ComponentSubCategory>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [isCreating, setIsCreating] = useState(false)

  // 注册表单状态
  const [createKind, setCreateKind] = useState<'component' | 'animation'>('component')
  const [formTagOrVerb, setFormTagOrVerb] = useState('')
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTemplate, setFormTemplate] = useState('')
  const [formKeyframes, setFormKeyframes] = useState('{\n  "scale": [0.85, 1],\n  "opacity": [0, 1]\n}')
  const [formDuration, setFormDuration] = useState('600')
  const [formError, setFormError] = useState<string | null>(null)

  const animTargetsRef = useRef<Record<string, HTMLDivElement | null>>({})

  const components = useMemo(() => {
    void revision
    return listClassroomComponents()
  }, [revision])

  const animations = useMemo(() => {
    void revision
    return listClassroomAnimations()
  }, [revision])

  const allSounds = useMemo(() => listSfx(), [])

  const handleCopy = (e: React.MouseEvent, id: string, text: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  const handlePlayAnimation = (verb: string, recommendedSfx?: string) => {
    const el = animTargetsRef.current[verb]
    if (!el) return
    runAnimeAnimation(el, verb)
    if (recommendedSfx) {
      playSfx(recommendedSfx)
    }
  }

  const handleDeleteComponent = (e: React.MouseEvent, tag: string) => {
    e.stopPropagation()
    if (confirm(t('确定要注销组件 <{0}> 吗？', tag))) {
      if (unregisterClassroomComponent(tag)) {
        setRevision((v) => v + 1)
      }
    }
  }

  const handleDeleteAnimation = (verb: string) => {
    if (confirm(t('确定要注销动效「{0}」吗？', verb))) {
      if (unregisterClassroomAnimation(verb)) {
        setRevision((v) => v + 1)
      }
    }
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (createKind === 'component') {
      const res = registerClassroomComponent({
        tag: formTagOrVerb,
        name: formName,
        description: formDesc,
        template: formTemplate || `<div class="card-glass"><h4 class="card-ui-title">{{title}}</h4><div>{{content}}</div></div>`,
      })
      if (!res.ok) {
        setFormError(res.message || t('注册组件失败'))
        return
      }
    } else {
      let parsedKeyframes: Record<string, unknown> | Array<Record<string, unknown>> | undefined
      if (formKeyframes.trim()) {
        try {
          parsedKeyframes = JSON.parse(formKeyframes)
        } catch {
          setFormError(t('关键帧 Keyframes 必须为合法 JSON 格式'))
          return
        }
      }
      const res = registerClassroomAnimation({
        verb: formTagOrVerb,
        name: formName,
        description: formDesc,
        keyframes: parsedKeyframes,
        duration: parseInt(formDuration, 10) || 600,
      })
      if (!res.ok) {
        setFormError(res.message || t('注册动效失败'))
        return
      }
    }

    setIsCreating(false)
    setFormTagOrVerb('')
    setFormName('')
    setFormDesc('')
    setFormTemplate('')
    setRevision((v) => v + 1)
  }

  const filteredComponents = useMemo(() => {
    if (activeTab === 'animations' || activeTab === 'sounds') return []
    let list = components
    if (activeTab === 'external') list = list.filter((c) => c.source === 'external')
    if (subCategory !== 'all') {
      list = list.filter((c) => c.category === subCategory)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (c) =>
          c.tag.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      )
    }
    return list
  }, [components, activeTab, subCategory, searchQuery])

  const filteredAnimations = useMemo(() => {
    if (activeTab === 'components' || activeTab === 'sounds') return []
    let list = animations
    if (activeTab === 'external') list = list.filter((a) => a.source === 'external')
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (a) =>
          a.verb.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q),
      )
    }
    return list
  }, [animations, activeTab, searchQuery])

  const filteredSounds = useMemo(() => {
    if (activeTab !== 'all' && activeTab !== 'sounds') return []
    return searchQuery.trim() ? listSfx({ query: searchQuery }) : allSounds
  }, [allSounds, activeTab, searchQuery])

  if (selectedTag) {
    return (
      <ClassroomComponentDetailPage
        tag={selectedTag}
        onBack={() => setSelectedTag(null)}
        onUnregistered={() => {
          setSelectedTag(null)
          setRevision((v) => v + 1)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-paper text-ink overflow-y-auto select-none">
      {/* 顶部主标题栏 */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-line bg-card/85 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-line/40 hover:bg-line/70 text-ink text-[12.5px] font-semibold transition cursor-pointer active:scale-95"
            >
              <ArrowLeft size={15} />
              <span>{t('返回课堂')}</span>
            </button>
          )}
          <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-seal/15 text-seal border border-seal/20 shrink-0">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-extrabold text-ink-strong">{t('课堂组件与动效库')}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-seal/10 text-seal">
                v2.0 页面版
              </span>
            </div>
            <p className="text-[12px] text-ink-soft">
              {t('墨韵教学组件 · 精雕 Anime.js 动效 · WebAudio 实时音效库')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-3 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('搜索组件、动效或音效 (如: pipeline, shimmer, chime)...')}
              className="pl-8.5 pr-3 py-1.5 w-68 rounded-xl bg-paper border border-line text-[12px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-seal transition"
            />
          </div>
          <button
            type="button"
            onClick={() => setIsCreating(!isCreating)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-seal text-white hover:bg-seal-deep text-[12px] font-bold shadow-xs transition cursor-pointer active:scale-95"
          >
            <Plus size={14} />
            <span>{isCreating ? t('收起表单') : t('创作注册')}</span>
          </button>
        </div>
      </header>

      {/* 分类过滤器条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-line/50 bg-card/60 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-line/30 text-[12px] font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'all' ? 'bg-seal text-white font-bold shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('全部 ({0})', components.length + animations.length + allSounds.length)}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('components')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'components' ? 'bg-seal text-white font-bold shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Layers size={13} />
            <span>{t('组件库 ({0})', components.length)}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('animations')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'animations' ? 'bg-seal text-white font-bold shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Film size={13} />
            <span>{t('动效库 ({0})', animations.length)}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sounds')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'sounds' ? 'bg-seal text-white font-bold shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Volume2 size={13} />
            <span>{t('音效库 ({0})', allSounds.length)}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('external')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
              activeTab === 'external' ? 'bg-seal text-white font-bold shadow-xs' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Tag size={13} />
            <span>
              {t(
                '外部注册 ({0})',
                components.filter((c) => c.source === 'external').length +
                  animations.filter((a) => a.source === 'external').length,
              )}
            </span>
          </button>
        </div>

        {(activeTab === 'all' || activeTab === 'components' || activeTab === 'external') && (
          <div className="flex items-center gap-1 text-[11px] font-medium">
            <span className="text-ink-faint mr-1">{t('组件类型：')}</span>
            {(
              [
                ['all', t('全部')],
                ['layout', t('布局容器')],
                ['content', t('核心内容')],
                ['interactive', t('交互测验')],
                ['visual', t('数据视觉')],
              ] as const
            ).map(([catKey, label]) => (
              <button
                key={catKey}
                type="button"
                onClick={() => setSubCategory(catKey)}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  subCategory === catKey
                    ? 'bg-card font-bold text-seal border border-seal/30 shadow-2xs'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 动态创作注册抽屉 */}
      {isCreating && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-6 border-b border-line bg-paper-deep/80 space-y-4 animate-in slide-in-from-top-3 duration-200 shrink-0 shadow-inner"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5 text-[13px] font-medium">
              <span className="font-bold text-ink-strong">{t('新建类型：')}</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="createKind"
                  checked={createKind === 'component'}
                  onChange={() => setCreateKind('component')}
                />
                <span className="text-ink">{t('教学组件 (UI Component)')}</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="createKind"
                  checked={createKind === 'animation'}
                  onChange={() => setCreateKind('animation')}
                />
                <span className="text-ink">{t('课堂动效 (Anime.js Animation)')}</span>
              </label>
            </div>
            {formError && <span className="text-[12px] text-red-500 font-medium">{formError}</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-ink-soft mb-1">
                {createKind === 'component' ? t('标签名 (以 ui- 或 x- 开头)') : t('动效动词 (verb)')}
              </label>
              <input
                type="text"
                required
                placeholder={createKind === 'component' ? 'ui-reaction' : 'spiral'}
                value={formTagOrVerb}
                onChange={(e) => setFormTagOrVerb(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-ink-soft mb-1">{t('展示名称')}</label>
              <input
                type="text"
                required
                placeholder={createKind === 'component' ? '化学反应展示卡' : '螺旋聚焦'}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-ink-soft mb-1">{t('简短说明')}</label>
              <input
                type="text"
                required
                placeholder={createKind === 'component' ? '展示反应方程与现象' : '带旋转缩放'}
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px]"
              />
            </div>
          </div>

          {createKind === 'component' ? (
            <div>
              <label className="block text-[11px] font-semibold text-ink-soft mb-1">
                {t('HTML 模板 (支持 {{title}}、{{content}} 插槽)')}
              </label>
              <textarea
                rows={3}
                placeholder='<div class="card-glass"><h4 class="card-ui-title">{{title}}</h4><div>{{content}}</div></div>'
                value={formTemplate}
                onChange={(e) => setFormTemplate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card border border-line text-[12px] font-mono leading-relaxed"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-ink-soft mb-1">
                  {t('关键帧 Keyframes (JSON)')}
                </label>
                <textarea
                  rows={3}
                  value={formKeyframes}
                  onChange={(e) => setFormKeyframes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-card border border-line text-[12px] font-mono leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-ink-soft mb-1">{t('时长 (ms)')}</label>
                <input
                  type="number"
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px]"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-4 py-1.5 rounded-xl bg-line/40 text-ink-soft text-[12px] hover:text-ink cursor-pointer"
            >
              {t('取消')}
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 rounded-xl bg-seal text-white font-bold text-[12px] hover:bg-seal-deep shadow-xs cursor-pointer active:scale-95"
            >
              {t('确认注册')}
            </button>
          </div>
        </form>
      )}

      {/* 主网格展示区 */}
      <div className="flex-1 p-5 md:p-7 max-w-[1720px] w-full mx-auto space-y-10">
        {/* 组件卡牌网格 */}
        {filteredComponents.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-seal" />
                <h2 className="text-[15px] font-bold text-ink-strong">{t('教学组件库 (UI Components)')}</h2>
              </div>
              <span className="text-[11.5px] text-ink-soft">{t('点击任意组件卡片进入详情与实时演练')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4.5">
              {filteredComponents.map((comp) => {
                const isExt = comp.source === 'external'
                const copyKey = `comp:${comp.tag}`

                return (
                  <div
                    key={comp.tag}
                    onClick={() => setSelectedTag(comp.tag)}
                    className="flex flex-col rounded-2xl bg-card border border-line/80 hover:border-seal/60 p-4.5 shadow-xs hover:shadow-xl transition-all duration-200 cursor-pointer group relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="font-mono text-[14px] font-bold text-seal tracking-tight group-hover:underline">
                        &lt;{comp.tag}&gt;
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isExt
                              ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                              : 'bg-seal/10 text-seal border border-seal/20'
                          }`}
                        >
                          {isExt ? t('外部注册') : t('内置')}
                        </span>
                        {isExt && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteComponent(e, comp.tag)}
                            title={t('注销组件')}
                            className="p-1 rounded-md text-ink-faint hover:text-red-500 transition cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="text-[14.5px] font-bold text-ink-strong mb-1">{comp.name}</h3>
                    <p className="text-[12px] text-ink-soft leading-relaxed line-clamp-2 mb-3.5">{comp.description}</p>

                    <div className="mb-3.5">
                      <ClassroomComponentPreview html={comp.example} mode="thumbnail" />
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px] text-ink-soft border-t border-line/40">
                      <button
                        type="button"
                        onClick={(e) => handleCopy(e, copyKey, comp.example)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-line/40 text-ink-soft hover:text-ink transition cursor-pointer"
                      >
                        {copiedId === copyKey ? (
                          <>
                            <Check size={12} className="text-emerald-500" />
                            <span className="text-emerald-500 font-medium">{t('已复制语法')}</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>{t('复制 DSL')}</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-1 text-seal font-semibold group-hover:translate-x-0.5 transition-transform">
                        <span>{t('查看详情')}</span>
                        <ArrowRight size={12} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* 动效卡牌网格 */}
        {filteredAnimations.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film size={16} className="text-sky-500" />
                <h2 className="text-[15px] font-bold text-ink-strong">{t('课堂动效库 (Anime.js Animations)')}</h2>
              </div>
              <span className="text-[11.5px] text-ink-soft">{t('原位点击试播实时动画与伴音')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4.5">
              {filteredAnimations.map((anim) => {
                const isExt = anim.source === 'external'
                const copyKey = `anim:${anim.verb}`

                return (
                  <div
                    key={anim.verb}
                    className="flex flex-col rounded-2xl bg-card border border-line/80 hover:border-sky-500/50 p-4.5 shadow-xs hover:shadow-md transition group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[14px] font-bold text-sky-600 dark:text-sky-400 tracking-tight">
                        {anim.verb}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {anim.recommendedSfx && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            ♪ {anim.recommendedSfx}
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isExt
                              ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                              : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20'
                          }`}
                        >
                          {isExt ? t('外部注册') : t('内置')}
                        </span>
                        {isExt && (
                          <button
                            type="button"
                            onClick={() => handleDeleteAnimation(anim.verb)}
                            title={t('注销动效')}
                            className="p-1 rounded-md text-ink-faint hover:text-red-500 transition cursor-pointer"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="text-[14.5px] font-bold text-ink-strong mb-1">{anim.name}</h3>
                    <p className="text-[12px] text-ink-soft leading-relaxed mb-4 flex-1">{anim.description}</p>

                    <div className="flex items-center justify-between p-3.5 rounded-2xl bg-paper-deep border border-line/60 mb-3">
                      <div className="flex-1 flex items-center justify-center min-h-[48px]">
                        <div
                          ref={(el) => {
                            animTargetsRef.current[anim.verb] = el
                          }}
                          className="px-4 py-2 rounded-xl bg-seal/15 text-seal font-bold text-[13px] border border-seal/30 select-none shadow-xs"
                        >
                          {anim.verb}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePlayAnimation(anim.verb, anim.recommendedSfx)}
                        className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-seal text-white hover:bg-seal-deep text-[11.5px] font-bold transition shadow-xs cursor-pointer active:scale-95 shrink-0"
                      >
                        <Play size={12} fill="currentColor" />
                        <span>{t('播放')}</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-ink-soft rounded-xl bg-line/30 px-3 py-1.5 font-mono">
                      <span className="truncate pr-2">{anim.example}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCopy(e, copyKey, anim.example)}
                        className="p-1 text-ink-faint hover:text-ink transition cursor-pointer shrink-0"
                        title={t('复制代码')}
                      >
                        {copiedId === copyKey ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* 音效库网格 */}
        {filteredSounds.length > 0 && (
          <ClassroomSfxSection sounds={filteredSounds} copiedId={copiedId} onCopy={handleCopy} />
        )}

        {filteredComponents.length === 0 && filteredAnimations.length === 0 && filteredSounds.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center select-none text-ink-faint space-y-3">
            <Layers size={42} className="opacity-35" />
            <p className="text-[14px] font-medium">{t('未检索到符合条件的组件、动效或音效')}</p>
            <p className="text-[12px]">{t('请尝试更换关键字或切换分类标签')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
