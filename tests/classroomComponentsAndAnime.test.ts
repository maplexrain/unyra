// @vitest-environment happy-dom
/**
 * 互动课堂组件库、anime.js 内置动画与调度测试
 */
import { describe, it, expect, vi } from 'vitest'
import { expandClassroomComponents } from '../src/learn/classroom/components'
import { runAnimeAnimation, mountComponentAnimations } from '../src/learn/classroom/animations'
import { sanitizeScene } from '../src/learn/classroom/sanitizer'
import { LessonScheduler } from '../src/learn/classroom/LessonScheduler'
import type { LessonCourse, LessonScene } from '../src/learn/classroom/types'

describe('互动课堂语义组件库 (components.ts)', () => {
  it('应正确展开 <ui-card> 并保留 id、data-hidden 和动画属性', () => {
    const rawHtml = `
      <ui-card id="c1" title="算法思路" subtitle="双指针" badge="重点" badge-color="seal" icon="bulb" anim="popIn" data-hidden>
        <p>慢指针每次走1步，快指针每次走2步。</p>
      </ui-card>
    `
    const expanded = expandClassroomComponents(rawHtml)
    expect(expanded).toContain('id="c1"')
    expect(expanded).toContain('data-hidden')
    expect(expanded).toContain('data-anim="popIn"')
    expect(expanded).toContain('card-glass')
    expect(expanded).toContain('card-ui')
    expect(expanded).toContain('算法思路')
    expect(expanded).toContain('双指针')
    expect(expanded).toContain('badge-seal')
    expect(expanded).toContain('慢指针每次走1步')
  })

  it('应正确展开布局容器 <ui-split> 与嵌套组件', () => {
    const rawHtml = `
      <ui-split id="sp1" gap="48">
        <ui-card id="leftCard" title="左侧">左内容</ui-card>
        <ui-card id="rightCard" title="右侧">右内容</ui-card>
      </ui-split>
    `
    const expanded = expandClassroomComponents(rawHtml)
    expect(expanded).toContain('id="sp1"')
    expect(expanded).toContain('stage-split')
    expect(expanded).toContain('id="leftCard"')
    expect(expanded).toContain('id="rightCard"')
    expect(expanded).toContain('左内容')
    expect(expanded).toContain('右内容')
  })

  it('应正确展开核心概念卡 <ui-concept>、公式卡 <ui-formula> 与代码卡 <ui-code>', () => {
    const rawHtml = `
      <ui-concept id="cp1" term="闭包 (Closure)" tag="JavaScript" definition="函数与词法作用域捆绑" keypoint="保存外层变量引用"></ui-concept>
      <ui-formula id="f1" latex="E = mc^2" title="质能方程" desc="能量与质量的转化"></ui-formula>
      <ui-code id="cd1" lang="python" title="DFS">def dfs(): pass</ui-code>
    `
    const expanded = expandClassroomComponents(rawHtml)
    expect(expanded).toContain('concept-card')
    expect(expanded).toContain('闭包 (Closure)')
    expect(expanded).toContain('保存外层变量引用')

    expect(expanded).toContain('formula-card')
    expect(expanded).toContain('$$E = mc^2$$')
    expect(expanded).toContain('质能方程')

    expect(expanded).toContain('code-card')
    expect(expanded).toContain('def dfs(): pass')
    expect(expanded).toContain('python')
  })

  it('应正确展开流程卡 <ui-steps>、指标卡 <ui-stat> 与测试题 <ui-quiz>', () => {
    const rawHtml = `
      <ui-steps id="stepBox">
        <ui-step id="s1" num="1" title="初始化">指针归零</ui-step>
        <ui-step id="s2" num="2" title="移动">快指针先跑</ui-step>
      </ui-steps>
      <ui-stat id="st1" value="O(N)" label="时间复杂度" suffix="" subtext="线性扫遍"></ui-stat>
      <ui-quiz id="qz1" question="快指针每次走几步？" answer="2">
        <ui-option id="o1" label="A">1 步</ui-option>
        <ui-option id="o2" label="B">2 步</ui-option>
      </ui-quiz>
    `
    const expanded = expandClassroomComponents(rawHtml)
    expect(expanded).toContain('steps-flow')
    expect(expanded).toContain('step-num')
    expect(expanded).toContain('指针归零')

    expect(expanded).toContain('stat-card')
    expect(expanded).toContain('O(N)')
    expect(expanded).toContain('时间复杂度')

    expect(expanded).toContain('quiz-card')
    expect(expanded).toContain('快指针每次走几步？')
    expect(expanded).toContain('quiz-option-label')
  })
})

describe('anime.js 课堂动画引擎 (animations.ts)', () => {
  it('runAnimeAnimation 能够正常启动并在 instantFinish 时快速完成', async () => {
    const div = document.createElement('div')
    div.id = 'box'
    div.textContent = '0'
    document.body.appendChild(div)

    const task = runAnimeAnimation(div, 'countUp', 1000, { end: 50 })
    expect(task).toBeDefined()
    expect(typeof task.pause).toBe('function')
    expect(typeof task.resume).toBe('function')
    expect(typeof task.instantFinish).toBe('function')

    task.instantFinish()
    await task.finished
    expect(div.textContent).toBe('50')
    document.body.removeChild(div)
  })

  it('mountComponentAnimations 能够扫描 data-anim 并返回清理句柄', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div id="c1" data-anim="float">漂浮</div>
      <div id="c2" data-anim="pulse">脉冲</div>
    `
    document.body.appendChild(container)

    const cleanup = mountComponentAnimations(container)
    expect(typeof cleanup).toBe('function')

    // 卸载清理不报错
    cleanup()
    document.body.removeChild(container)
  })
})

describe('自愈与动作清洗 (sanitizer.ts)', () => {
  it('应正确保留 <ui-*> 组件扩展出的 DOM ID，并识别 anime.js 动作动词唤醒 data-hidden', () => {
    const rawScene: LessonScene = {
      id: 'sc1',
      title: '第一课',
      html: `
        <ui-card id="card1" title="概念" data-hidden>正文</ui-card>
        <ui-card id="deadCard" title="死卡" data-hidden>死元素</ui-card>
      `,
      actions: [
        { type: 'speak', text: '现在学习新概念。' },
        { type: 'visual', verb: 'bounce', target: 'card1' },
      ],
    }

    const cleaned = sanitizeScene(rawScene)
    // card1 被 bounce 动词唤醒，所以保留 data-hidden 给动作控制
    expect(cleaned.html).toContain('id="card1"')
    // deadCard 从未被动作唤醒，data-hidden 自动被自愈剥离，防止页面永久隐藏
    expect(cleaned.html).toContain('id="deadCard"')
    expect(cleaned.html).not.toMatch(/id="deadCard"[^>]*data-hidden/)
  })
})

describe('播放调度器 (LessonScheduler.ts) 手动播放模式', () => {
  it('mountInitial() 初始挂载首个画面，状态保持 idle，绝不自动播放', () => {
    const course: LessonCourse = {
      courseId: 'c1',
      title: '测试课堂',
      scenes: [
        {
          id: 's1',
          title: '场景一',
          html: '<div id="box">初始画面</div>',
          actions: [{ type: 'speak', text: '大家好。' }],
        },
      ],
    }

    const mockStage = {
      mountScene: vi.fn(),
      getElement: vi.fn(),
    }
    const mockCompiler = {
      compile: vi.fn(),
      preloadSpeak: vi.fn(),
    }
    const stateCallback = vi.fn()

    const scheduler = new LessonScheduler(
      course,
      mockStage as any,
      mockCompiler as any,
      stateCallback
    )

    scheduler.mountInitial()

    expect(mockStage.mountScene).toHaveBeenCalledWith('<div id="box">初始画面</div>')
    const snapshot = scheduler.getSnapshot()
    expect(snapshot.status).toBe('idle')
    expect(snapshot.sceneIndex).toBe(0)
    expect(snapshot.actionIndex).toBe(0)
  })
})
