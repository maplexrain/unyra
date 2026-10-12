import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Code,
  Edit3,
  FolderOpen,
  GraduationCap,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react'
import type { SkillCategory, SkillDef, SkillSettings } from '../../agent/skill/types'
import {
  deleteSkillFromDisk,
  getLoadedSkills,
  getSkillsAbsPath,
  loadSkillsFromDisk,
  revealSkillsDir,
  saveSkillToDisk,
  subscribeSkills,
  toggleSkillOnDisk,
} from '../../agent/skill/fs'
import ConfirmDialog from '../ConfirmDialog'
import Switch from '../Switch'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface SkillsTabProps {
  settings?: SkillSettings
  onChange: (next: SkillSettings) => void
}

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  learning: '启发学习',
  coding: '代码重构',
  research: '学术研究',
  productivity: '效率工具',
  general: '通用能力',
}

const CATEGORY_ICONS: Record<SkillCategory, typeof Sparkles> = {
  learning: GraduationCap,
  coding: Code,
  research: BookOpen,
  productivity: Wrench,
  general: Sparkles,
}

export function SkillsTab({ settings, onChange }: SkillsTabProps) {
  // 订阅独立技能目录的响应式快照
  const skillsList = useSyncExternalStore(subscribeSkills, getLoadedSkills)

  const [filter, setFilter] = useState<'all' | SkillCategory | 'custom'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingSkill, setEditingSkill] = useState<SkillDef | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [deletingSkill, setDeletingSkill] = useState<SkillDef | null>(null)
  const [skillsAbsPath, setSkillsAbsPath] = useState<string>('')
  const [isScanning, setIsScanning] = useState(false)

  // 全局总开关
  const globalEnabled = settings?.enabled !== false

  useEffect(() => {
    // 首次加载初始化并扫描物理磁盘上的技能目录
    void loadSkillsFromDisk()
    void getSkillsAbsPath().then(setSkillsAbsPath)
  }, [])

  const handleRefresh = async () => {
    setIsScanning(true)
    try {
      await loadSkillsFromDisk()
      const abs = await getSkillsAbsPath()
      setSkillsAbsPath(abs)
    } finally {
      setIsScanning(false)
    }
  }

  const handleToggle = async (skill: SkillDef) => {
    await toggleSkillOnDisk(skill.id, !skill.enabled)
    // 保持同步到 settings 供外部监听
    const nextList = getLoadedSkills()
    onChange({
      enabled: globalEnabled,
      skills: nextList,
    })
  }

  const handleSaveSkill = async (saved: SkillDef) => {
    await saveSkillToDisk(saved)
    setIsCreating(false)
    setEditingSkill(null)
    onChange({
      enabled: globalEnabled,
      skills: getLoadedSkills(),
    })
  }

  const handleDeleteSkill = async (id: string) => {
    await deleteSkillFromDisk(id)
    setDeletingSkill(null)
    onChange({
      enabled: globalEnabled,
      skills: getLoadedSkills(),
    })
  }

  const filteredSkills = skillsList.filter((s) => {
    if (filter === 'all') return true
    if (filter === 'custom') return !s.builtin
    return s.category === filter
  })

  const activeCount = skillsList.filter((s) => s.enabled).length

  return (
    <div className={pane(4)}>
      {/* 顶部概览与全局状态卡片 */}
      <section className="relative overflow-hidden rounded-2xl border border-line-strong/60 bg-gradient-to-br from-card via-card to-paper-deep/50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-seal/10 text-seal">
                <GraduationCap size={15} />
              </span>
              <h3 className="text-[14px] font-semibold text-ink-strong">{t('专业技能扩展 (Skills)')}</h3>
              <span className="rounded-full bg-seal/15 px-2 py-0.5 text-[11px] font-medium text-seal-deep">
                {t('已激活 {0} / {1}', activeCount, skillsList.length)}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
              {t('每个技能均为磁盘上的独立目录（包含 SKILL.md）。启用的技能将作为系统认知规范注入导师上下文。')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isScanning}
              title={t('重新扫描本地磁盘技能目录')}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-paper px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={13} className={isScanning ? 'animate-spin text-seal' : ''} />
              {t('重新扫描')}
            </button>
            <button
              type="button"
              onClick={() => void revealSkillsDir()}
              title={t('在系统文件管理器中打开技能根目录')}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-paper px-2.5 py-1.5 text-[12px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink"
            >
              <FolderOpen size={13} className="text-seal" />
              {t('打开技能目录')}
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1.5 rounded-xl border border-seal/30 bg-seal/10 px-3 py-1.5 text-[12px] font-medium text-seal-deep transition hover:bg-seal/15"
            >
              <Plus size={14} />
              {t('新建独立技能')}
            </button>
          </div>
        </div>

        {/* 物理路径信息提示条 */}
        {skillsAbsPath && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-line/60 bg-paper/60 px-3 py-1.5 text-[11px] text-ink-faint">
            <div className="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
              <span className="font-medium text-ink-soft">{t('物理存储路径:')}</span>
              <code className="select-all rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
                {skillsAbsPath}
              </code>
            </div>
            <button
              type="button"
              onClick={() => void revealSkillsDir()}
              className="shrink-0 text-seal transition hover:underline"
            >
              {t('定位')}
            </button>
          </div>
        )}

        <div className="mt-3.5 border-t border-line/60 pt-3">
          <Switch
            on={globalEnabled}
            onChange={(next) => onChange({ enabled: next, skills: skillsList })}
            label={t('启用技能系统')}
            hint={t('总开关关掉后，所有技能指令将不再注入系统提示词')}
          />
        </div>
      </section>

      {/* 过滤标签分类栏 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
            filter === 'all'
              ? 'bg-ink text-paper'
              : 'bg-card text-ink-soft hover:bg-line/60 hover:text-ink'
          }`}
        >
          {t('全部 ({0})', skillsList.length)}
        </button>
        {(['learning', 'coding', 'research'] as SkillCategory[]).map((cat) => {
          const count = skillsList.filter((s) => s.category === cat).length
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFilter(cat)}
              className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
                filter === cat
                  ? 'bg-seal text-white'
                  : 'bg-card text-ink-soft hover:bg-line/60 hover:text-ink'
              }`}
            >
              {t(CATEGORY_LABELS[cat])} ({count})
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setFilter('custom')}
          className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition ${
            filter === 'custom'
              ? 'bg-seal-deep text-white'
              : 'bg-card text-ink-soft hover:bg-line/60 hover:text-ink'
          }`}
        >
          {t('自定义 ({0})', skillsList.filter((s) => !s.builtin).length)}
        </button>
      </div>

      {/* 技能列表 */}
      <div className="flex flex-col gap-2.5">
        {filteredSkills.map((skill) => {
          const isExpanded = expandedId === skill.id
          const CategoryIcon = skill.category ? CATEGORY_ICONS[skill.category] || Sparkles : Sparkles

          return (
            <div
              key={skill.id}
              className={`overflow-hidden rounded-xl border transition-all duration-200 ${
                skill.enabled
                  ? 'border-line-strong/80 bg-card shadow-sm'
                  : 'border-line/60 bg-card/60 opacity-75'
              }`}
            >
              <div className="flex items-start gap-3 p-3.5">
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition ${
                    skill.enabled
                      ? 'bg-seal/15 text-seal-deep'
                      : 'bg-paper-deep text-ink-faint'
                  }`}
                >
                  <CategoryIcon size={17} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-strong">{skill.name}</span>
                    <button
                      type="button"
                      onClick={() => void revealSkillsDir(skill.id)}
                      title={t('点击在文件管理器中定位该技能目录: skills/{0}/', skill.id)}
                      className="group flex items-center gap-1 rounded-md border border-line/80 bg-paper-deep/70 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft transition hover:border-seal/40 hover:bg-seal/5 hover:text-seal-deep"
                    >
                      <FolderOpen size={10.5} className="text-seal group-hover:scale-110 transition-transform" />
                      <span>skills/{skill.id}/</span>
                    </button>
                    {skill.builtin ? (
                      <span className="rounded-md border border-line bg-paper-deep/60 px-1.5 py-0.5 text-[10px] text-ink-soft">
                        {t('内置')}
                      </span>
                    ) : (
                      <span className="rounded-md border border-seal/20 bg-seal/10 px-1.5 py-0.5 text-[10px] font-medium text-seal-deep">
                        {t('自定义')}
                      </span>
                    )}
                    {skill.category && (
                      <span className="rounded-md bg-line/40 px-1.5 py-0.5 text-[10px] text-ink-soft">
                        {t(CATEGORY_LABELS[skill.category])}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{skill.description}</p>

                  {skill.tags && skill.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {skill.tags.map((tag) => (
                        <span key={tag} className="rounded bg-paper-deep px-1.5 py-px text-[10px] text-ink-faint">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={skill.enabled}
                    onClick={() => void handleToggle(skill)}
                    title={skill.enabled ? t('点击禁用此技能') : t('点击启用此技能')}
                    className={`relative h-[20px] w-9 rounded-full transition-colors duration-200 ${
                      skill.enabled ? 'bg-seal' : 'bg-line-strong/60'
                    }`}
                  >
                    <span
                      className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
                        skill.enabled ? 'left-[18px]' : 'left-[2px]'
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => void revealSkillsDir(skill.id)}
                    title={t('在文件管理器中定位此技能文件夹')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/50 hover:text-seal-deep"
                  >
                    <FolderOpen size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : skill.id)}
                    title={isExpanded ? t('收起指引') : t('查看指令详情')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/50 hover:text-ink"
                  >
                    {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingSkill(skill)}
                    title={t('编辑 SKILL.md')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/50 hover:text-ink"
                  >
                    <Edit3 size={13} />
                  </button>

                  {!skill.builtin && (
                    <button
                      type="button"
                      onClick={() => setDeletingSkill(skill)}
                      title={t('删除此技能目录')}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-seal/10 hover:text-seal-deep"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* 展开查看指令详情 */}
              {isExpanded && (
                <div className="border-t border-line/60 bg-paper-deep/40 p-3.5">
                  <div className="flex items-center justify-between pb-1.5">
                    <span className="text-[11px] font-medium text-ink-faint">
                      {t('SKILL.md 核心指引 (System Instructions)')}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-ink-faint">
                        {skill.instructions.length} {t('字')}
                      </span>
                      <button
                        type="button"
                        onClick={() => void revealSkillsDir(skill.id)}
                        className="text-[10.5px] text-seal transition hover:underline"
                      >
                        {t('打开 SKILL.md 所在目录')}
                      </button>
                    </div>
                  </div>
                  <pre className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
                    {skill.instructions}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 创建或编辑技能弹窗 */}
      {(isCreating || editingSkill) && (
        <SkillEditModal
          skill={editingSkill}
          onSave={handleSaveSkill}
          onClose={() => {
            setIsCreating(false)
            setEditingSkill(null)
          }}
        />
      )}

      {/* 删除确认弹窗 */}
      {deletingSkill && (
        <ConfirmDialog
          title={t('删除技能目录「skills/{0}/」？', deletingSkill.id)}
          message={t('将物理删除该技能文件夹及其包含的 SKILL.md，该操作无法撤销。')}
          confirmLabel={t('确认删除')}
          onConfirm={() => void handleDeleteSkill(deletingSkill.id)}
          onCancel={() => setDeletingSkill(null)}
        />
      )}
    </div>
  )
}

function SkillEditModal({
  skill,
  onSave,
  onClose,
}: {
  skill: SkillDef | null
  onSave: (skill: SkillDef) => void
  onClose: () => void
}) {
  const isEditing = !!skill
  const [id, setId] = useState(skill?.id || '')
  const [name, setName] = useState(skill?.name || '')
  const [description, setDescription] = useState(skill?.description || '')
  const [category, setCategory] = useState<SkillCategory>(skill?.category || 'general')
  const [tagsStr, setTagsStr] = useState(skill?.tags ? skill.tags.join(', ') : '')
  const [instructions, setInstructions] = useState(
    skill?.instructions ||
      `## 技能规范\n1. **核心原则**：请在处理该领域任务时严格遵循以下原则与步骤。\n2. **输出约束**：保持结论严谨，提供清晰的推导与落地样例。`,
  )

  const handleSave = () => {
    if (!name.trim()) return
    const safeId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || `custom-skill-${Date.now()}`
    const tags = tagsStr
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)

    onSave({
      id: safeId,
      name: name.trim(),
      description: description.trim(),
      category,
      tags,
      instructions: instructions.trim(),
      enabled: skill ? skill.enabled : true,
      builtin: skill ? skill.builtin : false,
      updatedAt: Date.now(),
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="flex max-h-[90vh] w-full max-w-[580px] flex-col rounded-2xl border border-line-strong bg-card shadow-2xl overflow-hidden">
        <header className="border-b border-line bg-paper-deep/60 px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-ink-strong">
            {isEditing ? t('编辑 SKILL.md: skills/{0}/', skill.id) : t('新建独立技能 (New Skill)')}
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {t('技能将作为独立目录落地至磁盘，内含带有标准 YAML Frontmatter 的 SKILL.md 文件。')}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-ink-soft mb-1">
                {t('目录名 / 标识 (ID)')}
              </label>
              <input
                type="text"
                disabled={isEditing}
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder={t('例如：deep-thinking')}
                className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 font-mono text-[12px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15 disabled:bg-paper-deep disabled:text-ink-faint"
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('展示名称')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('例如：深度批判思考师')}
                className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('所属分类')}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SkillCategory)}
                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink-soft outline-none focus:border-seal/60"
              >
                <option value="general">{t('通用能力')}</option>
                <option value="learning">{t('启发学习')}</option>
                <option value="coding">{t('代码重构')}</option>
                <option value="research">{t('学术研究')}</option>
                <option value="productivity">{t('效率工具')}</option>
              </select>
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('标签 (逗号分隔)')}</label>
              <input
                type="text"
                value={tagsStr}
                onChange={(e) => setTagsStr(e.target.value)}
                placeholder={t('导学, 逻辑, 批判思考')}
                className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-strong outline-none focus:border-seal/60"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11.5px] font-medium text-ink-soft mb-1">{t('简明描述')}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('一句话说明该技能的核心作用')}
              className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-strong outline-none focus:border-seal/60"
            />
          </div>

          <div>
            <div className="flex items-center justify-between pb-1">
              <label className="block text-[11.5px] font-medium text-ink-soft">
                {t('SKILL.md 指令内容 (Markdown Instructions)')}
              </label>
              <span className="font-mono text-[10.5px] text-ink-faint">
                skills/{id || '[id]'}/SKILL.md
              </span>
            </div>
            <textarea
              rows={9}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t('写下详细的步骤、约束与输出规范…')}
              className="w-full rounded-lg border border-line bg-paper p-3 font-mono text-[11.5px] leading-relaxed text-ink-strong outline-none focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-paper-deep/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            disabled={!name.trim() || (!isEditing && !id.trim())}
            onClick={handleSave}
            className="rounded-xl bg-seal px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:opacity-40"
          >
            {t('保存至磁盘')}
          </button>
        </footer>
      </div>
    </div>
  )
}
