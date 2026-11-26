import { describe, expect, it } from 'vitest'
import { splitChatText } from '../src/lib/chatText'

describe('splitChatText', () => {
  it('没有分隔线时整段都是简短内容', () => {
    expect(splitChatText('已经处理完了。')).toEqual({ brief: '已经处理完了。', detail: '' })
  })

  it('按第一条单独一行 --- 切分，并保留详细段里的后续内容', () => {
    const parts = splitChatText('讲义已更新。\n--- \n补了定义。\n\n---\n还补了两道例题。')
    expect(parts.brief).toBe('讲义已更新。')
    expect(parts.detail).toBe('补了定义。\n\n---\n还补了两道例题。')
  })

  it('代码围栏里的 --- 不当作分隔线', () => {
    const parts = splitChatText('```md\n---\n```\n已经改好了。')
    expect(parts).toEqual({ brief: '```md\n---\n```\n已经改好了。', detail: '' })
  })

  it('分隔线在代码围栏外仍然生效', () => {
    const parts = splitChatText('已经改好了。\n---\n```diff\n- a\n+ b\n```')
    expect(parts.brief).toBe('已经改好了。')
    expect(parts.detail).toBe('```diff\n- a\n+ b\n```')
  })

  it('分隔线前或后为空时不切分，避免普通水平线误伤', () => {
    expect(splitChatText('---\n只有详细内容')).toEqual({ brief: '---\n只有详细内容', detail: '' })
    expect(splitChatText('只有简短内容\n---\n')).toEqual({ brief: '只有简短内容\n---', detail: '' })
  })
})
