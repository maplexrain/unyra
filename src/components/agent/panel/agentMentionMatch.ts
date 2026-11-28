/**
 * 群聊 @ 候选的检索规则（纯函数）。
 *
 * 中文名支持全拼与首字母缩写，英文名/别名仍按不区分大小写的子串匹配。
 * 单独成文件是为了给候选过滤与测试一个稳定的入口，不把 pinyin-match 的
 * 模块形状判断散落在组件里。
 */
import PinyinModule from 'pinyin-match'
import type { GroupChatAgent } from './GroupChatPanel'

const PinyinMatch: { match: (input: string, keys: string) => [number, number] | false } =
  (PinyinModule as { default?: typeof PinyinModule })?.default ??
  (PinyinModule as unknown as { match: (input: string, keys: string) => [number, number] | false })

/** 一个 agent 是否命中 @ 后面的查询串：空查询全员可见，否则真名/别名任一命中 */
export function agentMatchesMentionQuery(agent: Pick<GroupChatAgent, 'name' | 'aliases'>, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  const fields = [agent.name, ...(agent.aliases ?? [])].map((x) => x.trim()).filter(Boolean)
  return fields.some((field) => {
    if (field.toLowerCase().includes(query)) return true
    // 纯英文查询不交给 pinyin-match：它会把英文串也当成拼音去拆，容易产生意外命中。
    return /[\u3400-\u9fff]/.test(field) && PinyinMatch.match(field, query) !== false
  })
}

/**
 * @ 候选列表里的「采用当前高亮项」按键。
 *
 * Enter 维持原行为；Tab 只在没有修饰键时补全——Shift+Tab 必须留给焦点前移，
 * Alt/Ctrl/Meta+Tab 也要留给系统窗口切换，不能被输入框吞掉。
 */
export function isMentionAcceptKey(e: {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  return (e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey)
}
