// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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
  removeUserPath: async (rel: string) => memFiles.delete(rel),
  mkdirUserPath: async () => true,
  onUserTextWritten: () => () => {},
}))

import { compileExternalTsx } from '../src/lib/externalModules/compile'
import { classroomComponentTemplate, docComponentTemplate } from '../src/lib/externalModules/templates'
import {
  clearExternalModules,
  hydrateExternalModules,
  listExternalModules,
  stopExternalModulesPolling,
  writeExternalModuleFile,
} from '../src/lib/externalModules'
import {
  listDocumentComponents,
  registerDocumentComponent,
} from '../src/lib/componentBlock/registry'
import { renderComponentPreview } from '../src/lib/componentBlock'
import { expandClassroomComponents } from '../src/learn/classroom/components'
import { registerClassroomComponent } from '../src/learn/classroom/registry'

describe('外部 TSX 动态组件', () => {
  beforeEach(() => {
    memFiles.clear()
    clearExternalModules()
  })

  it('编译 TSX、执行 export default，并渲染 React 组件', () => {
    const result = compileExternalTsx(
      `export default {
  kind: 'doc-component',
  id: 'tsx-card',
  tag: 'TsxCard',
  name: 'TSX 卡片',
  description: '动态组件',
  slots: [{ name: 'title', description: '标题' }, { name: 'describe', description: '正文' }],
  component: ({ slots = { title: '', describe: '' } }) => (
    <section className="tsx-card">
      <h1>{slots.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: slots.describe }} />
    </section>
  ),
}`,
      'doc-component--tsx-card.tsx',
    )
    expect(result.error).toBeUndefined()
    expect(result.def?.tag).toBe('TsxCard')
    expect(typeof result.def?.component).toBe('function')
  })

  it('默认模板直接用 JSX 声明结构，而不是 HTML 字符串模板', () => {
    const docSrc = docComponentTemplate({
      id: 'fresh-doc',
      tag: 'FreshDoc',
      name: '新建文档组件',
      description: '默认模板',
    })
    expect(docSrc).not.toContain('template:')
    expect(docSrc).not.toContain('const html = "<div')
    expect(docSrc).toContain('return (')
    expect(docSrc).toContain('style={{')
    expect(docSrc).toContain('"name": "title"')

    const docCompiled = compileExternalTsx(docSrc, 'doc-component--fresh-doc.tsx')
    expect(docCompiled.error).toBeUndefined()
    const docHtml = renderToStaticMarkup(
      createElement(docCompiled.def!.component as never, {
        slots: { title: 'JSX 标题', describe: '<strong>JSX 正文</strong>' },
        attrs: {},
      }),
    )
    expect(docHtml).toContain('JSX 标题')
    expect(docHtml).toContain('JSX 正文')

    const classSrc = classroomComponentTemplate({
      tag: 'fresh-class',
      name: '新建课堂组件',
      description: '默认模板',
    })
    expect(classSrc).not.toContain('const html = "<div')
    expect(classSrc).toContain('return (')
    const classCompiled = compileExternalTsx(classSrc, 'classroom-component--fresh-class.tsx')
    expect(classCompiled.error).toBeUndefined()
    const classHtml = renderToStaticMarkup(
      createElement(classCompiled.def!.component as never, {
        content: '<strong>课堂正文</strong>',
        props: { title: '课堂标题' },
        attrs: {},
      }),
    )
    expect(classHtml).toContain('课堂标题')
    expect(classHtml).toContain('课堂正文')
  })

  it('文档注册中心接入 TSX 组件并输出 HTML', async () => {
    const registered = await registerDocumentComponent({
      tag: 'TsxCard',
      name: 'TSX 卡片',
      description: '动态组件',
      source: `export default {
  kind: 'doc-component',
  id: 'tsx-card',
  tag: 'TsxCard',
  name: 'TSX 卡片',
  description: '动态组件',
  slots: [{ name: 'title', description: '标题' }, { name: 'describe', description: '正文' }],
  example: '<TsxCard><div #title>标题</div><div #describe>正文</div></TsxCard>',
  component: ({ slots = { title: '', describe: '' } }) => (
    <section className="tsx-card">
      <h1>{slots.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: slots.describe }} />
    </section>
  ),
}`,
    })
    expect(registered.ok).toBe(true)
    expect(registered.file).toMatch(/doc-component--tsxcard\.tsx$/)
    expect(listDocumentComponents({ source: 'external' })[0]?.component).toBeTypeOf('function')

    const html = renderComponentPreview(
      '<TsxCard><div #title>实时标题</div><div #describe><strong>实时正文</strong></div></TsxCard>',
    )
    expect(html).toContain('tsx-card')
    expect(html).toContain('实时标题')
    expect(html).toContain('实时正文')
  })

  it('课堂注册中心接入 TSX 组件并展开 DSL', async () => {
    const registered = await registerClassroomComponent({
      tag: 'ui-tsx-card',
      name: 'TSX 课堂卡',
      description: '动态课堂组件',
      source: `export default {
  kind: 'classroom-component',
  tag: 'ui-tsx-card',
  name: 'TSX 课堂卡',
  description: '动态课堂组件',
  defaultProps: { title: '默认标题' },
  component: ({ content = '', props = {} }) => (
    <article className="tsx-classroom">
      <h3>{props.title}</h3>
      <div dangerouslySetInnerHTML={{ __html: content }} />
    </article>
  ),
}`,
    })
    expect(registered.ok).toBe(true)
    expect(registered.file).toMatch(/classroom-component--ui-tsx-card\.tsx$/)

    const html = expandClassroomComponents('<ui-tsx-card title="课堂标题">课堂正文</ui-tsx-card>')
    expect(html).toContain('tsx-classroom')
    expect(html).toContain('课堂标题')
    expect(html).toContain('课堂正文')
  })

  it('旧版 .js 与 template 组件不再迁移，也不会被加载', async () => {
    memFiles.set(
      'doc-design/classroom-component--legacy-js.js',
      `module.exports = {
  kind: 'classroom-component',
  tag: 'legacy-js',
  name: '旧版模板组件',
  description: '从 js 迁移',
  template: '<div class="legacy-js">{{title}}<div>{{content}}</div></div>',
  defaultProps: { title: '旧版标题' },
}`,
    )
    memFiles.set(
      'doc-design/doc-component--legacy-template.tsx',
      `export default {
  kind: 'doc-component',
  tag: 'LegacyTemplate',
  name: '旧版模板卡',
  description: '没有 component',
  template: '<div class="legacy-template">{{content}}</div>',
}`,
    )
    await hydrateExternalModules()
    expect(memFiles.has('doc-design/classroom-component--legacy-js.tsx')).toBe(false)
    expect(memFiles.has('doc-design/classroom-component--legacy-js.js')).toBe(true)
    expect(listExternalModules('classroom-component')).toHaveLength(0)
    expect(listExternalModules('doc-component')).toHaveLength(0)
    stopExternalModulesPolling()
  })

  it('编译失败会留下可读错误，不执行坏模块', async () => {
    const result = await writeExternalModuleFile(
      'doc-component--broken.tsx',
      `export default {
  kind: 'doc-component',
  tag: 'Broken',
  component: () => <div>broken</div>
`,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('TSX 编译失败')
  })
})
