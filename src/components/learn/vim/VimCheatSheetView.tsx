import { useState, useMemo, Fragment } from 'react'
import { Search } from 'lucide-react'
import { VIM_CATEGORIES, VIM_COMMANDS_DATA, type VimCommandItem, type VimCategory } from './vimCheatSheetData'
import { t } from '../../../i18n'

/**
 * Vim 学习与命令大全——**一份高密度的速查表**，不是一堆卡牌：
 * 按键 | 名称与说明 | 示例 一行一条，分类作薄分节标题，全直角、无卡片框。
 * 空间利用率优先：一行就是一条命令，扫读靠排版不靠装饰。
 */
export default function VimCheatSheetView() {
  const [selectedCat, setSelectedCat] = useState<VimCategory['id']>('all')
  const [searchQuery, setSearchQuery] = useState('')

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

  /** 按分类分节（选了单一分类时就是一节，不重复画分节标题） */
  const sections = useMemo(() => {
    const order = VIM_CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id)
    const byCat = new Map<string, VimCommandItem[]>()
    for (const cmd of filteredCommands) {
      const list = byCat.get(cmd.category) ?? []
      list.push(cmd)
      byCat.set(cmd.category, list)
    }
    return order
      .filter((id) => byCat.has(id))
      .map((id) => ({ cat: id, items: byCat.get(id)! }))
  }, [filteredCommands])

  const showSectionHeads = selectedCat === 'all' && !searchQuery.trim()
  const catLabel = (id: string) => VIM_CATEGORIES.find((c) => c.id === id)?.label ?? id

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-card/10">
      {/* 搜索与分类：一行搜框 + 一行分类文字钮，全是直角 */}
      <div className="flex flex-col gap-2 border-b border-line/70 px-6 py-3 bg-card/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-[420px]">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('搜索按键、命令或功能说明（如 ci", agent, zz, 替换, 移动）...')}
              className="w-full rounded-none border border-line bg-transparent py-1 pl-8 pr-3 text-[12.5px] text-ink placeholder:text-ink-faint outline-none transition focus:border-seal"
            />
          </div>
          <div className="text-[12px] text-ink-faint">
            {t('收录')} <strong className="font-mono text-ink-strong">{VIM_COMMANDS_DATA.length}</strong> {t('条指令')}
            {searchQuery.trim() && (
              <>
                {' · '}
                {t('匹配')} <strong className="font-mono text-seal">{filteredCommands.length}</strong> {t('条')}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {VIM_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCat(cat.id)}
              className={
                'rounded-none border-0 bg-transparent px-0 pb-0.5 text-[12px] transition cursor-pointer ' +
                (selectedCat === cat.id
                  ? 'font-semibold text-seal border-b border-seal'
                  : 'text-ink-soft border-b border-transparent hover:text-ink')
              }
            >
              {t(cat.label)}
            </button>
          ))}
        </div>
      </div>

      {/* 速查表：一行一条命令 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {filteredCommands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[13px] font-medium text-ink-soft">{t('未找到匹配的 Vim 命令')}</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setSelectedCat('all')
              }}
              className="mt-3 rounded-none border border-line bg-transparent px-3 py-1 text-[12px] text-ink-soft hover:border-seal hover:text-ink cursor-pointer"
            >
              {t('重置筛选条件')}
            </button>
          </div>
        ) : (
          <div>
            {/* 表头：只一条细分隔线，够认列就够了 */}
            <div className="flex items-baseline gap-4 border-b border-line py-1.5 text-[11px] text-ink-faint">
              <span className="w-44 shrink-0">{t('按键')}</span>
              <span className="min-w-0 flex-1">{t('名称与说明')}</span>
              <span className="hidden w-52 shrink-0 lg:block">{t('示例')}</span>
            </div>
            {sections.map(({ cat, items }) => (
              <Fragment key={cat}>
                {showSectionHeads && (
                  <div className="mt-3 mb-0.5 flex items-baseline gap-2 border-b border-line/40 pb-1">
                    <span className="text-[11.5px] font-semibold text-ink-strong">{t(catLabel(cat))}</span>
                    <span className="font-mono text-[10.5px] text-ink-faint">{items.length}</span>
                  </div>
                )}
                {items.map((cmd) => (
                  <CommandRow key={cmd.id} item={cmd} />
                ))}
              </Fragment>
            ))}

            {/* 组合心法：一段话，不再是卡片 */}
            <div className="mt-6 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-soft">
              <span className="font-semibold text-ink-strong">
                {t('Vim 组合心法：动词 + 范围 + 宾语 (Verb + Text Object)')}
              </span>
              {' — '}
              {t('例如')} <Key>c</Key>（修改）+ <Key>i</Key>（内部）+ <Key>w</Key>（单词）=
              {t('修改当前词')}；把最后换成 <Key>&quot;</Key> {t('则是修改双引号内部')}。
              {t('搭配点号')} <Key>.</Key> {t('即可把刚才这一连串动作在下一个光标位置一键复现')}。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 行内的键位小字：单色 mono，不做按键帽 */
function Key({ children }: { children: string }) {
  return (
    <code className="rounded-none border border-line bg-line/30 px-1 py-0.5 font-mono text-[11px] font-bold text-seal">
      {children}
    </code>
  )
}

/** 速查表的一行：按键 | 名称与说明 | 示例。细分隔线 + 悬停变色，无框无角 */
function CommandRow({ item }: { item: VimCommandItem }) {
  return (
    <div className="group flex items-baseline gap-4 border-b border-line/40 py-1.5 transition-colors hover:bg-line/30">
      <div className="flex w-44 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[12px] font-semibold text-seal">
        {item.keys.map((k, i) => (
          <span key={i}>{k}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        <span className="font-semibold text-ink-strong">{item.name}</span>
        <span className="text-ink-soft">{item.desc ? ' — ' + item.desc : ''}</span>
        {item.tag && (
          <span className="ml-2 shrink-0 font-mono text-[10px] text-ink-faint">{t(item.tag)}</span>
        )}
      </div>
      {item.example && (
        <div className="hidden w-52 shrink-0 truncate text-right font-mono text-[11px] text-ink-faint lg:block" title={item.example}>
          {item.example}
        </div>
      )}
    </div>
  )
}
