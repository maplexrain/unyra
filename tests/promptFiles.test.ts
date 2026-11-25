/**
 * 提示词文件：归一化、内外文件顺序、启停与运行时装配。
 *
 * 外置文件的内容住在 prompts/ 与 agents/<id>/prompts/ 的 md 里（由 promptFileStore 扫描），
 * 这里把 store 换成一份内存里的假文件库，验证「显式选择加入 + 按层编排」。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PROMPT_FILE_SETTINGS,
  normalizePromptFileSettings,
} from '../src/agent/promptFiles'
import { normalizeAgentSettings } from '../src/agent/settings'

vi.mock('../src/agent/promptFileStore', () => {
  const files = [
    {
      id: 'ext:补充规范.md',
      fileName: '补充规范.md',
      relPath: 'prompts/补充规范.md',
      scope: 'common',
      name: '补充规范',
      content: 'EXTERNAL-CONTENT',
    },
    {
      id: 'ext:work 附加.md',
      fileName: 'work 附加.md',
      relPath: 'prompts/work 附加.md',
      scope: 'common',
      name: 'work 附加',
      content: 'WORK-EXT',
    },
    {
      id: 'agent:tutor:导师专属.md',
      fileName: '导师专属.md',
      relPath: 'agents/tutor/prompts/导师专属.md',
      scope: 'agent',
      agentId: 'tutor',
      name: '导师专属',
      content: 'TUTOR-ONLY',
    },
  ]
  return {
    getExternalPromptFiles: (agentId?: string) =>
      agentId
        ? files.filter((file) => file.scope === 'common' || file.agentId === agentId)
        : files,
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
  it('只有显式加入当前层的文件才注入；没加入的外置文件不会自动应用', () => {
    const none = listPromptFiles('tutor', 'role', DEFAULT_PROMPT_FILE_SETTINGS)
    expect(none.some((file) => file.id.startsWith('ext:'))).toBe(false)
    expect(none.some((file) => file.id.startsWith('agent:'))).toBe(false)
    expect(buildPromptFileSystem('tutor', 'role', DEFAULT_PROMPT_FILE_SETTINGS)).not.toContain('EXTERNAL-CONTENT')
  })

  it('role 层按用户顺序注入已加入的外置文件，停用的内置项不参与拼接', () => {
    const builtin = listPromptFiles('tutor', 'role', DEFAULT_PROMPT_FILE_SETTINGS)
    const settings = normalizePromptFileSettings({
      order: { tutor: { role: ['ext:补充规范.md'] } },
      disabled: { tutor: { role: builtin.filter((file) => file.builtin).map((file) => file.id) } },
    })
    expect(buildPromptFileSystem('tutor', 'role', settings)).toBe('EXTERNAL-CONTENT')
    expect(listPromptFiles('tutor', 'role', settings)[0]).toMatchObject({
      id: 'ext:补充规范.md',
      order: 1,
      enabled: true,
      builtin: false,
      fileName: '补充规范.md',
      scope: 'common',
    })
  })

  it('专属文件只对所属 agent 可见，且同样需要显式加入', () => {
    const settings = normalizePromptFileSettings({
      order: { tutor: { role: ['agent:tutor:导师专属.md'] } },
    })
    const tutor = listPromptFiles('tutor', 'role', settings)
    expect(tutor.some((file) => file.id === 'agent:tutor:导师专属.md')).toBe(true)
    expect(buildPromptFileSystem('tutor', 'role', settings)).toContain('TUTOR-ONLY')

    const dispatcher = listPromptFiles('dispatcher', 'role', settings)
    expect(dispatcher.some((file) => file.id === 'agent:tutor:导师专属.md')).toBe(false)
  })

  it('同一文件在不同层分别选择、分别启停', () => {
    const settings = normalizePromptFileSettings({
      order: { tutor: { role: ['ext:补充规范.md'], work: ['ext:work 附加.md'] } },
      disabled: { tutor: { work: ['ext:work 附加.md'] } },
    })
    const work = listPromptFiles('tutor', 'work', settings)
    expect(work.some((file) => file.id === 'ext:补充规范.md')).toBe(false)
    expect(work.find((file) => file.id === 'ext:work 附加.md')?.enabled).toBe(false)
  })
})
