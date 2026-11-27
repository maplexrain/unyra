// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest'

const memFiles = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/lib/storage', () => ({
  userPath: (rel: string) => rel,
  userAbsPath: (rel: string) => `/mem/${rel}`,
  listUserDir: async (rel: string) =>
    rel === 'doc-design'
      ? [...memFiles.keys()]
          .filter((key) => key.startsWith('doc-design/'))
          .map((key) => ({ name: key.slice('doc-design/'.length), dir: false }))
      : [],
  readUserText: async (rel: string) => memFiles.get(rel) ?? null,
  writeUserText: async (rel: string, content: string) => {
    memFiles.set(rel, content)
    return true
  },
  removeUserPath: async (rel: string) => {
    const had = memFiles.delete(rel)
    return had
  },
  mkdirUserPath: async () => true,
  onUserTextWritten: () => () => {},
}))

import {
  createDocumentComponentFile,
  listDocumentComponents,
  getDocumentComponent,
  registerDocumentComponent,
  updateDocumentComponent,
  deleteDocumentComponent,
} from '../src/lib/componentBlock/registry'
import { renderComponentPreview } from '../src/lib/componentBlock'
import { buildApi } from '../src/agent/sandbox/api'
import { WORK_API_PLANES, CONTENT_VOICES } from '../src/agent/agentProfile'
import { TABS } from '../src/components/settings/tabs'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { clearExternalModules } from '../src/lib/externalModules'
import type { SandboxCall, SandboxOptions } from '../src/agent/sandbox/types'

describe('Document Component Registry & Storage', () => {
  beforeEach(() => {
    localStorage.clear()
    memFiles.clear()
    clearExternalModules()
  })

  it('内置 9 个出版级排版配方组件完整在场', () => {
    const builtins = listDocumentComponents({ source: 'builtin' })
    expect(builtins.length).toBe(9)
    const tags = builtins.map((b) => b.tag)
    expect(tags).toContain('Notice')
    expect(tags).toContain('Compare')
    expect(tags).toContain('Formula')
    expect(tags).toContain('Steps')
    expect(tags).toContain('Pipeline')
    expect(tags).toContain('Stat')
    expect(tags).toContain('Concept')
    expect(tags).toContain('Breakdown')
    expect(tags).toContain('Quiz')
  })

  it('getDocumentComponent 支持按 tag 或 id 检索', () => {
    const byTag = getDocumentComponent('Notice')
    expect(byTag).toBeDefined()
    expect(byTag?.id).toBe('notice')

    const byId = getDocumentComponent('compare')
    expect(byId).toBeDefined()
    expect(byId?.tag).toBe('Compare')

    expect(getDocumentComponent('NonExistent')).toBeUndefined()
  })

  it('支持注册、更新与删除外部自定义组件', async () => {
    const source = `export default {
  kind: 'doc-component',
  id: 'myalert',
  tag: 'MyAlert',
  name: '我的警示卡',
  description: '重要提示卡片',
  slots: [{ name: 'describe', description: '卡片内容' }],
  component: ({ slots = {} }) => <div className="alert">{slots.describe}</div>,
}`
    // 1. 注册新组件（写 doc-design/doc-component--myalert.tsx）
    const regRes = await registerDocumentComponent({
      tag: 'MyAlert',
      name: '我的警示卡',
      description: '重要提示卡片',
      slots: [{ name: 'describe', description: '卡片内容' }],
      source,
    })
    expect(regRes.ok).toBe(true)
    expect(regRes.component?.id).toBe('myalert')
    expect(regRes.file).toContain('doc-design/doc-component--myalert.tsx')

    // 2. 检查外部清单来自 TSX 文件
    const customList = listDocumentComponents({ source: 'external' })
    expect(customList.length).toBe(1)
    expect(customList[0]!.tag).toBe('MyAlert')

    // 3. 更新组件
    const updateRes = await updateDocumentComponent('myalert', {
      name: '更新后的警示卡',
      description: '更新说明',
      source: source.replace("name: '我的警示卡'", "name: '更新后的警示卡'"),
    })
    expect(updateRes.ok).toBe(true)
    expect(getDocumentComponent('MyAlert')?.name).toBe('更新后的警示卡')

    // 4. 删除组件
    const delRes = await deleteDocumentComponent('myalert')
    expect(delRes.ok).toBe(true)
    expect(getDocumentComponent('MyAlert')).toBeUndefined()
    expect(listDocumentComponents({ source: 'external' }).length).toBe(0)
  })

  it('直接新建外部 TSX 模板文件，不经过表单元数据', async () => {
    const res = await createDocumentComponentFile()
    expect(res.ok).toBe(true)
    expect(res.file).toMatch(/^doc-design\/doc-component--custom-.+\.tsx$/)
    const src = memFiles.get(res.file!)
    expect(src).toContain("kind: 'doc-component'")
    expect(src).toContain('export default')
    expect(src).toContain('component:')
    expect(res.component?.source).toBe('external')
    expect(res.component?.file).toBe(res.file)
  })

  it('保护内置组件不被覆盖、修改或删除', async () => {
    // 覆盖
    const regBuiltin = await registerDocumentComponent({
      tag: 'Notice',
      name: '尝试顶替',
      description: 'test',
    })
    expect(regBuiltin.ok).toBe(false)
    expect(regBuiltin.error).toContain('不能覆盖内置组件')

    // 修改
    const updateBuiltin = await updateDocumentComponent('notice', { name: '新名字' })
    expect(updateBuiltin.ok).toBe(false)
    expect(updateBuiltin.error).toContain('内置组件不允许直接修改')

    // 删除
    const delBuiltin = await deleteDocumentComponent('notice')
    expect(delBuiltin.ok).toBe(false)
    expect(delBuiltin.error).toContain('内置组件不允许删除')
  })
})

describe('api.design.* Execute 沙箱集成与容错别名', () => {
  beforeEach(() => {
    localStorage.clear()
    memFiles.clear()
    clearExternalModules()
  })

  it('installDesign 挂载 design.component 与容错别名 design.componet', async () => {
    const log: SandboxCall[] = []
    const { api } = buildApi({} as unknown as SandboxOptions, log) as { api: any }

    expect(api.design).toBeDefined()
    expect(typeof api.design.component.list).toBe('function')
    expect(typeof api.design.component.get).toBe('function')
    expect(typeof api.design.component.register).toBe('function')
    expect(typeof api.design.component.update).toBe('function')
    expect(typeof api.design.component.delete).toBe('function')

    // 容错别名 design.componet (少了个 n)
    expect(api.design.componet).toBeDefined()
    expect(api.design.componet.list).toBe(api.design.component.list)
    expect(api.design.componet.get).toBe(api.design.component.get)

    // 1. api.design.component.list 只暴露简短描述以节省 token
    const listRes = await api.design.component.list()
    expect(listRes.ok).toBe(true)
    expect(listRes.components.length).toBeGreaterThanOrEqual(9)
    const first = listRes.components[0]
    expect(first.id).toBeDefined()
    expect(first.tag).toBeDefined()
    expect(first.name).toBeDefined()
    expect(first.description).toBeDefined()
    expect((first as any).template).toBeUndefined() // 不暴露模板以控制 token
    expect((first as any).render).toBeUndefined() // 已无字符串渲染回退

    // 2. api.design.component.get 获取完整签名
    const getRes = await api.design.component.get('Notice')
    expect(getRes.ok).toBe(true)
    expect(getRes.component.tag).toBe('Notice')
    expect(getRes.component.slots.length).toBeGreaterThan(0)
    expect(getRes.component.example).toContain('<Notice')

    // 3. api.design.componet.register 注册新组件（写外部 TSX 文件）
    const regRes = await api.design.componet.register({
      tag: 'CustomBadge',
      name: '自定义徽章',
      description: '动态徽章',
    })
    expect(regRes.ok).toBe(true)
    expect(regRes.file).toContain('doc-design/doc-component--custombadge.tsx')

    // 4. api.design.componet.delete
    const delRes = await api.design.componet.delete('custombadge')
    expect(delRes.ok).toBe(true)
  })
})

describe('内容生成声部（CONTENT_VOICES）排版指南与 API 持面一致性', () => {
  it('所有 CONTENT_VOICES (tutor, examiner, designer) 的 work 均持有 design API 组', () => {
    for (const voice of CONTENT_VOICES) {
      const groups = WORK_API_PLANES[voice].groups
      expect(groups, `${voice} 必须持有 design API 组`).toContain('design')
    }
  })

  it('所有 CONTENT_VOICES 的 work 共用排版指南与 component 围栏指引', () => {
    const tutor = buildWorkSystem('tutor')
    const examiner = buildWorkSystem('examiner')
    const designer = buildWorkSystem('designer')

    for (const prompt of [tutor, examiner, designer]) {
      expect(prompt).toContain('```component')
      expect(prompt).toContain('api.design.component.list')
      expect(prompt).toContain('排版层级与基础规范')
    }
  })

  it('设置中包含文档设计第一层页签 (doc-design)', () => {
    const docDesignTab = TABS.find((t) => t.key === 'doc-design')
    expect(docDesignTab).toBeDefined()
    expect(docDesignTab?.label).toBe('设计')

    // 外观中不再包含 doc-design 子页签
    const appearanceTab = TABS.find((t) => t.key === 'appearance')
    const docDesignSubTab = appearanceTab?.subTabs?.find((s) => s.key === 'doc-design')
    expect(docDesignSubTab).toBeUndefined()
  })

  it('renderComponentPreview 正常解析并渲染出组件出版级样式 HTML', () => {
    const noticeDef = getDocumentComponent('Notice')!
    const html = renderComponentPreview(noticeDef.example)
    expect(html).toContain('border-l-warn')
    expect(html).toContain('易错陷阱 · 边界条件')
  })
})
