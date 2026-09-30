/**
 * 输入框的斜杠命令：输入框里**只有**「/」打头的一小截文字时，在输入卡片上方弹出功能菜单。
 *
 * 与「+」菜单是同一批动作的另一条路（键客的路）：翻菜单要点两下，打 `/co` 回车只要
 * 三次击键——动作还是那些动作（压缩 / 新建 / 历史 / 设置 / 推理等级 / 出卷 / 实验室），
 * 只是入口长在打字的手上。所以这里的每一项都直接复用上层传下来的同一个回调，不另起炉灶。
 *
 * 规矩有四条：
 * 1. 输入框里有别的内容（出现空格、汉字等）就不算命令，菜单立刻消失，文字照常发送；
 * 2. 长得像命令的文字**永远不会被当成消息发出去**（Enter 在这里被拦下）——半截命令
 *    「/exa」发到导师那里只会得到一句困惑；
 * 3. /resume 与 /effort 是二级项：点它或回车是**换层**，不执行；退格回到一级；
 * 4. Esc 清空输入并收摊——那半截命令本来就是想取消的东西。
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Archive, FlaskConical, Gauge, GraduationCap, MessagesSquare, Settings } from 'lucide-react'
import type { Conversation } from '../../../agent/types'
import {
  REASONING_EFFORTS,
  REASONING_HINT,
  REASONING_LABEL,
  REASONING_NEON,
  type ReasoningEffort,
} from '../../../ai/types'
import { NewChatIcon } from '../../icons'
import { t } from '../../../i18n'

/** 斜杠菜单停在哪一层：一级是命令表，另外两层各是一个二级菜单 */
export type SlashLevel = 'root' | 'history' | 'effort'

/** 斜杠菜单里的一项。带 sub 的不执行、只换层（与「+」菜单的 MenuItem 同一条规矩） */
export interface SlashItem {
  /** 一级里是命令 id（渲染成 /xxx）；二级里只是一个稳定 key */
  key: string
  label: string
  hint?: string
  icon: ReactNode
  disabled?: boolean
  sub?: Exclude<SlashLevel, 'root'>
  /** 这一项是不是「现行」（历史里正在聊的那段、effort 里当前的档） */
  current?: boolean
  run?: () => void
}

export interface SlashMenuArgs {
  value: string
  /** 执行完命令 / Esc 时清输入框（命令不是消息，不该留在草稿里） */
  clear: () => void
  running: boolean
  hasKey: boolean
  compacting: boolean
  effort: ReasoningEffort
  conversations: Conversation[]
  conversation: Conversation | null
  onCompact: () => void
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onSetEffort: (e: ReasoningEffort) => void
  onOpenAgentSettings: () => void
  onExam: () => void
  onSuperLab: () => void
}

export function useSlashMenu({
  value,
  clear,
  running,
  hasKey,
  compacting,
  effort,
  conversations,
  conversation,
  onCompact,
  onNewConversation,
  onSelectConversation,
  onSetEffort,
  onOpenAgentSettings,
  onExam,
  onSuperLab,
}: SlashMenuArgs) {
  /** 现在停在哪一层 */
  const [level, setLevel] = useState<SlashLevel>('root')
  /**
   * 键盘 / 鼠标共同的高亮。**记成「哪张表 + 第几项」**而不是一个裸下标：
   * 输入变了、换层了，表就换了一张——裸下标会把上一张表的选中位置带到新表上，
   * 「高亮停在中间某行」就是从这里来的。key 对不上就当 0（高亮回到第一项）。
   */
  const [sel, setSel] = useState<{ key: string; i: number }>({ key: '', i: 0 })

  /**
   * 菜单活着的判据：整个输入框**只有** `/` 加一截命令字母。有空格、汉字就当普通消息，
   * 菜单消失——「看看 /compact 是什么意思」这句话得能正常发出去。
   */
  const active = /^\/[a-z0-9]*$/i.test(value)
  /** 过滤词：/ 后面已经打出的那截（大小写不敏感） */
  const query = active ? value.slice(1).toLowerCase() : ''

  /** 一级命令表。顺序按「闲聊时最顺手」排：动上下文的在前，发一轮工作流的在后 */
  const commands: SlashItem[] = [
    {
      key: 'new',
      label: t('新建对话'),
      hint: t('同一个目标，另起一段上下文'),
      icon: <NewChatIcon size={14} />,
      run: onNewConversation,
    },
    {
      key: 'resume',
      label: t('对话历史'),
      hint: t('恢复之前的某一段对话'),
      icon: <MessagesSquare size={14} />,
      sub: 'history',
    },
    {
      key: 'compact',
      label: t('压缩上下文'),
      hint: compacting ? t('正在压缩…') : t('把前面的对话折成一份摘要继续聊'),
      icon: <Archive size={14} />,
      disabled: compacting || running,
      run: onCompact,
    },
    {
      key: 'settings',
      label: t('超级导师设置'),
      hint: t('压缩阈值、人格等（与全局设置分开）'),
      icon: <Settings size={14} />,
      run: onOpenAgentSettings,
    },
    {
      key: 'effort',
      label: t('设置推理等级'),
      hint: t('思考多深：Low / High / Max'),
      icon: <Gauge size={14} />,
      sub: 'effort',
    },
    {
      key: 'exam',
      label: t('出试卷'),
      hint: t('导师先问类型与难度，再出卷'),
      icon: <GraduationCap size={14} />,
      disabled: running || !hasKey,
      run: onExam,
    },
    {
      key: 'superlab',
      label: t('超级实验室'),
      hint: t('说想要什么实验，导师做成可交互的超级文档'),
      icon: <FlaskConical size={14} />,
      disabled: running || !hasKey,
      run: onSuperLab,
    },
  ]

  /** 二级：对话历史。与「+」菜单的对话历史同源（同一个 onSelectConversation） */
  const historyItems: SlashItem[] = conversations.map((c, i) => {
    let count = 0
    for (const m of c.messages) if (!m.hidden) count++
    return {
      key: 'conv:' + c.id,
      label: c.title || t('对话 {0}', i + 1),
      hint: count ? t('{0} 条消息', count) : t('还没有消息'),
      icon: <MessagesSquare size={13} />,
      current: c.id === conversation?.id,
      run: () => {
        onSelectConversation(c.id)
        clear()
      },
    }
  })

  /** 二级：推理等级。荧光点配色与 ModelPicker 里的 EffortSlider 同一份（REASONING_NEON） */
  const effortItems: SlashItem[] = REASONING_EFFORTS.map((e) => ({
    key: 'effort:' + e,
    label: REASONING_LABEL[e],
    hint: t(REASONING_HINT[e]),
    icon: (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full" style={{ background: REASONING_NEON[e] }} />
      </span>
    ),
    current: e === effort,
    run: () => onSetEffort(e),
  }))

  /** 当前层要渲染的表：一级按已打的字母过滤，二级整表 */
  const items =
    level === 'root'
      ? commands.filter((c) => c.key.startsWith(query))
      : level === 'history'
        ? historyItems
        : effortItems
  /** 这一刻的「表身份」：过滤词或层级一变就是另一张表（sel 据此作废） */
  const listKey = level + ':' + query
  const highlight = sel.key === listKey ? sel.i : 0

  /** 点一项 / 回车落在一项上：二级项换层，其余执行后清输入 */
  const pick = (item: SlashItem) => {
    if (item.disabled) return
    if (item.sub) {
      setLevel(item.sub)
      setSel({ key: item.sub + ':', i: 0 })
      return
    }
    setLevel('root')
    setSel({ key: '', i: 0 })
    item.run?.()
    clear()
  }

  /** 退回一级（退格键 / 面包屑） */
  const back = () => {
    setLevel('root')
    setSel({ key: '', i: 0 })
  }

  /** 鼠标经过 = 选中：键盘与鼠标只有一份高亮，两边的动作才指同一项 */
  const hover = (i: number) => setSel({ key: listKey, i })

  /** 面包屑上当前层的名字 */
  const title = level === 'history' ? t('对话历史') : t('推理等级')

  /**
   * 输入框的 onKeyDown 先交给这里：返回 true 表示这颗键是菜单的，输入框别再处理。
   *
   * Enter 一律拦下（哪怕没有匹配项）——那就是「长得像命令」的文字，发出去必是误会。
   */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!active || e.nativeEvent.isComposing) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return false
      e.preventDefault()
      const next = (highlight + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
      setSel({ key: listKey, i: next })
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const item = items[highlight]
      if (item && !item.disabled) pick(item)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      clear()
      back()
      return true
    }
    // 二级里的退格是「返回上级」；一级的退格正常删字——删到不匹配时菜单自己会消失
    if (e.key === 'Backspace' && level !== 'root') {
      e.preventDefault()
      back()
      return true
    }
    return false
  }

  return {
    active,
    level,
    title,
    items,
    highlight,
    emptyHint: level === 'history' ? t('这个目标下还没有别的对话') : t('没有匹配的命令'),
    onKeyDown,
    pick,
    back,
    hover,
  }
}
