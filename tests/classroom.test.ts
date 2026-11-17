// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { sanitizeScene, sanitizeTtsText } from '../src/learn/classroom/sanitizer'
import { buildTimelineBeats, findBeatIndex } from '../src/learn/classroom/timeline'
import { ActionCompiler } from '../src/learn/classroom/ActionCompiler'
import { LessonScheduler } from '../src/learn/classroom/LessonScheduler'
import type { StageViewport } from '../src/learn/classroom/StageViewport'
import type { ITTSAdapter, LessonCourse, LessonScene } from '../src/learn/classroom/types'
import { ClassroomGNode } from '../src/learn/nodeKinds/classroom'
import { DocGNode } from '../src/learn/nodeKinds/doc'
import { SuperdocGNode } from '../src/learn/nodeKinds/superdoc'
import { NoteGNode } from '../src/learn/nodeKinds/note'
import { ExamGNode } from '../src/learn/nodeKinds/exam'
import { FileGNode } from '../src/learn/nodeKinds/file'
import { NodeService } from '../src/learn/nodeKinds/service'
import type { LearnStore } from '../src/learn/types'

describe('互动课堂 (Interactive Classroom) 核心逻辑与编译器测试', () => {
  describe('1. 编译器级校验与自愈层 (Sanitizer)', () => {
    it('清理口语文本：过滤 Markdown 符号、括号停顿提示等非朗读内容', () => {
      const raw = '大家好！**欢迎**来到本节课（停顿2秒）。请看公式 $E=mc^2$ [点击查看] 详解。'
      const cleaned = sanitizeTtsText(raw)
      expect(cleaned).toBe('大家好！欢迎来到本节课。请看公式 E=mc^2 详解。')
    })

    it('安全过滤：剥离 <script> 标签与 on* 事件监听器', () => {
      const scene: LessonScene = {
        id: 's1',
        title: '测试安全',
        html: `
          <div id="c1" onclick="alert(1)">正常内容</div>
          <script>console.log('malicious');</script>
          <img id="img1" src="x" onerror="evil()" />
        `,
        actions: [
          { type: 'visual', verb: 'appear', target: 'c1' },
          { type: 'speak', text: '你好世界' },
        ],
      }
      const sanitized = sanitizeScene(scene)
      expect(sanitized.html).not.toContain('<script>')
      expect(sanitized.html).not.toContain('onclick')
      expect(sanitized.html).not.toContain('onerror')
      expect(sanitized.html).toContain('id="c1"')
    })

    it('悬空 Target 过滤：移除操控不存在 DOM 元素的非法视觉动作', () => {
      const scene: LessonScene = {
        id: 's1',
        title: '测试悬空 ID',
        html: '<div id="real_target">内容</div>',
        actions: [
          { type: 'visual', verb: 'appear', target: 'real_target' },
          { type: 'visual', verb: 'pulse', target: 'ghost_target' }, // 悬空
          { type: 'speak', text: '讲解' },
        ],
      }
      const sanitized = sanitizeScene(scene)
      expect(sanitized.actions).toHaveLength(2)
      expect(sanitized.actions[0]).toEqual({ type: 'visual', verb: 'appear', target: 'real_target' })
      expect(sanitized.actions[1]).toEqual({ type: 'speak', text: '讲解', subtitle: '讲解' })
    })

    it('死隐藏元素自愈：初始带有 data-hidden 但无任何动作唤醒时自动移除', () => {
      const scene: LessonScene = {
        id: 's1',
        title: '测试死隐藏自愈',
        html: `
          <div id="item_revealed" data-hidden>会被唤醒</div>
          <div id="item_dead" data-hidden>永远没人唤醒</div>
        `,
        actions: [
          { type: 'visual', verb: 'appear', target: 'item_revealed' },
        ],
      }
      const sanitized = sanitizeScene(scene)
      // item_revealed 仍保留 data-hidden，待动作触发唤醒
      expect(sanitized.html).toMatch(/id="item_revealed"[^>]*data-hidden/)
      // item_dead 应该被自愈剥离 data-hidden，避免永久幽灵不可见
      expect(sanitized.html).not.toMatch(/id="item_dead"[^>]*data-hidden/)
    })
  })

  describe('2. 无刻度节拍时间轴计算 (Timeline Beats)', () => {
    it('节拍聚合：连续非阻塞视觉动作 + 随后的阻塞动作聚合为一个节拍', () => {
      const course: LessonCourse = {
        courseId: 'c1',
        title: '测试课程',
        scenes: [
          {
            id: 'sc1',
            title: '画面一',
            html: '<div id="box1"></div><div id="box2"></div>',
            actions: [
              { type: 'visual', verb: 'appear', target: 'box1', blocking: false },
              { type: 'visual', verb: 'highlight', target: 'box2', blocking: false },
              { type: 'speak', text: '这是第一段讲解', blocking: true },
              { type: 'wait', duration: 500, blocking: true },
            ],
          },
        ],
      }

      const beats = buildTimelineBeats(course)
      expect(beats).toHaveLength(2)
      // 第一个节拍聚合了 2 个视觉动作与 speak
      expect(beats[0].sceneIndex).toBe(0)
      expect(beats[0].startActionIndex).toBe(0)
      expect(beats[0].endActionIndex).toBe(2)
      expect(beats[0].visualActionCount).toBe(2)
      expect(beats[0].label).toContain('这是第一段讲解')

      // 第二个节拍为 wait
      expect(beats[1].startActionIndex).toBe(3)
      expect(beats[1].visualActionCount).toBe(0)
      expect(beats[1].label).toContain('停顿 (500ms)')
    })

    it('根据 (sceneIndex, actionIndex) 游标准确查找当前激活节拍索引', () => {
      const course: LessonCourse = {
        courseId: 'c1',
        title: '测试',
        scenes: [
          {
            id: 's1',
            title: 'S1',
            html: '<div></div>',
            actions: [
              { type: 'visual', verb: 'appear', target: 'a', blocking: false },
              { type: 'speak', text: 'Beat 1' },
              { type: 'speak', text: 'Beat 2' },
            ],
          },
        ],
      }
      const beats = buildTimelineBeats(course)
      expect(findBeatIndex(beats, 0, 0)).toBe(0)
      expect(findBeatIndex(beats, 0, 1)).toBe(0)
      expect(findBeatIndex(beats, 0, 2)).toBe(1)
    })
  })

  describe('3. 动作调度器与确定性快进 (LessonScheduler & Deterministic Seek)', () => {
    it('支持播放、暂停与瞬时快进 (Instant Finish)', async () => {
      const mockElement = document.createElement('div')
      mockElement.id = 'target1'
      mockElement.setAttribute('data-hidden', '')

      // 模拟 StageViewport
      const mockViewport = {
        mountScene: vi.fn(),
        getElement: vi.fn((id: string) => (id === 'target1' ? mockElement : null)),
        queryAll: vi.fn(() => []),
      } as unknown as StageViewport

      const mockTTS: ITTSAdapter = {
        speak: vi.fn(() => ({
          pause: vi.fn(),
          resume: vi.fn(),
          stop: vi.fn(),
          finished: Promise.resolve(),
        })),
      }

      const compiler = new ActionCompiler(mockViewport, mockTTS)

      const course: LessonCourse = {
        courseId: 'c1',
        title: '测试快进',
        scenes: [
          {
            id: 'scene1',
            title: '画面 1',
            html: '<div id="target1" data-hidden></div>',
            actions: [
              { type: 'visual', verb: 'appear', target: 'target1', blocking: false },
              { type: 'speak', text: '欢迎', blocking: true },
              { type: 'speak', text: '第二句', blocking: true },
            ],
          },
        ],
      }

      let lastSnapshot: any = null
      const scheduler = new LessonScheduler(course, mockViewport, compiler, (s) => {
        lastSnapshot = s
      })

      // 瞬时快进到第 2 个动作 (第二句)
      scheduler.seekTo(0, 2)
      expect(mockViewport.mountScene).toHaveBeenCalledWith(course.scenes[0].html)
      // appear 动作被 instantFinish 重放：data-hidden 被移除
      expect(mockElement.hasAttribute('data-hidden')).toBe(false)
      expect(lastSnapshot.sceneIndex).toBe(0)
      expect(lastSnapshot.actionIndex).toBe(2)

      scheduler.destroy()
    })
  })

  describe('4. 课堂节点 (ClassroomGNode) 上下游连接与规则校验', () => {
    const createMockStore = (): LearnStore => ({
      version: 2,
      nodes: [
        {
          id: 'doc1',
          goalId: 'g1',
          title: '教学文档',
          key: 'doc1',
          description: '',
          docs: { teaching: '正文' },
          notes: [],
          superdocs: [],
          annotations: [],
          origin: 'user',
          status: 'learning',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [],
      goals: [{ id: 'g1', title: '目标', question: '问', rootNodeId: 'doc1', createdAt: 1, updatedAt: 1 }],
      conversations: [],
      exams: [],
      resources: {},
      activeGoalId: 'g1',
      activeNodeId: 'doc1',
      activeConversationId: null,
      tmp: {},
      classrooms: [],
    } as unknown as LearnStore)

    it('课堂节点上游规则：允许挂在 doc 与 superdoc 之下，拒绝挂在 exam/note 下', () => {
      let store = createMockStore()
      const ctx = {
        store: () => store,
        commit: (next: LearnStore) => {
          store = next
        },
        goalId: () => 'g1',
        objectOf: () => null as any,
      }

      const classroomNode = new ClassroomGNode(ctx, 'classroom-1')
      const docNode = new DocGNode(ctx, 'doc1')
      const superdocNode = new SuperdocGNode(ctx, 'sdoc1')
      const noteNode = new NoteGNode(ctx, 'note1')
      const examNode = new ExamGNode(ctx, 'exam1')

      // 上游校验
      expect(classroomNode.onUpstream(docNode)).toBe(true)
      expect(classroomNode.onUpstream(superdocNode)).toBe(true)
      expect(classroomNode.onUpstream(noteNode)).toContain('课堂节点只能挂载在教学文档或超级文档之下')
      expect(classroomNode.onUpstream(examNode)).toContain('课堂节点只能挂载在教学文档或超级文档之下')

      // 文档节点也允许课堂节点作为下游
      expect(docNode.onDownstream(classroomNode)).toBe(true)
    })

    it('课堂节点下游规则：允许连接 note、exam、superdoc、file，拒绝连接 doc', () => {
      let store = createMockStore()
      const ctx = {
        store: () => store,
        commit: (next: LearnStore) => {
          store = next
        },
        goalId: () => 'g1',
        objectOf: () => null as any,
      }

      const classroomNode = new ClassroomGNode(ctx, 'classroom-1')
      const docNode = new DocGNode(ctx, 'doc1')
      const noteNode = new NoteGNode(ctx, 'note1')
      const examNode = new ExamGNode(ctx, 'exam1')
      const superdocNode = new SuperdocGNode(ctx, 'sdoc1')
      const fileNode = new FileGNode(ctx, 'file1')

      // 下游校验
      expect(classroomNode.onDownstream(noteNode)).toBe(true)
      expect(classroomNode.onDownstream(examNode)).toBe(true)
      expect(classroomNode.onDownstream(superdocNode)).toBe(true)
      expect(classroomNode.onDownstream(fileNode)).toBe(true)
      expect(classroomNode.onDownstream(docNode)).toContain('课堂节点的下级只能连接笔记、考试、超级文档或文件节点')

      // 对方允许来自 classroom 的上游连接
      expect(noteNode.onUpstream(classroomNode)).toBe(true)
      expect(examNode.onUpstream(classroomNode)).toBe(true)
      expect(superdocNode.onUpstream(classroomNode)).toBe(true)
      expect(fileNode.onUpstream(classroomNode)).toBe(true)
    })

    it('NodeService 支持统一通道创建、定位与删除互动课堂节点', () => {
      let store = createMockStore()
      const service = new NodeService({
        getLatest: () => store,
        set: (next) => {
          store = next
        },
        goalId: () => 'g1',
      })

      // 创建独立课堂节点
      const res = service.create({ kind: 'classroom', title: '线性代数互动课' })
      expect('ok' in res && res.ok).toBe(true)
      const cId = (res as any).uuid
      expect(cId).toMatch(/^classroom[-_]/)

      // 验证 locateUuid
      const loc = service.get(cId)
      expect(loc).toBeDefined()
      expect(loc?.kind).toBe('classroom')
      expect(loc?.title).toBe('线性代数互动课')

      // 挂载下级笔记（带 under 自动连线）
      const noteRes = service.create({ kind: 'note', under: cId, title: '矩阵变换课堂笔记' })
      expect('ok' in noteRes && noteRes.ok).toBe(true)
      const noteId = (noteRes as any).uuid
      expect(store.edges.some((e) => e.from === cId && e.to === noteId)).toBe(true)

      // 创建游离试卷并测试显式 connect
      const examRes = service.create({ kind: 'exam', title: '随堂测验' })
      expect('ok' in examRes && examRes.ok).toBe(true)
      const examId = (examRes as any).uuid
      const connRes = loc!.connect(service.get(examId)!, 'down')
      expect('ok' in connRes && connRes.ok).toBe(true)
      expect(store.edges.some((e) => e.from === cId && e.to === examId)).toBe(true)

      // 删除课堂节点
      const delRes = service.delete(cId)
      expect('ok' in delRes && delRes.ok).toBe(true)
      expect(store.classrooms?.some((c) => c.id === cId)).toBe(false)
      // 级联边也被安全清理
      expect(store.edges.some((e) => e.from === cId)).toBe(false)
    })
  })
})
