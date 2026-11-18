import { describe, it, expect } from 'vitest'
import { auditCourse } from '../src/learn/classroom/audit'
import { normalizeClassrooms } from '../src/learn/classroom/store'
import { buildTimelineBeats } from '../src/learn/classroom/timeline'
import { VISUAL_VERB_WHITELIST } from '../src/learn/classroom/verbs'
import { BUILTIN_ANIMATIONS } from '../src/learn/classroom/registry'
import { CLASSROOM_COURSE_EXAMPLE, CLASSROOM_LAYOUT } from '../src/learn/classroom/contract'

/** 深拷贝契约里的最小示例当底稿，逐项破坏看校验是否接得住 */
const okCourse = () => JSON.parse(JSON.stringify(CLASSROOM_COURSE_EXAMPLE))

describe('classroom course audit（写入校验 + 静态体检）', () => {
  it('契约示例本身是干净样本', () => {
    const r = auditCourse(okCourse())
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.stats).toEqual({ scenes: 1, actions: 6, speaks: 3, visuals: 2 })
  })

  it('自造 beats 字段（缺 actions）被点名纠错', () => {
    const c = okCourse() as Record<string, unknown>
    const scene = (c.scenes as Array<Record<string, unknown>>)[0]
    scene.beats = scene.actions
    delete scene.actions
    const r = auditCourse(c)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('actions')
    expect(r.errors[0]).toContain('beats')
  })

  it('data-anim 名想当然填进 verb：slideInUp 不在白名单，slideInTop 在', () => {
    const c = okCourse()
    const actions = (c.scenes as Array<{ actions: Array<Record<string, unknown>> }>)[0].actions
    actions[1].verb = 'slideInUp'
    expect(auditCourse(c).errors.some((e) => e.includes('slideInUp'))).toBe(true)
    actions[1].verb = 'slideInTop'
    expect(auditCourse(c).errors).toEqual([])
  })

  it('未知 verb 拒绝', () => {
    const c = okCourse()
    const actions = (c.scenes as Array<{ actions: Array<Record<string, unknown>> }>)[0].actions
    actions[1].verb = 'wiggleOut'
    const r = auditCourse(c)
    expect(r.errors.some((e) => e.includes('wiggleOut') && e.includes('白名单'))).toBe(true)
  })

  it('悬空 target（html 里没有对应 id）拒绝', () => {
    const c = okCourse()
    const actions = (c.scenes as Array<{ actions: Array<Record<string, unknown>> }>)[0].actions
    actions[1].target = 'ghost-card'
    expect(auditCourse(c).errors.some((e) => e.includes('ghost-card'))).toBe(true)
  })

  it('缺 html / 缺 id 拒绝；未知 action type 拒绝', () => {
    const c = okCourse()
    const scene = (c.scenes as Array<Record<string, unknown>>)[0]
    delete scene.html
    const r1 = auditCourse(c)
    expect(r1.errors.some((e) => e.includes('.html'))).toBe(true)

    const c2 = okCourse()
    const s2 = (c2.scenes as Array<Record<string, unknown>>)[0]
    delete s2.id
    expect(auditCourse(c2).errors.some((e) => e.includes('.id'))).toBe(true)

    const c3 = okCourse()
    const actions = (c3.scenes as Array<{ actions: Array<Record<string, unknown>> }>)[0].actions
    actions.push({ type: 'zoom', target: 'answer' })
    expect(auditCourse(c3).errors.some((e) => e.includes('"zoom"'))).toBe(true)
  })

  it('字幕纪律：句号与超长句给 warning（不拒存），subtitle 不一致也被点名', () => {
    const c = okCourse()
    const actions = (c.scenes as Array<{ actions: Array<Record<string, unknown>> }>)[0].actions
    actions[0].text = '这是一个非常非常非常长并且还带了句号的讲解句子啊。'
    actions[2].subtitle = '跟 text 不一样'
    const r = auditCourse(c)
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w) => w.includes('句号'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('20'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('subtitle'))).toBe(true)
  })

  it('data-hidden 死锁与 appear 对可见元素无效都给 warning', () => {
    const c = okCourse()
    const scene = (c.scenes as Array<{ html: string; actions: Array<Record<string, unknown>> }>)[0]
    scene.actions = scene.actions.filter((a) => !(a.type === 'visual' && a.target === 'question'))
    const r1 = auditCourse(c)
    expect(r1.warnings.some((w) => w.includes('question') && w.includes('从未被唤醒'))).toBe(true)

    const c2 = okCourse()
    const s2 = (c2.scenes as Array<{ html: string; actions: Array<Record<string, unknown>> }>)[0]
    s2.html = s2.html.replace('<h2 id="question" data-hidden>', '<h2 id="question">')
    const r2 = auditCourse(c2)
    expect(r2.errors).toEqual([])
    expect(r2.warnings.some((w) => w.includes('appear') && w.includes('question'))).toBe(true)
  })

  it('有讲解没动效的画面给 warning；course 未知顶层字段给 warning', () => {
    const c = okCourse()
    const scene = (c.scenes as Array<{ actions: Array<Record<string, unknown>> }>)[0]
    scene.actions = scene.actions.filter((a) => a.type === 'speak')
    ;(c as Record<string, unknown>).bogusField = 1
    const r = auditCourse(c)
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w) => w.includes('没有') && w.includes('visual'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('bogusField'))).toBe(true)
  })

  it('course 形状不对一步拒回（缺 scenes / 根本不是对象）', () => {
    expect(auditCourse({ title: '只有标题' }).errors[0]).toContain('scenes')
    expect(auditCourse(null).errors.length).toBe(1)
    expect(auditCourse('course').errors.length).toBe(1)
  })

  it('html 藏 <script> 或 on* 内联事件直接拒存（渲染器 innerHTML 不挡 on*）', () => {
    const c = okCourse()
    const scene = (c.scenes as Array<{ html: string; actions: unknown[] }>).at(-1)!
    scene.html = '<div id="x" onclick="alert(1)">点我</div>'
    expect(auditCourse(c).errors.some((e) => e.includes('on*'))).toBe(true)
    scene.html = '<div id="x">文本</div><script>steal()</script>'
    expect(auditCourse(c).errors.some((e) => e.includes('<script>'))).toBe(true)
    // data-on-click 这类非事件属性不误伤
    scene.html = '<div id="x" data-on-click="no">ok</div>'
    scene.actions = []
    expect(auditCourse(c).errors).toEqual([])
  })

  it('动词白名单覆盖 registry 的全部 data-anim 名（pulse 除外：它是状态动词）', () => {
    for (const def of BUILTIN_ANIMATIONS) {
      if (def.verb === 'pulse') continue
      expect(VISUAL_VERB_WHITELIST.has(def.verb)).toBe(true)
    }
    expect(VISUAL_VERB_WHITELIST.has('appear')).toBe(true)
    expect(VISUAL_VERB_WHITELIST.has('slideInUp')).toBe(false)
  })

  it('布局常量契约齐备（画布 / padding / 预设类）', () => {
    expect(CLASSROOM_LAYOUT.canvas).toContain('1920')
    expect(CLASSROOM_LAYOUT.padding).toContain('120px')
    const names = CLASSROOM_LAYOUT.presetClasses.map((p) => p.name)
    for (const cls of ['stage-header', 'stage-title', 'stage-center', 'stage-top-title']) {
      expect(names).toContain(cls)
    }
  })
})

describe('读盘自愈（normalizeClassrooms 兜旧 agent 的 beats 形状坏数据）', () => {
  it('缺 actions 的 scene 采纳 beats、缺字段补默认、垃圾条目丢弃，时间轴不再炸', () => {
    const broken = [
      {
        id: 'classroom_test_1',
        title: '坏数据课堂',
        createdAt: 1,
        updatedAt: 1,
        course: {
          courseId: 'c1',
          title: '坏课件',
          scenes: [
            { id: 's1', title: '痛点', html: '<div id="a" data-hidden>x</div>', beats: [{ type: 'speak', text: '先看问题' }] },
            { id: 's2', title: '拆解' },
            '垃圾条目',
          ],
        },
      },
    ]
    const list = normalizeClassrooms(broken)
    expect(list.length).toBe(1)
    const scenes = list[0].course.scenes
    expect(scenes.length).toBe(2)
    expect(scenes[0].actions).toEqual([{ type: 'speak', text: '先看问题' }])
    expect(scenes[1].html).toBe('')
    expect(scenes[1].actions).toEqual([])
    // 修复后的 course 能跑时间轴（此前这一步直接 TypeError 掀翻页签）；空 html 幕交给 audit 提示
    expect(() => buildTimelineBeats(list[0].course)).not.toThrow()
    expect(buildTimelineBeats(list[0].course).length).toBe(1)
    expect(auditCourse(list[0].course).errors.some((e) => e.includes('.html'))).toBe(true)
  })

  it('正常数据读盘原样（不重排不清洗）', () => {
    const good = [
      {
        id: 'classroom_test_2',
        title: '好课堂',
        createdAt: 1,
        updatedAt: 1,
        course: JSON.parse(JSON.stringify(CLASSROOM_COURSE_EXAMPLE)),
      },
    ]
    const list = normalizeClassrooms(good)
    expect(list[0].course.scenes[0].actions.length).toBe(6)
    expect(list[0].course.scenes[0].actions).toEqual(CLASSROOM_COURSE_EXAMPLE.scenes[0].actions)
  })
})
