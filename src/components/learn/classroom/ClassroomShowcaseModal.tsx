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
import {
  X,
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
} from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomShowcaseModalProps {
  isOpen: boolean
  onClose: () => void
}

type TabCategory = 'all' | 'components' | 'animations' | 'external'

export default function ClassroomShowcaseModal({ isOpen, onClose }: ClassroomShowcaseModalProps) {
  const [activeTab, setActiveTab] = useState<TabCategory>('all')
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
  const [formKeyframes, setFormKeyframes] = useState('{\n  "scale": [0.8, 1],\n  "opacity": [0, 1]\n}')
  const [formDuration, setFormDuration] = useState('600')
  const [formError, setFormError] = useState<string | null>(null)

  // 动效卡片 DOM 引用字典，用于实时原位播放
  const animTargetsRef = useRef<Record<string, HTMLDivElement | null>>({})

  const components = useMemo(() => {
    // 强制依赖 revision 以便注册/注销后重读
    void revision
    return listClassroomComponents()
  }, [revision])

  const animations = useMemo(() => {
    void revision
    return listClassroomAnimations()
  }, [revision])

  // 复制示例代码到剪贴板
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  // 播放单项动效
  const handlePlayAnimation = (verb: string) => {
    const el = animTargetsRef.current[verb]
    if (!el) return
    runAnimeAnimation(el, verb)
  }

  // 注销外部组件
  const handleDeleteComponent = (tag: string) => {
    if (unregisterClassroomComponent(tag)) {
      setRevision((v) => v + 1)
    }
  }

  // 注销外部动效
  const handleDeleteAnimation = (verb: string) => {
    if (unregisterClassroomAnimation(verb)) {
      setRevision((v) => v + 1)
    }
  }

  // 提交新建
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (createKind === 'component') {
      const res = registerClassroomComponent({
        tag: formTagOrVerb,
        name: formName,
        description: formDesc,
        template: formTemplate || `<div class="p-3 border border-line rounded-xl">{{content}}</div>`,
      })
      if (!res.ok) {
        setFormError(res.message || '注册组件失败')
        return
      }
    } else {
      let parsedKeyframes: any = undefined
      if (formKeyframes.trim()) {
        try {
          parsedKeyframes = JSON.parse(formKeyframes)
        } catch {
          setFormError('关键帧 Keyframes 必须为合法 JSON 格式')
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
        setFormError(res.message || '注册动效失败')
        return
      }
    }

    // 重置并刷新
    setIsCreating(false)
    setFormTagOrVerb('')
    setFormName('')
    setFormDesc('')
    setFormTemplate('')
    setRevision((v) => v + 1)
  }

  // 过滤展示项
  const filteredComponents = useMemo(() => {
    let list = components
    if (activeTab === 'animations') return []
    if (activeTab === 'external') list = list.filter((c) => c.source === 'external')
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
  }, [components, activeTab, searchQuery])

  const filteredAnimations = useMemo(() => {
    let list = animations
    if (activeTab === 'components') return []
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-5xl h-[86vh] max-h-[820px] rounded-3xl bg-card border border-line shadow-2xl text-ink overflow-hidden animate-in zoom-in-95 duration-200">
        {/* 顶部标题栏 */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-line bg-paper-deep/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-seal/15 text-seal border border-seal/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-ink-strong">{t('课堂组件与动效库')}</h2>
              <p className="text-[12px] text-ink-soft">
                {t('网格卡牌展示、实时动画预览、语法复制与动态创作注册')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </header>

        {/* 工具与过滤条 */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-line/40 bg-card/80 shrink-0">
          {/* 分类标签 */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-line/30 text-[12px] font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-seal text-white font-bold shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t('全部 ({0})', components.length + animations.length)}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('components')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'components'
                  ? 'bg-seal text-white font-bold shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Layers size={13} />
              <span>{t('组件库 ({0})', components.length)}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('animations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'animations'
                  ? 'bg-seal text-white font-bold shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Film size={13} />
              <span>{t('动效库 ({0})', animations.length)}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('external')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                activeTab === 'external'
                  ? 'bg-seal text-white font-bold shadow-xs'
                  : 'text-ink-soft hover:text-ink'
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

          {/* 搜索与创作入口 */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-ink-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('搜索组件或动效...')}
                className="pl-8.5 pr-3 py-1.5 w-52 rounded-xl bg-paper border border-line text-[12px] text-ink focus:outline-none focus:border-seal transition"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsCreating(!isCreating)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-seal text-white hover:bg-seal-deep text-[12px] font-bold shadow-xs transition cursor-pointer"
            >
              <Plus size={14} />
              <span>{isCreating ? t('收起表单') : t('创作注册')}</span>
            </button>
          </div>
        </div>

        {/* 创作抽屉/表单 */}
        {isCreating && (
          <form
            onSubmit={handleCreateSubmit}
            className="p-5 border-b border-line bg-paper-deep/80 space-y-3.5 animate-in slide-in-from-top-3 duration-150 shrink-0"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-[13px] font-medium">
                <span className="font-bold text-ink-strong">{t('类型：')}</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="createKind"
                    checked={createKind === 'component'}
                    onChange={() => setCreateKind('component')}
                  />
                  <span>{t('教学组件 (UI Component)')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="createKind"
                    checked={createKind === 'animation'}
                    onChange={() => setCreateKind('animation')}
                  />
                  <span>{t('课堂动效 (Anime.js Animation)')}</span>
                </label>
              </div>
              {formError && <span className="text-[12px] text-red-500 font-medium">{formError}</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-ink-soft mb-1">
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
                <label className="block text-[11px] font-medium text-ink-soft mb-1">{t('展示名称')}</label>
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
                <label className="block text-[11px] font-medium text-ink-soft mb-1">{t('简短说明')}</label>
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
                <label className="block text-[11px] font-medium text-ink-soft mb-1">
                  {t('HTML 模板 (支持 {{title}}、{{content}} 插槽)')}
                </label>
                <textarea
                  rows={2}
                  placeholder='<div class="card-ui"><h4 class="font-bold">{{title}}</h4><div>{{content}}</div></div>'
                  value={formTemplate}
                  onChange={(e) => setFormTemplate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px] font-mono"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink-soft mb-1">
                    {t('关键帧 Keyframes (JSON)')}
                  </label>
                  <textarea
                    rows={2}
                    value={formKeyframes}
                    onChange={(e) => setFormKeyframes(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink-soft mb-1">
                    {t('时长 (ms)')}
                  </label>
                  <input
                    type="number"
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-card border border-line text-[12px]"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-4 py-1.5 rounded-xl bg-line/50 text-ink-soft text-[12px] hover:text-ink cursor-pointer"
              >
                {t('取消')}
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 rounded-xl bg-seal text-white font-bold text-[12px] hover:bg-seal-deep shadow-xs cursor-pointer"
              >
                {t('确认注册')}
              </button>
            </div>
          </form>
        )}

        {/* 卡牌网格主展示区 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
            {/* 组件卡片 */}
            {filteredComponents.map((comp) => {
              const isExt = comp.source === 'external'
              const copyKey = `comp:${comp.tag}`
              return (
                <div
                  key={comp.tag}
                  className="flex flex-col rounded-2xl bg-paper border border-line/70 hover:border-seal/40 p-4 shadow-xs transition hover:shadow-md group relative"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[13px] font-bold text-seal tracking-tight">
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
                          onClick={() => handleDeleteComponent(comp.tag)}
                          title={t('注销组件')}
                          className="p-1 rounded-md text-ink-faint hover:text-red-500 transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  <h4 className="text-[14px] font-bold text-ink-strong mb-1">{comp.name}</h4>
                  <p className="text-[12px] text-ink-soft leading-relaxed flex-1 mb-3">
                    {comp.description}
                  </p>

                  {/* 语法示例与复制 */}
                  <div className="rounded-xl bg-card border border-line/60 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-ink-faint font-medium">
                      <span>{t('DSL 语法示例')}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(copyKey, comp.example)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-line/40 text-ink-soft hover:text-ink transition cursor-pointer"
                      >
                        {copiedId === copyKey ? (
                          <>
                            <Check size={11} className="text-emerald-500" />
                            <span className="text-emerald-500">{t('已复制')}</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} />
                            <span>{t('复制')}</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-ink-strong overflow-x-auto whitespace-pre p-1">
                      {comp.example}
                    </pre>
                  </div>
                </div>
              )
            })}

            {/* 动效卡片 */}
            {filteredAnimations.map((anim) => {
              const isExt = anim.source === 'external'
              const copyKey = `anim:${anim.verb}`
              return (
                <div
                  key={anim.verb}
                  className="flex flex-col rounded-2xl bg-paper border border-line/70 hover:border-seal/40 p-4 shadow-xs transition hover:shadow-md group relative"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[13px] font-bold text-sky-600 dark:text-sky-400 tracking-tight">
                      {anim.verb}
                    </span>
                    <div className="flex items-center gap-1.5">
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

                  <h4 className="text-[14px] font-bold text-ink-strong mb-1">{anim.name}</h4>
                  <p className="text-[12px] text-ink-soft leading-relaxed mb-3">{anim.description}</p>

                  {/* 实时动画交互测试视口 */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-line/60 mb-3">
                    <div className="flex-1 flex items-center justify-center min-h-[44px]">
                      <div
                        ref={(el) => {
                          animTargetsRef.current[anim.verb] = el
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-seal/15 text-seal font-bold text-[12px] border border-seal/30 select-none shadow-xs"
                      >
                        {anim.verb}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePlayAnimation(anim.verb)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-seal text-white hover:bg-seal-deep text-[11.5px] font-bold transition shadow-xs cursor-pointer active:scale-95 shrink-0"
                    >
                      <Play size={12} fill="currentColor" />
                      <span>{t('播放')}</span>
                    </button>
                  </div>

                  {/* 语法与复制 */}
                  <div className="flex items-center justify-between text-[11px] text-ink-soft rounded-lg bg-line/30 px-2.5 py-1 font-mono">
                    <span className="truncate pr-2">{anim.example}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(copyKey, anim.example)}
                      className="p-1 text-ink-faint hover:text-ink transition cursor-pointer shrink-0"
                      title={t('复制代码')}
                    >
                      {copiedId === copyKey ? (
                        <Check size={12} className="text-emerald-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {filteredComponents.length === 0 && filteredAnimations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center select-none text-ink-faint space-y-2">
              <Layers size={36} className="opacity-40" />
              <p className="text-[13px]">{t('没有找到符合条件的组件或动效')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
