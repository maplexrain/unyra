// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'

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

import {
  createClassroomAnimationFile,
  createClassroomComponentFile,
  createClassroomSoundFile,
  listClassroomComponents,
  listClassroomAnimations,
  registerClassroomComponent,
  registerClassroomAnimation,
  unregisterClassroomComponent,
  unregisterClassroomAnimation,
  getClassroomComponent,
  getClassroomAnimation,
} from '../src/learn/classroom/registry'
import { expandClassroomComponents } from '../src/learn/classroom/components'
import { buildApi } from '../src/agent/sandbox/api'
import { clearExternalModules } from '../src/lib/externalModules'

describe('Classroom Component & Animation Registry', () => {
  beforeEach(() => {
    localStorage.clear()
    memFiles.clear()
    clearExternalModules()
  })

  it('lists builtin components and animations', () => {
    const comps = listClassroomComponents()
    expect(comps.length).toBeGreaterThanOrEqual(12)
    expect(comps.some((c) => c.tag === 'ui-card')).toBe(true)
    expect(comps.some((c) => c.tag === 'ui-concept')).toBe(true)
    expect(comps.some((c) => c.tag === 'ui-compare')).toBe(true)

    const anims = listClassroomAnimations()
    expect(anims.length).toBeGreaterThanOrEqual(16)
    expect(anims.some((a) => a.verb === 'popIn')).toBe(true)
    expect(anims.some((a) => a.verb === 'bounce')).toBe(true)
    expect(anims.some((a) => a.verb === 'glow')).toBe(true)
    // 卡牌库宣传名与 runAnimeAnimation 实现名逐字一致（slideInUp/Down 已按实现改名）
    expect(anims.some((a) => a.verb === 'slideInTop')).toBe(true)
    expect(anims.some((a) => a.verb === 'slideInBottom')).toBe(true)
    expect(anims.some((a) => a.verb === 'slideInUp')).toBe(false)
    expect(anims.some((a) => a.verb === 'slideInDown')).toBe(false)
  })

  it('allows registering and unregistering external components', async () => {
    const source = `export default {
  kind: 'classroom-component',
  tag: 'ui-chem-reaction',
  name: '化学反应式',
  description: '展示化学方程式与反应条件',
  defaultProps: { equation: '2H2 + O2 -> 2H2O' },
  component: ({ content = '', props = {}, attrs = {} }) => {
    const merged = { ...props, ...attrs }
    return (
      <div className="chem-box">
        <h4>{merged.equation}</h4>
        <div className="chem-desc" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    )
  },
}`
    const regRes = await registerClassroomComponent({
      tag: 'ui-chem-reaction',
      name: '化学反应式',
      description: '展示化学方程式与反应条件',
      defaultProps: { equation: '2H2 + O2 -> 2H2O' },
      source,
    })
    expect(regRes.ok).toBe(true)
    expect(regRes.file).toContain('classroom-component--ui-chem-reaction.tsx')

    const comp = getClassroomComponent('ui-chem-reaction')
    expect(comp).toBeDefined()
    expect(comp?.source).toBe('external')
    expect(comp?.name).toBe('化学反应式')

    // 展开自定义组件
    const inputHtml = '<ui-chem-reaction equation="N2 + 3H2 -> 2NH3">催化剂加热加压</ui-chem-reaction>'
    const expanded = expandClassroomComponents(inputHtml)
    expect(expanded).toContain('N2 + 3H2 -&gt; 2NH3')
    expect(expanded).toContain('催化剂加热加压')
    expect(expanded).toContain('chem-box')

    // 注销
    const unreg = await unregisterClassroomComponent('ui-chem-reaction')
    expect(unreg).toBe(true)
    expect(getClassroomComponent('ui-chem-reaction')).toBeUndefined()
  })

  it('直接新建组件/动效/音效模板文件，不经过表单', async () => {
    const comp = await createClassroomComponentFile()
    expect(comp.ok).toBe(true)
    expect(comp.file).toMatch(/^doc-design\/classroom-component--ui-new-.+\.tsx$/)
    expect(memFiles.get(comp.file!)).toContain("kind: 'classroom-component'")
    expect(memFiles.get(comp.file!)).toContain('component:')

    const anim = await createClassroomAnimationFile()
    expect(anim.ok).toBe(true)
    expect(anim.file).toMatch(/^doc-design\/classroom-animation--new-.+\.tsx$/)
    expect(memFiles.get(anim.file!)).toContain("kind: 'classroom-animation'")

    const sound = await createClassroomSoundFile()
    expect(sound.ok).toBe(true)
    expect(sound.file).toMatch(/^doc-design\/classroom-sound--sound-.+\.tsx$/)
    expect(memFiles.get(sound.file!)).toContain('play(v, kit)')
  })

  it('allows registering and querying custom animations', async () => {
    const regRes = await registerClassroomAnimation({
      verb: 'quantumVibrate',
      name: '量子高频微颤',
      description: '极小幅度超高频微颤动',
      keyframes: { translateX: [-2, 2, -2], translateY: [1, -1, 1] },
      duration: 300,
    })
    expect(regRes.ok).toBe(true)

    const anim = getClassroomAnimation('quantumVibrate')
    expect(anim).toBeDefined()
    expect(anim?.source).toBe('external')
    expect(anim?.duration).toBe(300)

    const unreg = await unregisterClassroomAnimation('quantumVibrate')
    expect(unreg).toBe(true)
    expect(getClassroomAnimation('quantumVibrate')).toBeUndefined()
  })

  it('builtin 组件示例里的属性真的被展开器读（registry 示例 ↔ components.ts 对齐）', () => {
    // 曾经的示例教了不存在的属性（summary / note / ratio / variant）——冒烟钉住
    expect(expandClassroomComponents('<ui-badge color="sky">重点</ui-badge>')).toContain('badge-sky')
    expect(expandClassroomComponents('<ui-concept term="极限" keypoint="要记">逼近</ui-concept>')).toContain('concept-keypoint')
    expect(expandClassroomComponents('<ui-quiz question="2+2?"><ui-option label="B">4</ui-option></ui-quiz>')).toContain('quiz-option')
    expect(expandClassroomComponents('<ui-steps><ui-step num="1" title="化简">先通分</ui-step></ui-steps>')).toContain('step-item')
    expect(expandClassroomComponents('<ui-formula latex="a^2+b^2=c^2" desc="勾股"></ui-formula>')).toContain('formula-box')
  })

  it('prohibits overwriting builtin components or invalid tags', async () => {
    const badTag = await registerClassroomComponent({
      tag: 'invalid_tag',
      name: '错格式',
      description: '...',
    })
    expect(badTag.ok).toBe(false)

    const overwriteBuiltin = await registerClassroomComponent({
      tag: 'ui-card',
      name: '覆盖卡片',
      description: '...',
    })
    expect(overwriteBuiltin.ok).toBe(false)
  })

  it('provides sandbox execute APIs under api.classroom.*', async () => {
    const { api } = buildApi({
      root: 'E:/test',
      activeUserId: 'u1',
    } as any)

    const classroomApi = (api as any).classroom
    expect(classroomApi).toBeDefined()
    expect(typeof classroomApi.components).toBe('function')
    expect(typeof classroomApi.animations).toBe('function')
    expect(typeof classroomApi.registerComponent).toBe('function')
    expect(typeof classroomApi.registerAnimation).toBe('function')
    expect(typeof classroomApi.schema).toBe('function')
    expect(typeof classroomApi.verbs).toBe('function')
    expect(typeof classroomApi.check).toBe('function')

    // schema 契约：结构 + 最小完整示例（示例本身要能过 audit）
    const schemaRes = await classroomApi.schema()
    expect(schemaRes.ok).toBe(true)
    const example = schemaRes.schema.example.scenes[0]
    expect(Array.isArray(example.actions)).toBe(true)
    expect(example.actions[0].type).toBe('speak')

    // verbs 白名单与 data-anim 表显式分开
    const verbsRes = await classroomApi.verbs()
    expect(verbsRes.ok).toBe(true)
    expect(verbsRes.state.some((v: { verb: string }) => v.verb === 'appear')).toBe(true)
    expect(verbsRes.anime.some((v: { verb: string }) => v.verb === 'slideInTop')).toBe(true)

    // check 在没有 NodeService 注入时给「没有」回执而不是抛错
    const checkRes = await classroomApi.check({})
    expect(checkRes.error).toContain('节点能力')

    // Agent 查询组件与动效
    const compsRes = await classroomApi.components()
    expect(compsRes.ok).toBe(true)
    expect(compsRes.components.length).toBeGreaterThanOrEqual(12)

    const animsRes = await classroomApi.animations()
    expect(animsRes.ok).toBe(true)
    expect(animsRes.animations.length).toBeGreaterThanOrEqual(16)

    // Agent 动态创作注册组件
    const regRes = await classroomApi.registerComponent({
      tag: 'ui-algo-node',
      name: '算法拓扑节点',
      description: '表示图算法中的一个顶点',
      source: `export default {
  kind: 'classroom-component',
  tag: 'ui-algo-node',
  name: '算法拓扑节点',
  description: '表示图算法中的一个顶点',
  component: ({ props = {}, attrs = {} }) => <div className="algo-node">{props.title ?? attrs.title}</div>,
}`,
    })
    expect(regRes.ok).toBe(true)

    const checkComp = getClassroomComponent('ui-algo-node')
    expect(checkComp).toBeDefined()
    expect(checkComp?.name).toBe('算法拓扑节点')
  })
})
