/**
 * Vim 冒号命令的**总目录**：联想补全（GlobalVimCommandBar 的候选列表）与
 * 未来任何「有哪些命令」的展示都从这里取。executeVimCommand 仍然是执行的唯一入口——
 * 这里只管「有什么、说什么」，不管「怎么跑」。
 *
 * 新增命令时在 executeVimCommand（与 registerVimExCommands）里登记行为，再来这里
 * 登记一行目录；只改目录不改执行的条目会变成「联想里骗人」的死条目。
 */
export interface VimCommandInfo {
  /** 主命令名：联想补全补成它 */
  cmd: string
  /** 别名（同样参与前缀匹配；命中别名仍补全到主名） */
  aliases?: string[]
  /** 一句话功能描述（候选列表里显示） */
  desc: string
}

export const VIM_COMMANDS: readonly VimCommandInfo[] = [
  { cmd: 'w', desc: '保存当前文档 / 源码（:w! 强制保存）' },
  { cmd: 'q', desc: '关闭当前页签（:q! 强制关闭不弹确认）' },
  { cmd: 'wq', desc: '保存并关闭当前页签' },
  { cmd: 'x', aliases: ['xit'], desc: '保存并关闭当前页签' },
  { cmd: 'tabnew', aliases: ['tabe', 'tabedit', 'new'], desc: '新建空白文件页签' },
  { cmd: 'tabclose', aliases: ['tabc'], desc: '关闭当前页签（:tabc! 强制）' },
  { cmd: 'tabonly', aliases: ['tabo'], desc: '关闭其他页签；未保存的自动跳过，:tabo! 才强制' },
  { cmd: 'tabnext', aliases: ['tabn', 'bnext', 'bn'], desc: '切换到下一个页签' },
  { cmd: 'tabprevious', aliases: ['tabp', 'bprev', 'bp'], desc: '切换到上一个页签' },
  { cmd: 'bdelete', aliases: ['bd'], desc: '关闭当前缓冲页签（:bd! 强制）' },
  { cmd: 'split', aliases: ['sp'], desc: '展开分栏实时预览（上下分栏，与 :preview 相同）' },
  { cmd: 'vsplit', aliases: ['vs'], desc: '展开分栏实时预览（左右分栏，与 :preview 相同）' },
  { cmd: 'only', aliases: ['on'], desc: '收起分栏预览，只留编辑栏' },
  { cmd: 'preview', desc: '切换分栏实时预览；带 switch 参数对调编辑与预览两列' },
  { cmd: 'resources', aliases: ['res'], desc: '切换左侧资源管理器窄条 ↔ 完整栏' },
  { cmd: 'focus', aliases: ['fo'], desc: '把焦点还给编辑器（编辑页面；其它页面没有可聚焦的编辑器）' },
  { cmd: 'agent', aliases: ['ag'], desc: '呼出 / 收起导师栏；带文字则直接把消息发给导师' },
  { cmd: 'center', aliases: ['ce', 'zz'], desc: '光标所在行垂直居中' },
  { cmd: 'fold', desc: '折叠当前代码块（Ctrl-）' },
  { cmd: 'unfold', desc: '展开当前代码块（Ctrl=）' },
  { cmd: 'foldall', desc: '折叠所有代码块' },
  { cmd: 'unfoldall', desc: '展开所有代码块' },
  { cmd: 'find', desc: '呼起查找面板' },
  { cmd: 'replace', desc: '呼起替换面板' },
  { cmd: 'cheat', aliases: ['ch', 'vim'], desc: '打开 Vim 命令大全' },
  { cmd: 'help', aliases: ['h'], desc: '显示常用命令帮助提示' },
]

/**
 * 按输入的**第一个 token**（命令名，可带 `!`）做前缀匹配。
 * 别名命中的条目去重后仍以主名呈现；结果按命令名排序，列表稳定。
 */
export function matchVimCommands(input: string): VimCommandInfo[] {
  const first = input.trim().split(/\s+/)[0] ?? ''
  if (!first) return []
  const lower = first.toLowerCase()
  const bare = lower.endsWith('!') ? lower.slice(0, -1) : lower
  if (!bare) return []
  const seen = new Set<string>()
  const hits: VimCommandInfo[] = []
  for (const c of VIM_COMMANDS) {
    if (seen.has(c.cmd)) continue
    if (c.cmd.startsWith(bare) || (c.aliases ?? []).some((a) => a.startsWith(bare))) {
      seen.add(c.cmd)
      hits.push(c)
    }
  }
  return hits.sort((a, b) => a.cmd.localeCompare(b.cmd))
}
