/**
 * 提示词文件：归一化、内外文件顺序、启停与运行时装配。
 *
 * 外置文件的内容住在 prompts/ 的 md 里（由 promptFileStore 扫描），
 * 这里把 store 换成一份内存里的假文件库，验证「共用 + 按层编排」。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PROMPT_FILE_SETTINGS,
  normalizePromptFileSettings,
} from '../src/agent/promptFiles'
import { normalizeAgentSettings } from '../src/agent/settings'

vi.mock('../src/agent/promptFileStore', () => {
  const files = [
    { id: 'ext:补充规范.md', fileName: '补充规范.md', name: '补充规范', content: 'EXTERNAL-CONTENT' },
    { id: 'ext:work 附加.md', fileName: 'work 附加.md', name: 'work 附加', content: 'WORK-EXT' },
  ]
  return {
    getExternalPromptFiles: () => files,
    subscribePromptFiles: () => () => {},
  }
})

const { buildPromptFileSystem, listPromptFiles } = await import('../src/learn/ai/promptFiles')

describe('提示词文件归一化', () => {
  it('旧数据没有字段时给空库', () => {
    expect(normalizePromptFileSettings(undefined)).toEqual(DEFAULT_PROMPT_FILE_SETTINGS)
    expect(normalizeAgentSettings({}).promptFiles).toEqual(DEFAULT_PROMPT_FILE_SETTINGS)
  })

  it('旧 external 字段被忽略；order / disabled 只保留合法 agent 与字符串 id', () => {
    const files = normalizePromptFileSettings({
      external: [{ id: 'ext-a', name: '旧版外置', layer: 'work', content: '内容 A' }],
      order: { tutor: { role: ['x', 'x', 'y'] }, nope: { role: ['z'] } },
      disabled: { tutor: { work: ['w'] } },
    })
    expect(files).not.toHaveProperty('external')
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
      order: { tutor: { role: ['ext:补充规范.md'] } },
      disabled: { tutor: { role: builtin.filter((file) => file.builtin).map((file) => file.id) } },
    })
    expect(buildPromptFileSystem('tutor', 'role', settings)).toBe('EXTERNAL-CONTENT\n\nWORK-EXT')
    expect(listPromptFiles('tutor', 'role', settings)[0]).toMatchObject({
      id: 'ext:补充规范.md',
      order: 1,
      enabled: true,
      builtin: false,
      fileName: '补充规范.md',
    })
  })

  it('外置文件全员共用：role / work 两层都可见，各自按层启停', () => {
    const settings = normalizePromptFileSettings({
      disabled: { tutor: { work: ['ext:work 附加.md'] } },
    })
    const work = listPromptFiles('tutor', 'work', settings)
    expect(work.some((file) => file.id === 'work-base')).toBe(true)
    expect(work.some((file) => file.id === 'ext:补充规范.md')).toBe(true)
    expect(work.find((file) => file.id === 'ext:work 附加.md')?.enabled).toBe(false)

    const role = listPromptFiles('tutor', 'role', settings)
    expect(role.some((file) => file.id === 'ext:补充规范.md')).toBe(true)
    expect(role.some((file) => file.id === 'ext:work 附加.md')).toBe(true)
  })
})
