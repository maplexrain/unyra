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
  /** 中文名称（速查大全显示） */
  name?: string
  /** 一句话功能描述（候选列表与速查大全里显示） */
  desc: string
  /** 示例 */
  example?: string
  /** 标签 */
  tag?: string
  /** 分类（默认 'moji'） */
  category?: 'moji' | 'motions' | 'editing' | 'visual' | 'search' | 'window' | 'advanced'
}

export const VIM_COMMANDS: readonly VimCommandInfo[] = [
  {
    cmd: 'w',
    name: '保存文档',
    desc: '保存当前文档 / 源码（:w! 强制保存）',
    category: 'moji',
    tag: '常用',
    example: ':w',
  },
  {
    cmd: 'q',
    name: '关闭页签',
    desc: '关闭当前页签（:q! 强制关闭不弹确认）',
    category: 'moji',
    tag: '常用',
    example: ':q',
  },
  {
    cmd: 'wq',
    name: '保存并关闭',
    desc: '保存并关闭当前页签',
    category: 'moji',
    tag: '常用',
    example: ':wq',
  },
  {
    cmd: 'x',
    aliases: ['xit'],
    name: '保存并退出',
    desc: '保存并关闭当前页签',
    category: 'moji',
    example: ':x',
  },
  {
    cmd: 'tabnew',
    aliases: ['tabe', 'tabedit', 'new'],
    name: '新建空白页签',
    desc: '新建空白文件页签',
    category: 'moji',
    tag: '专属',
    example: ':tabnew',
  },
  {
    cmd: 'tabclose',
    aliases: ['tabc'],
    name: '关闭页签',
    desc: '关闭当前页签（:tabc! 强制）',
    category: 'moji',
    example: ':tabclose',
  },
  {
    cmd: 'tabonly',
    aliases: ['tabo'],
    name: '关闭其他页签',
    desc: '关闭其他页签；未保存的自动跳过，:tabo! 才强制',
    category: 'moji',
    tag: '专属',
    example: ':tabo',
  },
  {
    cmd: 'tabnext',
    aliases: ['tabn', 'bnext', 'bn'],
    name: '下一个页签',
    desc: '切换到下一个页签',
    category: 'moji',
    example: ':tabn',
  },
  {
    cmd: 'tabprevious',
    aliases: ['tabp', 'bprev', 'bp'],
    name: '上一个页签',
    desc: '切换到上一个页签',
    category: 'moji',
    example: ':tabp',
  },
  {
    cmd: 'bdelete',
    aliases: ['bd'],
    name: '关闭缓冲页签',
    desc: '关闭当前缓冲页签（:bd! 强制）',
    category: 'moji',
    example: ':bd',
  },
  {
    cmd: 'split',
    aliases: ['sp'],
    name: '上下分栏预览',
    desc: '展开分栏实时预览（上下分栏，与 :preview 相同）',
    category: 'moji',
    tag: '专属',
    example: ':sp',
  },
  {
    cmd: 'vsplit',
    aliases: ['vs'],
    name: '左右分栏预览',
    desc: '展开分栏实时预览（左右分栏，与 :preview 相同）',
    category: 'moji',
    tag: '专属',
    example: ':vs',
  },
  {
    cmd: 'only',
    aliases: ['on'],
    name: '仅留编辑栏',
    desc: '收起分栏预览，只留编辑栏',
    category: 'moji',
    example: ':only',
  },
  {
    cmd: 'preview',
    name: '切换分栏实时预览',
    desc: '切换分栏实时预览；带 switch 参数对调编辑与预览两列',
    category: 'moji',
    tag: '专属',
    example: ':preview switch',
  },
  {
    cmd: 'resources',
    aliases: ['res'],
    name: '切换资源管理器',
    desc: '切换左侧资源管理器窄条 ↔ 完整栏',
    category: 'moji',
    tag: '专属',
    example: ':resources',
  },
  {
    cmd: 'focus',
    aliases: ['fo'],
    name: '聚焦编辑器',
    desc: '把焦点还给编辑器（编辑页面；其它页面没有可聚焦的编辑器）',
    category: 'moji',
    example: ':focus',
  },
  {
    cmd: 'agent',
    aliases: ['ag'],
    name: '呼叫导师 / 提问',
    desc: '呼出 / 收起导师栏；带文字则直接把消息发给导师',
    category: 'moji',
    tag: '专属',
    example: ':agent 请帮我梳理大纲',
  },
  {
    cmd: 'center',
    aliases: ['ce', 'zz'],
    name: '光标行垂直居中',
    desc: '光标所在行垂直居中（平滑校正滚动）',
    category: 'moji',
    example: ':center',
  },
  {
    cmd: 'fold',
    name: '折叠当前代码块',
    desc: '折叠当前代码块（对应快捷键 Ctrl-）',
    category: 'moji',
    example: ':fold',
  },
  {
    cmd: 'unfold',
    name: '展开当前代码块',
    desc: '展开当前代码块（对应快捷键 Ctrl=）',
    category: 'moji',
    example: ':unfold',
  },
  {
    cmd: 'foldall',
    name: '折叠所有代码块',
    desc: '折叠所有代码块',
    category: 'moji',
    example: ':foldall',
  },
  {
    cmd: 'unfoldall',
    name: '展开所有代码块',
    desc: '展开所有代码块',
    category: 'moji',
    example: ':unfoldall',
  },
  {
    cmd: 'find',
    name: '查找面板',
    desc: '呼起查找面板',
    category: 'moji',
    example: ':find',
  },
  {
    cmd: 'replace',
    name: '替换面板',
    desc: '呼起替换面板',
    category: 'moji',
    example: ':replace',
  },
  {
    cmd: 'cheat',
    aliases: ['ch', 'vim'],
    name: 'Vim 命令大全',
    desc: '打开 Vim 命令大全页签',
    category: 'moji',
    tag: '专属',
    example: ':cheat',
  },
  {
    cmd: 'edit',
    aliases: ['e'],
    name: '切换为编辑模式',
    desc: '将当前页面从浏览转为编辑模式（如果内容可编辑）',
    category: 'moji',
    tag: '专属',
    example: ':edit',
  },
  {
    cmd: 'view',
    aliases: ['read', 'browse', 'noedit'],
    name: '切换为浏览模式',
    desc: '将当前页面从编辑模式切换到浏览模式（如果支持预览）',
    category: 'moji',
    tag: '专属',
    example: ':view',
  },
  {
    cmd: 'wrap',
    name: '开启自动换行',
    desc: '开启编辑区域代码与文本自动换行',
    category: 'moji',
    tag: '专属',
    example: ':wrap',
  },
  {
    cmd: 'nowrap',
    name: '关闭自动换行',
    desc: '关闭编辑区域自动换行，长行水平延伸',
    category: 'moji',
    tag: '专属',
    example: ':nowrap',
  },
  {
    cmd: 'browser',
    aliases: ['web'],
    name: '打开浏览器页签',
    desc: '打开一个新的浏览器页签，可携带 URL 参数',
    category: 'moji',
    tag: '专属',
    example: ':browser https://github.com',
  },
  {
    cmd: 'fullscreen',
    aliases: ['fs', 'zen'],
    name: '进入纯净阅读模式',
    desc: '进入纯净阅读模式（全屏保留页签栏与正文）',
    category: 'moji',
    tag: '专属',
    example: ':fullscreen',
  },
  {
    cmd: 'exitfullscreen',
    aliases: ['unfs', 'nozen'],
    name: '退出纯净阅读模式',
    desc: '退出纯净阅读模式，还原侧边栏与顶栏',
    category: 'moji',
    tag: '专属',
    example: ':exitfullscreen',
  },
  {
    cmd: 'open',
    aliases: ['o'],
    name: '打开目标',
    desc: '打开当前目标下的文件/页签/窗口（支持拼音匹配）',
    category: 'moji',
    tag: '专属',
    example: ':open cx',
  },
  {
    cmd: 'mark',
    name: '标记选中文本',
    desc: '标记当前选中的文字（高亮马克笔标记，可切换消除）',
    category: 'visual',
    tag: '选区',
    example: ':mark',
  },
  {
    cmd: 'comment',
    aliases: ['note'],
    name: '注解选中文本',
    desc: '对当前选中的文字打开注解输入卡片，支持 Markdown 与样式设置',
    category: 'visual',
    tag: '选区',
    example: ':comment',
  },
  {
    cmd: 'know',
    aliases: ['understand'],
    name: '了解选中文本',
    desc: '让 Agent 对选中的文字进行释义并存入目标级知识库，整门目标共用引用',
    category: 'visual',
    tag: '选区',
    example: ':know',
  },
  {
    cmd: 'study',
    aliases: ['learn'],
    name: '深入学习选中文本',
    desc: '根据选中的文字在大纲下发起新的子目标创建并开启导师讲解',
    category: 'visual',
    tag: '选区',
    example: ':study',
  },
  {
    cmd: 'ask',
    name: '询问选中文本',
    desc: '将选中的文字作为上下文向 Agent 提问（支持直接跟随提问内容）',
    category: 'visual',
    tag: '选区',
    example: ':ask 这句话怎么理解？',
  },
  {
    cmd: 'help',
    aliases: ['h'],
    name: '帮助提示',
    desc: '显示常用命令帮助提示',
    category: 'moji',
    example: ':help',
  },
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
