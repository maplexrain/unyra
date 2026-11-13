export interface TutorLevel {
  id: number
  title: string
  subtitle: string
  goalText: string
  instruction: string
  hint: string
  keyGuide: Array<{ key: string; desc: string }>
  initialLines: string[]
  startPos: { row: number; col: number }
  type: 'maze' | 'edit' | 'motion' | 'command'
  /** 目标点或要求内容 */
  meta: {
    diamonds?: Array<{ row: number; col: number; id: string }>
    goalPortal?: { row: number; col: number }
    forbiddenChars?: string[]
    expectedText?: string
    targetWords?: string[]
    commandMatch?: string
  }
}

export const VIM_TUTOR_LEVELS: TutorLevel[] = [
  {
    id: 1,
    title: '第一关：方向之魂',
    subtitle: '初入江湖 · 掌上罗盘',
    goalText: '使用 h/j/k/l 收集全部 3 枚灵石并抵达传送门',
    instruction:
      'Vim 的移动不依靠方向键，而是右手主位：h (左)、j (下)、k (上)、l (右)。手指无需离开键盘中心，移动快如闪电！',
    hint: '按 j 往下走，按 l 往右走，按 k 往上走，按 h 往左走',
    keyGuide: [
      { key: 'h', desc: '向左移动一格' },
      { key: 'j', desc: '向下移动一格' },
      { key: 'k', desc: '向上移动一格' },
      { key: 'l', desc: '向右移动一格' },
    ],
    type: 'maze',
    initialLines: [
      '############################',
      '# @   . . . 💎 . . . . .   #',
      '# . ####################   #',
      '# . #        💎        #   #',
      '# . #  ############### #   #',
      '# . .  # 💎          # 🌀  #',
      '############################',
    ],
    startPos: { row: 1, col: 2 },
    meta: {
      diamonds: [
        { row: 1, col: 12, id: 'd1' },
        { row: 3, col: 13, id: 'd2' },
        { row: 5, col: 9, id: 'd3' },
      ],
      goalPortal: { row: 5, col: 23 },
    },
  },
  {
    id: 2,
    title: '第二关：疾步如飞',
    subtitle: '词间穿梭 · 步履如风',
    goalText: '使用 w、b、0、$ 跨越词句，踩亮沿途的 3 个星标踏板并抵达行尾传送门',
    instruction:
      '逐字移动太慢？按 w 跳到下一个单词开头，按 b 跳回前一个单词开头，按 0 直达行首，按 $ 直达行尾！',
    hint: '按 w 快速跨词跳跃，按 $ 一键飞抵行末',
    keyGuide: [
      { key: 'w', desc: '跳到下一词词首' },
      { key: 'b', desc: '跳回上一词词首' },
      { key: '0', desc: '瞬间直达行首' },
      { key: '$', desc: '瞬间飞抵行尾' },
    ],
    type: 'motion',
    initialLines: [
      'const hero = summonChampion("VimMaster");',
      'hero.travelThrough(world, ⭐pathWay);',
      'let velocity = hero.accelerate(⭐MAX_SPEED);',
      'galaxy.portal.arrive(hero, destination); 🌀',
    ],
    startPos: { row: 0, col: 0 },
    meta: {
      diamonds: [
        { row: 1, col: 26, id: 'w1' },
        { row: 2, col: 31, id: 'w2' },
        { row: 3, col: 21, id: 'w3' },
      ],
      goalPortal: { row: 3, col: 41 },
    },
  },
  {
    id: 3,
    title: '第三关：阴阳之变',
    subtitle: '模式化生 · 动静相宜',
    goalText: '进入插入模式修复被损毁的变量名，完成后按 Esc 返回普通模式',
    instruction:
      'Vim 分为“普通模式”（发出指令）与“插入模式”（打字输入）。按 i 在光标前插入，按 a 在光标后追加，按 Esc 随时返回普通模式！',
    hint: '移动到 TARGET 处，按 i 进入输入模式输入正确代码，按 Esc 退出',
    keyGuide: [
      { key: 'i', desc: '在光标前切入 Insert 模式' },
      { key: 'a', desc: '在光标后切入 Insert 模式' },
      { key: 'o', desc: '在下方另起新行并进入 Insert' },
      { key: 'Esc', desc: '退出 Insert 模式，回归 Normal' },
    ],
    type: 'edit',
    initialLines: [
      'function unlockPortal() {',
      '  const passKey = "___REPLACE_ME___";',
      '  return passKey === "VIM_ROCKS";',
      '}',
    ],
    startPos: { row: 1, col: 19 },
    meta: {
      expectedText: 'VIM_ROCKS',
    },
  },
  {
    id: 4,
    title: '第四关：神剑诛邪',
    subtitle: '斩断错漏 · 时光回溯',
    goalText: '消灭所有入侵的错误字符 🐛 并用 u 键体验时光倒流',
    instruction:
      '按 x 可以斩除光标所在处的单个错字；按 dw 可以斩杀一个词；如果不小心删错了，按 u 即可时光倒流撤销！按 Ctrl-r 可以重做。',
    hint: '移动光标到 🐛 上按 x 逐个清除',
    keyGuide: [
      { key: 'x', desc: '斩杀当前光标下的字符' },
      { key: 'dw', desc: '向后删除一个词' },
      { key: 'dd', desc: '直接删除整行' },
      { key: 'u', desc: '撤销上一步（时光倒流）' },
    ],
    type: 'edit',
    initialLines: [
      'import { speed } from "🐛vite";',
      'function render🐛CleanCode() {',
      '  const status = "p🐛erfect";',
      '  console.log("Bug free🐛!");',
      '}',
    ],
    startPos: { row: 0, col: 22 },
    meta: {
      forbiddenChars: ['🐛'],
    },
  },
  {
    id: 5,
    title: '第五关：乾坤挪移',
    subtitle: '影分身法 · 圈选复印',
    goalText: '用 Visual 模式选中金币行，按 y 复制并在祭坛处按 p 粘贴出双倍金币',
    instruction:
      '按 v 进入可视字符选择模式，按 V 进入可视行选择模式！移动光标圈选内容后，按 y (Yank) 复制，移动到目的地按 p (Paste) 粘贴！',
    hint: '移动到金币行按 yy 复制，移动到祭坛行按 p 粘贴',
    keyGuide: [
      { key: 'v', desc: '切入 Visual 可视圈选模式' },
      { key: 'V', desc: '切入 Visual Line 整行圈选' },
      { key: 'y', desc: '复制所选内容 (Yank)' },
      { key: 'p', desc: '在光标后粘贴 (Paste)' },
    ],
    type: 'edit',
    initialLines: [
      '// === 藏宝库 ===',
      'const treasure = "🪙 Golden Coins x 999";',
      '// === 祭坛 (在此处按 p 粘贴) ===',
      '',
    ],
    startPos: { row: 1, col: 0 },
    meta: {
      targetWords: ['Golden Coins x 999'],
    },
  },
  {
    id: 6,
    title: '第六关：天命号令',
    subtitle: '宗师之境 · 冒号号令',
    goalText: '按 Ctrl- 折叠当前神殿代码块，再输入冒号命令 :w 封印存盘！',
    instruction:
      '按 Ctrl- / Ctrl= 即可一键快速折叠/展开当前代码块！按下 : 进入命令模式，输入 w 并按回车保存！你已掌握 Vim 的真谛！',
    hint: '按 Ctrl-（Mac: Cmd-）折叠代码块，再输入 :w 回车存盘',
    keyGuide: [
      { key: 'Ctrl -', desc: '智能折叠当前代码块' },
      { key: 'Ctrl =', desc: '智能展开当前代码块' },
      { key: ':w', desc: '冒号命令：保存当前文档' },
      { key: ':q', desc: '冒号命令：退出/关闭页签' },
    ],
    type: 'command',
    initialLines: [
      '// 终极代码神殿',
      'function SacredTempleRealm() {',
      '  const energy = "⚡ Max Power";',
      '  const sealStatus = "Ready to Fold and Save";',
      '  return { energy, sealStatus };',
      '}',
    ],
    startPos: { row: 2, col: 4 },
    meta: {
      commandMatch: ':w',
    },
  },
]
