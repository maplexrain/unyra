// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expandClassroomComponents } from '../src/learn/classroom/components'
import { runAnimeAnimation, mountComponentAnimations } from '../src/learn/classroom/animations'
import { BUILTIN_COMPONENTS, BUILTIN_ANIMATIONS } from '../src/learn/classroom/registry'
import { VISUAL_VERB_WHITELIST, WAKING_VERBS, ANIME_ACTION_VERBS } from '../src/learn/classroom/verbs'
import { auditCourse } from '../src/learn/classroom/audit'
import { createDemoLessonCourse } from '../src/learn/classroom/store'
import { listSfx, SFX_RECIPES } from '../src/learn/classroom/sfx/sfxLibrary'
import * as sfxEngine from '../src/learn/classroom/sfx/sfxEngine'
import { ActionCompiler } from '../src/learn/classroom/ActionCompiler'
import { LessonScheduler } from '../src/learn/classroom/LessonScheduler'
import type { StageViewport } from '../src/learn/classroom/StageViewport'
import type { ITTSAdapter, LessonCourse } from '../src/learn/classroom/types'
import { buildApi } from '../src/agent/sandbox/api'
import { WORKFLOWS_GUIDE } from '../src/learn/ai/workflowsGuide'
import ClassroomShowcasePage from '../src/components/learn/classroom/ClassroomShowcasePage'

describe('互动课堂全面重做：组件、动效、音效库与审美工作流', () => {
  beforeEach(() => {
    localStorage.clear()
    sfxEngine.setSfxSettings({ enabled: true, volume: 0.55 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('1. 31 种重做与新增教学语义组件', () => {
    it('全部 31 个内置组件均具备非空示例且能无损展开', () => {
      expect(BUILTIN_COMPONENTS.length).toBe(31)
      for (const comp of BUILTIN_COMPONENTS) {
        const expanded = expandClassroomComponents(comp.example)
        expect(expanded).not.toContain(`<${comp.tag}`)
        expect(expanded.length).toBeGreaterThan(10)
      }
    })

    it('支持 ui-split 不对称黄金比、ui-pipeline 因果链、ui-diagram 蓝图框与 ui-breakdown 比例条', () => {
      const split = expandClassroomComponents('<ui-split ratio="3:2" gap="40"><div>A</div><div>B</div></ui-split>')
      expect(split).toContain('grid-template-columns: 3fr 2fr')
      expect(split).toContain('gap: 40px')

      const pipe = expandClassroomComponents(`
        <ui-pipeline title="编译流水线" direction="row">
          <ui-node id="n1" step="01" title="分词" icon="code">Token 流</ui-node>
          <ui-node id="n2" step="02" title="语法树" tone="seal" badge="焦点" data-hidden>AST</ui-node>
        </ui-pipeline>
      `)
      expect(pipe).toContain('pipeline-flow')
      expect(pipe).toContain('pipeline-row')
      expect(pipe).toContain('pipeline-node')
      expect(pipe).toContain('id="n2"')
      expect(pipe).toContain('data-hidden')

      const diagram = expandClassroomComponents(
        '<ui-diagram eyebrow="BLUEPRINT" title="单位圆" caption="弧度制示意图" grid="lines"><svg viewBox="0 0 100 100"></svg></ui-diagram>',
      )
      expect(diagram).toContain('diagram-grid-lines')
      expect(diagram).toContain('弧度制示意图')

      const breakdown = expandClassroomComponents(
        '<ui-breakdown title="显存构成" total="100%" items="优化器:50:seal, 权重:30:sky, 激活:20:ok"></ui-breakdown>',
      )
      expect(breakdown).toContain('breakdown-bar')
      expect(breakdown).toContain('50%')
      expect(breakdown).toContain('30%')
      expect(breakdown).toContain('20%')
    })

    it('ui-stat 保护非纯数字指标（如 O(N)）不被 countUp 覆写，纯小数则精准保留小数位', async () => {
      const html = expandClassroomComponents(`
        <ui-stat id="sym" value="O(N)" label="时间复杂度"></ui-stat>
        <ui-stat id="num" value="99.45" suffix="%" label="准确率"></ui-stat>
      `)
      expect(html).not.toContain('O(N)" data-anim="countUp"')
      expect(html).toContain('data-target="99.45"')

      const wrap = document.createElement('div')
      wrap.innerHTML = html
      document.body.appendChild(wrap)

      const cleanup = mountComponentAnimations(wrap)
      cleanup()
      expect(wrap.querySelector('#sym .stat-value')?.textContent).toBe('O(N)')

      const numSpan = wrap.querySelector('#num .stat-value') as HTMLElement
      const task = runAnimeAnimation(numSpan, 'countUp', 300, { end: 99.45, suffix: '%' })
      task.instantFinish()
      await task.finished
      expect(numSpan.textContent).toBe('99.45%')
      wrap.remove()
    })

    it('ui-keyboard 同时兼容 + 与 , 分隔组合键', () => {
      const k1 = expandClassroomComponents('<ui-keyboard keys="Ctrl + Shift + P" action="面板"></ui-keyboard>')
      const k2 = expandClassroomComponents('<ui-keyboard keys="Cmd, K" action="检索"></ui-keyboard>')
      expect(k1).toContain('Ctrl')
      expect(k1).toContain('Shift')
      expect(k2).toContain('Cmd')
      expect(k2).toContain('kbd-key')
    })
  })

  describe('2. 29 种重做动效、清理隔离与白名单一致性', () => {
    it('全部 29 种动效在 verbs / registry / WAKING_VERBS 之间完全自洽', () => {
      expect(BUILTIN_ANIMATIONS.length).toBe(29)
      for (const a of BUILTIN_ANIMATIONS) {
        if (a.verb === 'pulse') continue
        expect(ANIME_ACTION_VERBS.has(a.verb)).toBe(true)
        expect(VISUAL_VERB_WHITELIST.has(a.verb)).toBe(true)
      }
      for (const w of ['riseIn', 'unfold', 'stamp', 'blurIn']) {
        expect(WAKING_VERBS.has(w)).toBe(true)
      }
    })

    it('shimmer / ripple / typewriter 瞬态 DOM 修饰在 instantFinish 与 abort 后完全清理', async () => {
      const box = document.createElement('div')
      box.textContent = '测试核心定理'
      document.body.appendChild(box)

      const tShimmer = runAnimeAnimation(box, 'shimmer', 400)
      expect(box.querySelector('.fx-shimmer-sheen')).toBeTruthy()
      tShimmer.instantFinish()
      await tShimmer.finished
      expect(box.querySelector('.fx-shimmer-sheen')).toBeNull()
      expect(box.classList.contains('fx-shimmer-host')).toBe(false)

      const tRipple = runAnimeAnimation(box, 'ripple', 400)
      expect(box.querySelector('.fx-ripple-ring')).toBeTruthy()
      tRipple.abort()
      expect(box.querySelector('.fx-ripple-ring')).toBeNull()
      expect(box.classList.contains('fx-ripple-host')).toBe(false)

      const tType = runAnimeAnimation(box, 'typewriter', 400, { text: '微积分基本定理' })
      expect(box.classList.contains('fx-typing-caret')).toBe(true)
      tType.instantFinish()
      await tType.finished
      expect(box.classList.contains('fx-typing-caret')).toBe(false)
      expect(box.textContent).toBe('微积分基本定理')

      box.remove()
    })

    it('mountComponentAnimations 不提前触发带 data-hidden 元素的动效', () => {
      const root = document.createElement('div')
      root.innerHTML = `<div id="hiddenEl" data-hidden data-anim="popIn">隐藏中</div>`
      document.body.appendChild(root)

      const cleanup = mountComponentAnimations(root)
      expect(root.querySelector('#hiddenEl')?.hasAttribute('data-hidden')).toBe(true)
      cleanup()
      root.remove()
    })
  })

  describe('3. 课堂 WebAudio 音效库、静音快进与沙箱 API', () => {
    it('内置 22 个音效覆盖四大分类，且 api.classroom.sounds() 支持按分类与关键词查询', async () => {
      const all = listSfx()
      expect(all.length).toBe(22)
      expect(Object.keys(SFX_RECIPES).length).toBe(22)
      expect(new Set(all.map((s) => s.category)).size).toBe(4)

      const { api } = buildApi({ root: 'E:/test', activeUserId: 'u1' } as any)
      const classroomApi = (api as any).classroom
      expect(typeof classroomApi.sounds).toBe('function')

      const resAll = await classroomApi.sounds()
      expect(resAll.ok).toBe(true)
      expect(resAll.sounds.length).toBe(22)

      const resAccent = await classroomApi.sounds({ category: 'accent' })
      expect(resAccent.sounds.every((s: any) => s.category === 'accent')).toBe(true)
      expect(resAccent.sounds.some((s: any) => s.name === 'chime')).toBe(true)
    })

    it('seekTo 快进重放前置动作绝对静音，正常 play 才触发 scene.sfx / params.sfx / 自带音效', async () => {
      const startSpy = vi.spyOn(sfxEngine, 'startSfx').mockReturnValue({ stop: vi.fn() })

      const el1 = document.createElement('div')
      el1.id = 'a1'
      el1.setAttribute('data-hidden', '')
      const el2 = document.createElement('div')
      el2.id = 'a2'
      el2.setAttribute('data-hidden', '')

      const mockStage = {
        mountScene: vi.fn(),
        getElement: vi.fn((id: string) => (id === 'a1' ? el1 : id === 'a2' ? el2 : null)),
      } as unknown as StageViewport

      const mockTTS: ITTSAdapter = {
        speak: vi.fn(() => ({
          pause: vi.fn(),
          resume: vi.fn(),
          stop: vi.fn(),
          finished: Promise.resolve(),
        })),
      }

      const course: LessonCourse = {
        courseId: 'c_sfx',
        title: '音效同步测试',
        scenes: [
          {
            id: 's1',
            title: '第一幕',
            sfx: 'swell',
            html: '<div id="a1" data-hidden></div><div id="a2" data-hidden></div>',
            actions: [
              { type: 'visual', verb: 'popIn', target: 'a1', params: { sfx: 'pop' } },
              { type: 'speak', text: '第一句讲解' },
              { type: 'visual', verb: 'stamp', target: 'a2' },
              { type: 'speak', text: '第二句讲解' },
            ],
          },
        ],
      }

      const compiler = new ActionCompiler(mockStage, mockTTS)
      const scheduler = new LessonScheduler(course, mockStage, compiler, () => {})

      // mountInitial 绝对静音
      scheduler.mountInitial()
      expect(startSpy).not.toHaveBeenCalled()

      // seekTo(0, 2) 重放前置 actions[0] 与 actions[1]：严格静音；仅随后播放从 action[2]（stamp）响
      scheduler.seekTo(0, 2)
      expect(el1.hasAttribute('data-hidden')).toBe(false)
      // 没有调用 pop（前置动作），只触发了第 2 步的 stamp
      const calledNames = startSpy.mock.calls.map((c) => c[0])
      expect(calledNames).not.toContain('pop')
      expect(calledNames).not.toContain('swell')
      expect(calledNames).toContain('stamp')

      scheduler.destroy()
    })

    it('auditCourse 校验 sfx 合法性，createDemoLessonCourse 通过静态体检零错误零警告', () => {
      const demo = createDemoLessonCourse()
      const rDemo = auditCourse(demo)
      expect(rDemo.errors).toEqual([])
      expect(rDemo.warnings).toEqual([])

      demo.scenes[0].sfx = 'not_a_sound'
      ;(demo.scenes[0].actions[0] as any).params = { sfx: 'also_fake' }
      const rBad = auditCourse(demo)
      expect(rBad.errors).toEqual([])
      expect(rBad.warnings.some((w) => w.includes('not_a_sound'))).toBe(true)
      expect(rBad.warnings.some((w) => w.includes('also_fake'))).toBe(true)
    })
  })

  describe('4. 展示页音效页签与提示词审美传授', () => {
    it('ClassroomShowcasePage 展示音效库标签页并支持试听按钮', async () => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      await act(async () => {
        root.render(<ClassroomShowcasePage />)
      })

      expect(host.textContent).toContain('音效库 (22)')
      expect(host.textContent).toContain('课堂音效库 (WebAudio SFX)')
      expect(host.textContent).toContain('清泉玉磬')

      const sfxTab = Array.from(host.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('音效库'),
      ) as HTMLButtonElement
      await act(async () => {
        sfxTab.click()
      })
      expect(host.textContent).toContain('朱印落定')

      await act(async () => {
        root.unmount()
      })
      host.remove()
    })

    it('WORKFLOWS_GUIDE 向生成课堂的 Agent 传授舞台构图、动效编排与音效审美纪律', () => {
      expect(WORKFLOWS_GUIDE).toContain('一幕一焦点')
      expect(WORKFLOWS_GUIDE).toContain('音效是标点')
      expect(WORKFLOWS_GUIDE).toContain('api.classroom.sounds()')
      expect(WORKFLOWS_GUIDE).toContain('ui-pipeline')
      expect(WORKFLOWS_GUIDE).toContain('ui-diagram')
    })
  })
})
