/**
 * 提示词文件：归一化、内外文件顺序、启停与运行时装配。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROMPT_FILE_SETTINGS,
  normalizePromptFileSettings,
} from '../src/agent/promptFiles'
import { normalizeAgentSettings } from '../src/agent/settings'
import { buildPromptFileSystem, listPromptFiles } from '../src/learn/ai/promptFiles'

describe('提示词文件归一化', () => {
  it('旧数据没有字段时给空库', () => {
    expect(normalizePromptFileSettings(undefined)).toEqual(DEFAULT_PROMPT_FILE_SETTINGS)
    expect(normalizeAgentSettings({}).promptFiles).toEqual(DEFAULT_PROMPT_FILE_SETTINGS)
  })

  it('外置文件去重、截断；order / disabled 只保留合法 agent 与字符串 id', () => {
    const files = normalizePromptFileSettings({
      external: [
        { id: 'ext-a', name: '  补充规范  ', layer: 'work', content: '内容 A' },
        { id: 'ext-a', name: '重复', layer: 'role', content: '重复' },
        { id: '', name: '空 id', layer: 'role', content: '' },
        { id: 'ext-b', name: '', layer: 'role', content: '' },
      ],
      order: { tutor: { role: ['x', 'x', 'y'] }, nope: { role: ['z'] } },
      disabled: { tutor: { work: ['w'] } },
    })
    expect(files.external).toHaveLength(1)
    expect(files.external[0]).toMatchObject({ id: 'ext-a', name: '补充规范', layer: 'work' })
    expect(files.order?.tutor?.role).toEqual(['x', 'y'])
    expect(files.order).not.toHaveProperty('nope')
    expect(files.disabled?.tutor?.work).toEqual(['w'])
  })
})

describe('提示词文件装配', () => {
  it('role 层按用户顺序注入，停用的内置项不参与拼接', () => {
    const builtin = listPromptFiles('tutor', 'role', DEFAULT_PROMPT_FILE_SETTINGS)
    expect(builtin.length).toBeGreaterThanOrEqual(3)

    const settings = normalizePromptFileSettings({
      external: [{ id: 'ext-x', name: '外置', layer: 'role', content: 'EXTERNAL-CONTENT' }],
      order: { tutor: { role: ['ext-x'] } },
      disabled: { tutor: { role: builtin.map((file) => file.id) } },
    })
    expect(buildPromptFileSystem('tutor', 'role', settings)).toBe('EXTERNAL-CONTENT')
    expect(listPromptFiles('tutor', 'role', settings)[0]).toMatchObject({
      id: 'ext-x',
      order: 1,
      enabled: true,
      builtin: false,
    })
  })

  it('work 层内置项来自 workSystem 的分段，外置项各自只进本层', () => {
    const settings = normalizePromptFileSettings({
      external: [
        { id: 'ext-work', name: 'work 附加', layer: 'work', content: 'WORK-EXT' },
        { id: 'ext-role', name: 'role 附加', layer: 'role', content: 'ROLE-EXT' },
      ],
    })
    const work = listPromptFiles('tutor', 'work', settings)
    expect(work.some((file) => file.id === 'work-base')).toBe(true)
    expect(work.some((file) => file.id === 'ext-work')).toBe(true)
    expect(work.some((file) => file.id === 'ext-role')).toBe(false)

    const role = listPromptFiles('tutor', 'role', settings)
    expect(role.some((file) => file.id === 'ext-role')).toBe(true)
    expect(role.some((file) => file.id === 'ext-work')).toBe(false)
  })
})
