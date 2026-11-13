import { useState, useMemo } from 'react'
import { Search, Copy, Check, Sparkles, Command, HelpCircle } from 'lucide-react'
import { VIM_CATEGORIES, VIM_COMMANDS_DATA, type VimCommandItem, type VimCategory } from './vimCheatSheetData'
import { t } from '../../../i18n'

export default function VimCheatSheetView() {
  const [selectedCat, setSelectedCat] = useState<VimCategory['id']>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedKey(text)
    window.setTimeout(() => setCopiedKey(null), 1500)
  }

  const filteredCommands = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return VIM_COMMANDS_DATA.filter((cmd) => {
      if (selectedCat !== 'all' && cmd.category !== selectedCat) return false
      if (!q) return true
      return (
        cmd.name.toLowerCase().includes(q) ||
        cmd.desc.toLowerCase().includes(q) ||
        cmd.keys.some((k) => k.toLowerCase().includes(q)) ||
        (cmd.example && cmd.example.toLowerCase().includes(q)) ||
        (cmd.tag && cmd.tag.toLowerCase().includes(q))
      )
    })
  }, [selectedCat, searchQuery])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card/10">
      {/* 搜索与分类导航条 */}
      <div className="flex flex-col gap-3 border-b border-line/70 px-6 py-4 bg-card/40 backdrop-blur-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-[420px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('搜索按键、命令或功能说明（如 ci", agent, zz, 替换, 移动）...')}
              className="w-full rounded-lg border border-line bg-card/80 py-1.5 pl-9 pr-8 text-[12.5px] text-ink placeholder:text-ink-faint outline-none transition focus:border-seal focus:ring-1 focus:ring-seal"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink cursor-pointer text-[11px]"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-[12px] text-ink-faint">
            <Command size={14} className="text-seal" />
            <span>
              {t('收录')} <strong className="font-mono text-ink-strong">{VIM_COMMANDS_DATA.length}</strong> {t('条指令')}
              {searchQuery && (
                <>
                  {' · '}
                  {t('匹配')} <strong className="font-mono text-seal">{filteredCommands.length}</strong> {t('条')}
                </>
              )}
            </span>
          </div>
        </div>

        {/* 分类筛选胶囊条 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {VIM_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCat(cat.id)}
              className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition cursor-pointer ${
                selectedCat === cat.id
                  ? 'bg-seal text-white shadow-xs'
                  : 'bg-line/40 text-ink-soft hover:bg-line/70 hover:text-ink'
              }`}
            >
              {t(cat.label)}
            </button>
          ))}
        </div>
      </div>

      {/* 命令卡片瀑布网格 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {filteredCommands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HelpCircle size={36} className="text-ink-faint/60" />
            <p className="mt-3 text-[13.5px] font-medium text-ink-soft">{t('未找到匹配的 Vim 命令')}</p>
            <p className="mt-1 text-[12px] text-ink-faint">{t('可以尝试搜索其他关键词，或清空搜索查看全量指令')}</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setSelectedCat('all')
              }}
              className="mt-4 rounded-lg border border-line bg-card px-3.5 py-1.5 text-[12px] text-ink hover:bg-line/40 cursor-pointer"
            >
              {t('重置筛选条件')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredCommands.map((cmd) => (
              <CommandCard
                key={cmd.id}
                item={cmd}
                copied={copiedKey === cmd.keys[0]}
                onCopy={() => copyToClipboard(cmd.keys[0])}
              />
            ))}
          </div>
        )}

        {/* 底部心法指南 */}
        <div className="mt-8 rounded-xl border border-line/60 bg-card/40 p-4 text-[12px] text-ink-soft">
          <div className="flex items-center gap-2 font-semibold text-ink-strong">
            <Sparkles size={15} className="text-amber-400" />
            <span>{t('Vim 组合心法：动词 + 范围 + 宾语 (Verb + Text Object)')}</span>
          </div>
          <p className="mt-1.5 leading-relaxed text-ink-soft">
            Vim 的真正威力在于其<strong>可组合性（Composability）</strong>。例如：
            <code className="mx-1 rounded border border-line bg-line/30 px-1 py-0.5 font-mono text-[11px] text-seal font-bold">c</code>（修改，动词）+
            <code className="mx-1 rounded border border-line bg-line/30 px-1 py-0.5 font-mono text-[11px] text-seal font-bold">i</code>（内部，范围）+
            <code className="mx-1 rounded border border-line bg-line/30 px-1 py-0.5 font-mono text-[11px] text-seal font-bold">w</code>（单词，宾语）=
            <span className="ml-1 text-ink-strong font-medium">修改当前词</span>；
            把最后换成 <code className="mx-1 rounded border border-line bg-line/30 px-1 py-0.5 font-mono text-[11px] text-seal font-bold">&quot;</code> 则是修改双引号内部。
            搭配点号 <code className="mx-1 rounded border border-line bg-line/30 px-1 py-0.5 font-mono text-[11px] text-seal font-bold">.</code> 即可把刚才这一连串动作在下一个光标位置一键复现。
          </p>
        </div>
      </div>
    </div>
  )
}

function CommandCard({
  item,
  copied,
  onCopy,
}: {
  item: VimCommandItem
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="group relative flex flex-col justify-between rounded-xl border border-line/70 bg-card/70 p-4 shadow-2xs transition hover:border-seal/50 hover:bg-card hover:shadow-xs">
      <div>
        {/* 顶栏按键序列与标签 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.keys.map((k, i) => (
              <kbd
                key={i}
                className="inline-flex items-center rounded border border-line-strong/80 bg-paper px-2 py-0.5 font-mono text-[12px] font-bold text-seal shadow-2xs group-hover:border-seal/60"
              >
                {k}
              </kbd>
            ))}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {item.tag && (
              <span className="rounded bg-seal/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-seal border border-seal/20">
                {item.tag}
              </span>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-line/40 hover:text-ink cursor-pointer"
              title={t('复制命令')}
            >
              {copied ? <Check size={12} className="text-[#019833]" /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {/* 标题 */}
        <h3 className="mt-2 text-[13px] font-bold text-ink-strong tracking-tight">{item.name}</h3>

        {/* 描述 */}
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{item.desc}</p>
      </div>

      {/* 示例 */}
      {item.example && (
        <div className="mt-2.5 pt-2 border-t border-line/40 flex items-center justify-between text-[11px]">
          <span className="text-ink-faint">{t('示例：')}</span>
          <span className="font-mono text-ink-soft bg-line/20 px-1.5 py-0.5 rounded text-[10.5px]">
            {item.example}
          </span>
        </div>
      )}
    </div>
  )
}
