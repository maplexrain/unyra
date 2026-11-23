/**
 * 设置 → 文档设计 (一级页签面板)
 *
 * 文档结构化排版组件库与管理面板：
 * 1. 浏览 9 个内置出版级排版配方组件（提示框、正误辨析、公式解剖、步骤轴、推导链、指标看板、术语名片等）
 * 2. 直观展示组件渲染后的实际出版级样式（纸墨风美学、语义色、直角骨骼感）供人类与智能体参考
 * 3. 动态注册、修改、删除外部自定义配方组件（本地持久化与实时响应）
 */

import { useEffect, useState, useMemo } from 'react'
import {
  Copy,
  Check,
  Edit3,
  Eye,
  FileCode,
  Layers,
  Plus,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import {
  listDocumentComponents,
  registerDocumentComponent,
  updateDocumentComponent,
  deleteDocumentComponent,
  onDocumentComponentsChange,
  renderComponentPreview,
  type DocumentComponentDef,
} from '../../lib/componentBlock'
import { t } from '../../i18n'
import { pane } from '../Pane'

interface Props {
  onToast: (msg: string) => void
}

interface EditFormState {
  isEditing: boolean
  isNew: boolean
  id: string
  tag: string
  name: string
  description: string
  category: DocumentComponentDef['category']
  template: string
  example: string
  slotsStr: string
  attrsStr: string
}

const EMPTY_FORM: EditFormState = {
  isEditing: false,
  isNew: true,
  id: '',
  tag: '',
  name: '',
  description: '',
  category: 'custom',
  template: '',
  example: '',
  slotsStr: 'title: 标题插槽\ndescribe: 内容插槽',
  attrsStr: 'type: 语义色系类型(warn|seal|ok|sky)',
}

export function DocDesignPanel({ onToast }: Props) {
  const [components, setComponents] = useState<DocumentComponentDef[]>(() => listDocumentComponents())
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'builtin' | 'external'>('all')
  const [viewingComponent, setViewingComponent] = useState<DocumentComponentDef | null>(null)
  const [form, setForm] = useState<EditFormState>(EMPTY_FORM)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 每张卡片的展示模式：'preview' (渲染样式) 或 'code' (源码)
  const [cardModes, setCardModes] = useState<Record<string, 'preview' | 'code'>>({})

  useEffect(() => {
    const unsub = onDocumentComponentsChange(() => {
      setComponents(listDocumentComponents())
    })
    return unsub
  }, [])

  // 过滤后的组件列表
  const filtered = useMemo(() => {
    return components.filter((item) => {
      if (sourceFilter === 'builtin' && item.source !== 'builtin') return false
      if (sourceFilter === 'external' && item.source !== 'external') return false
      if (query.trim()) {
        const q = query.toLowerCase()
        return (
          item.tag.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [components, sourceFilter, query])

  const toggleCardMode = (id: string, mode: 'preview' | 'code') => {
    setCardModes((prev) => ({ ...prev, [id]: mode }))
  }

  const handleCopyExample = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    onToast(t('组件示例已复制到剪贴板'))
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }

  const handleStartCreate = () => {
    setForm({
      ...EMPTY_FORM,
      isEditing: true,
      isNew: true,
      example: `<CustomNotice type="seal">\n  <div #title>核心结论</div>\n  <div #describe>详细内容说明</div>\n</CustomNotice>`,
      template: `<div class="my-3 border border-line bg-card p-4">\n  <h4 class="m-0 text-seal font-semibold">{{title}}</h4>\n  <p class="mt-2 text-ink">{{describe}}</p>\n</div>`,
    })
  }

  const handleStartEdit = (c: DocumentComponentDef) => {
    const slotsStr = (c.slots || []).map((s) => `${s.name}: ${s.description}`).join('\n')
    const attrsStr = (c.attrs || []).map((a) => `${a.name}: ${a.description}`).join('\n')
    setForm({
      isEditing: true,
      isNew: false,
      id: c.id,
      tag: c.tag,
      name: c.name,
      description: c.description,
      category: c.category,
      template: c.template || '',
      example: c.example || '',
      slotsStr,
      attrsStr,
    })
  }

  const handleDelete = (c: DocumentComponentDef) => {
    if (confirm(t('确定要删除外部组件「{0}」({1}) 吗？', c.name, c.tag))) {
      const res = deleteDocumentComponent(c.id)
      if (res.ok) {
        onToast(t('组件已成功删除'))
        if (viewingComponent?.id === c.id) {
          setViewingComponent(null)
        }
      } else {
        onToast(res.error || t('删除组件失败'))
      }
    }
  }

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.tag.trim()) {
      onToast(t('组件标签不能为空'))
      return
    }
    if (!form.name.trim()) {
      onToast(t('组件名称不能为空'))
      return
    }

    const slots = form.slotsStr
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, ...rest] = l.split(':')
        return { name: n.trim(), description: rest.join(':').trim() }
      })

    const attrs = form.attrsStr
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, ...rest] = l.split(':')
        return { name: n.trim(), description: rest.join(':').trim() }
      })

    if (form.isNew) {
      const res = registerDocumentComponent({
        tag: form.tag.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        template: form.template.trim(),
        example: form.example.trim(),
        slots,
        attrs,
      })
      if (res.ok) {
        onToast(t('组件注册成功'))
        setForm(EMPTY_FORM)
      } else {
        onToast(res.error || t('注册组件失败'))
      }
    } else {
      const res = updateDocumentComponent(form.id, {
        tag: form.tag.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        template: form.template.trim(),
        example: form.example.trim(),
        slots,
        attrs,
      })
      if (res.ok) {
        onToast(t('组件更新成功'))
        setForm(EMPTY_FORM)
      } else {
        onToast(res.error || t('更新组件失败'))
      }
    }
  }

  return (
    <div className={pane(4, true)}>
      {/* 头部控制栏 */}
      <section className="space-y-4 rounded-xl border border-line bg-card/60 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-seal" />
              <h3 className="text-base font-semibold text-ink-strong">{t('文档组件设计与管理')}</h3>
              <span className="rounded bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                {components.length} {t('个已注册组件')}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              {t(
                '教学智能体编写讲义正文时调用的结构化排版配方库。卡片内直接展示渲染样式供参考对照。',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleStartCreate}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg bg-seal px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-seal/90 transition-colors"
          >
            <Plus size={14} />
            <span>{t('注册新组件')}</span>
          </button>
        </div>

        {/* 筛选与搜索栏 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('按组件名称、标签 (如 Notice) 或描述检索...')}
              className="w-full rounded-lg border border-line bg-sunken/40 pl-8 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken/30 p-1 text-xs">
            <button
              type="button"
              onClick={() => setSourceFilter('all')}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                sourceFilter === 'all'
                  ? 'bg-card text-ink-strong shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t('全部 ({0})', components.length)}
            </button>
            <button
              type="button"
              onClick={() => setSourceFilter('builtin')}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                sourceFilter === 'builtin'
                  ? 'bg-card text-ink-strong shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t('内置配方 ({0})', components.filter((c) => c.source === 'builtin').length)}
            </button>
            <button
              type="button"
              onClick={() => setSourceFilter('external')}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                sourceFilter === 'external'
                  ? 'bg-card text-ink-strong shadow-xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t('外部扩展 ({0})', components.filter((c) => c.source === 'external').length)}
            </button>
          </div>
        </div>
      </section>

      {/* 组件列表（采用双列响应式网格，为渲染后的双栏与推导链组件留足横向展示空间） */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filtered.map((c) => {
          const isBuiltin = c.source === 'builtin'
          const currentMode = cardModes[c.id] ?? 'preview'
          const renderedHtml = renderComponentPreview(c.example)

          return (
            <div
              key={c.id}
              className="flex flex-col justify-between rounded-xl border border-line bg-card/70 p-4 transition hover:border-line-strong hover:shadow-xs"
            >
              <div>
                {/* 卡片顶栏 */}
                <div className="flex items-start justify-between gap-2 border-b border-line/60 pb-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-semibold text-seal bg-seal/10 px-2 py-0.5 rounded">
                      &lt;{c.tag}&gt;
                    </span>
                    <span className="text-sm font-semibold text-ink-strong">{c.name}</span>
                    {isBuiltin ? (
                      <span className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-[10px] text-ink-soft font-medium">
                        <ShieldCheck size={11} className="text-ok" />
                        {t('内置')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 text-amber-600 px-1.5 py-0.5 text-[10px] font-medium">
                        {t('外部自定义')}
                      </span>
                    )}
                  </div>

                  {/* 预览 / 源码切换胶囊 */}
                  <div className="flex items-center rounded-md border border-line bg-sunken/40 p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => toggleCardMode(c.id, 'preview')}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded transition ${
                        currentMode === 'preview'
                          ? 'bg-card font-medium text-seal shadow-xs'
                          : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <Eye size={10} />
                      <span>{t('渲染样式')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCardMode(c.id, 'code')}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded transition ${
                        currentMode === 'code'
                          ? 'bg-card font-medium text-seal shadow-xs'
                          : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <FileCode size={10} />
                      <span>{t('围栏代码')}</span>
                    </button>
                  </div>
                </div>

                {/* 描述 */}
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                  {c.description}
                </p>

                {/* 视觉呈现区域：实际渲染样式 或 围栏源码 */}
                <div className="mt-3 overflow-hidden rounded-lg border border-line bg-paper/50 p-3 min-h-[120px] flex flex-col justify-center">
                  {currentMode === 'preview' ? (
                    <div
                      className="component-live-preview [&_.my-5]:my-1.5 [&_.my-6]:my-2 [&_.my-4]:my-1.5"
                      dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                  ) : (
                    <pre className="m-0 p-2 text-[11px] font-mono text-ink-soft overflow-x-auto whitespace-pre-wrap rounded bg-sunken/40">
                      {`\`\`\`component\n${c.example}\n\`\`\``}
                    </pre>
                  )}
                </div>
              </div>

              {/* 卡片底栏操作 */}
              <div className="mt-3.5 flex items-center justify-between border-t border-line/60 pt-2.5 text-xs text-ink-soft">
                <button
                  type="button"
                  onClick={() => setViewingComponent(c)}
                  className="inline-flex items-center gap-1 hover:text-seal font-medium transition-colors"
                >
                  <FileCode size={13} />
                  <span>{t('查看完整签名与插槽')}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyExample(c.example, c.id)}
                    title={t('复制组件用法示例')}
                    className="inline-flex items-center gap-1 px-2 py-1 hover:text-ink rounded hover:bg-sunken text-[11px] font-medium transition-colors"
                  >
                    {copiedId === c.id ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                    <span>{copiedId === c.id ? t('已复制') : t('复制示例')}</span>
                  </button>

                  {!isBuiltin && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(c)}
                        title={t('编辑')}
                        className="p-1 hover:text-ink rounded hover:bg-sunken transition-colors"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        title={t('删除')}
                        className="p-1 hover:text-warn rounded hover:bg-warn/10 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center text-xs text-ink-faint border border-dashed border-line rounded-lg">
          {t('没有匹配的排版组件')}
        </div>
      )}

      {/* 查看详情 / 签名弹窗 */}
      {viewingComponent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div
            className={`w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border border-line bg-card shadow-xl overflow-hidden ${pane}`}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-seal bg-seal/10 px-2 py-0.5 rounded">
                  &lt;{viewingComponent.tag}&gt;
                </span>
                <span className="font-semibold text-sm text-ink-strong">
                  {viewingComponent.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingComponent(null)}
                className="text-ink-faint hover:text-ink p-1 rounded"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div>
                <span className="text-ink-faint font-medium">{t('作用描述')}</span>
                <p className="mt-1 text-ink">{viewingComponent.description}</p>
              </div>

              {/* 渲染样式效果 */}
              <div>
                <span className="text-ink-faint font-medium">{t('实际出版级样式呈现')}</span>
                <div
                  className="mt-1.5 p-3 rounded-lg border border-line bg-paper/60 [&_.my-5]:my-1.5 [&_.my-6]:my-2"
                  dangerouslySetInnerHTML={{ __html: renderComponentPreview(viewingComponent.example) }}
                />
              </div>

              {viewingComponent.attrs && viewingComponent.attrs.length > 0 && (
                <div>
                  <span className="text-ink-faint font-medium">{t('支持属性 (Attrs)')}</span>
                  <div className="mt-1 space-y-1">
                    {viewingComponent.attrs.map((a) => (
                      <div key={a.name} className="flex items-baseline gap-2 bg-sunken/40 p-1.5 rounded">
                        <span className="font-mono font-medium text-seal">{a.name}</span>
                        <span className="text-ink-soft">{a.description}</span>
                        {a.default && <span className="text-ink-faint text-[10px]">({t('默认')}: {a.default})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewingComponent.slots && viewingComponent.slots.length > 0 && (
                <div>
                  <span className="text-ink-faint font-medium">{t('支持插槽 (Slots)')}</span>
                  <div className="mt-1 space-y-1">
                    {viewingComponent.slots.map((s) => (
                      <div key={s.name} className="flex items-baseline gap-2 bg-sunken/40 p-1.5 rounded">
                        <span className="font-mono font-medium text-ink-strong">#{s.name}</span>
                        <span className="text-ink-soft">{s.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-faint font-medium">{t('```component 用法示例')}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyExample(viewingComponent.example, viewingComponent.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-seal hover:underline font-medium"
                  >
                    <Copy size={11} />
                    <span>{t('复制示例')}</span>
                  </button>
                </div>
                <pre className="mt-1 p-2.5 rounded bg-sunken/80 border border-line text-[11px] font-mono text-ink overflow-x-auto whitespace-pre-wrap">
                  {`\`\`\`component\n${viewingComponent.example}\n\`\`\``}
                </pre>
              </div>

              {viewingComponent.template && (
                <div>
                  <span className="text-ink-faint font-medium">{t('底层 HTML 渲染模板')}</span>
                  <pre className="mt-1 p-2.5 rounded bg-sunken/80 border border-line text-[11px] font-mono text-ink-soft overflow-x-auto whitespace-pre-wrap">
                    {viewingComponent.template}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-line px-5 py-3">
              <button
                type="button"
                onClick={() => setViewingComponent(null)}
                className="rounded-lg border border-line px-3 py-1 text-xs text-ink hover:bg-sunken transition-colors"
              >
                {t('关闭')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建 / 编辑组件弹窗 */}
      {form.isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleSaveForm}
            className={`w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-line bg-card shadow-xl overflow-hidden ${pane}`}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-seal" />
                <span className="font-semibold text-sm text-ink-strong">
                  {form.isNew ? t('注册新文档配方组件') : t('编辑文档配方组件')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setForm(EMPTY_FORM)}
                className="text-ink-faint hover:text-ink p-1 rounded"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ink-soft font-medium mb-1">
                    {t('标签名 (Tag)')} <span className="text-seal">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.tag}
                    onChange={(e) => setForm({ ...form, tag: e.target.value })}
                    placeholder="Notice"
                    className="w-full rounded border border-line bg-sunken/40 px-2.5 py-1.5 text-xs text-ink font-mono focus:border-line-strong focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-ink-soft font-medium mb-1">
                    {t('显示名称')} <span className="text-seal">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('提示卡片')}
                    className="w-full rounded border border-line bg-sunken/40 px-2.5 py-1.5 text-xs text-ink focus:border-line-strong focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-ink-soft font-medium mb-1">
                  {t('作用描述')} <span className="text-seal">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('简要说明组件用途，用于动态查询时节省上下文')}
                  className="w-full rounded border border-line bg-sunken/40 px-2.5 py-1.5 text-xs text-ink focus:border-line-strong focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-ink-soft font-medium mb-1">
                  {t('插槽定义 (每行一个: slotName: 描述)')}
                </label>
                <textarea
                  rows={2}
                  value={form.slotsStr}
                  onChange={(e) => setForm({ ...form, slotsStr: e.target.value })}
                  placeholder="title: 眉标标题&#10;describe: 说明内容"
                  className="w-full rounded border border-line bg-sunken/40 p-2 text-xs font-mono text-ink focus:border-line-strong focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-ink-soft font-medium mb-1">
                  {t('属性定义 (每行一个: attrName: 描述)')}
                </label>
                <textarea
                  rows={2}
                  value={form.attrsStr}
                  onChange={(e) => setForm({ ...form, attrsStr: e.target.value })}
                  placeholder="type: 语义类型"
                  className="w-full rounded border border-line bg-sunken/40 p-2 text-xs font-mono text-ink focus:border-line-strong focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-ink-soft font-medium mb-1">
                  {t('HTML 模板 (支持 {{slot}} 与 {{attr}} 插值)')}
                </label>
                <textarea
                  rows={3}
                  value={form.template}
                  onChange={(e) => setForm({ ...form, template: e.target.value })}
                  placeholder={`<div class="my-4 border border-line p-3">{{title}}<div>{{describe}}</div></div>`}
                  className="w-full rounded border border-line bg-sunken/40 p-2 text-xs font-mono text-ink focus:border-line-strong focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-ink-soft font-medium mb-1">
                  {t('用法示例 (用于 ```component 围栏与示例展示)')}
                </label>
                <textarea
                  rows={3}
                  value={form.example}
                  onChange={(e) => setForm({ ...form, example: e.target.value })}
                  placeholder={`<Notice>\n  <div #title>标题</div>\n  <div #describe>内容</div>\n</Notice>`}
                  className="w-full rounded border border-line bg-sunken/40 p-2 text-xs font-mono text-ink focus:border-line-strong focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">
              <button
                type="button"
                onClick={() => setForm(EMPTY_FORM)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-sunken transition-colors"
              >
                {t('取消')}
              </button>
              <button
                type="submit"
                className="rounded-lg bg-seal px-4 py-1.5 text-xs font-medium text-white hover:bg-seal/90 transition-colors"
              >
                {t('保存组件')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
