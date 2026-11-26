// @vitest-environment happy-dom
/**
 * 外置提示词文件名：新文件统一落 .xml，用户输入里手写的 .md / .xml 不重复叠加。
 */
import { describe, expect, it } from 'vitest'
import { safePromptFileName } from '../src/agent/promptFileStore'

describe('safePromptFileName', () => {
  it('默认补 .xml，且不把旧的 .md / .xml 后缀叠成两层', () => {
    expect(safePromptFileName('补充规范')).toBe('补充规范.xml')
    expect(safePromptFileName('补充规范.md')).toBe('补充规范.xml')
    expect(safePromptFileName('补充规范.xml')).toBe('补充规范.xml')
  })

  it('清掉路径分隔符与 Windows 非法字符', () => {
    expect(safePromptFileName('../a/b:c')).toBe('a-b-c.xml')
  })
})
