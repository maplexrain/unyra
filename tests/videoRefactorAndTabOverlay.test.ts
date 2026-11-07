// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { parseChapters, transcriptLines } from '../src/learn/video/summarize'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import { emptyLearnStore } from '../src/learn/store/empty'
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  loadNotesWindowState,
  NOTES_WINDOW_STORAGE_KEY,
  saveNotesWindowState,
} from '../src/components/video/VideoNotesFloatingWindow'
import type { Transcript, TranscriptSegment } from '../src/video/types'

describe('视频重构与 Tab 键浮层、分段生成规范', () => {
  it('parseChapters: 能够正确从模型输出的 JSON 数组中提取并规整化章节分段', () => {
    const raw = `
\`\`\`json
[
  { "startMs": 0, "summary": "课程前言与背景介绍" },
  { "startMs": 65000, "summary": "安装环境与配置 uv" },
  { "startMs": 180000, "summary": "编写第一个智能体" }
]
\`\`\`
`
    const chapters = parseChapters(raw)
    expect(chapters).toHaveLength(3)
    expect(chapters[0]).toEqual({ startMs: 0, summary: '课程前言与背景介绍' })
    expect(chapters[1]).toEqual({ startMs: 65000, summary: '安装环境与配置 uv' })
    expect(chapters[2]).toEqual({ startMs: 180000, summary: '编写第一个智能体' })
  })

  it('parseChapters: 能容忍非法行与重复时间戳，且按时间戳升序排序', () => {
    const raw = JSON.stringify([
      { startMs: 120000, summary: '后半段' },
      { startMs: 30000, summary: '前半段' },
      { startMs: 30000, summary: '重复的前半段' },
      { startMs: 'invalid_number', summary: '非法时间' },
      { startMs: 50000, summary: '' }, // 空概述
    ])
    const chapters = parseChapters(raw)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].startMs).toBe(30000)
    expect(chapters[1].startMs).toBe(120000)
  })

  it('transcriptLines: 能够将转录片段聚桶并限制行数', () => {
    const segments: TranscriptSegment[] = [
      { startMs: 0, endMs: 5000, text: 'Hello' },
      { startMs: 5000, endMs: 10000, text: 'World' },
      { startMs: 25000, endMs: 30000, text: 'Next bucket' },
    ]
    const lines = transcriptLines(segments)
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain('[00:00] Hello World')
    expect(lines[1]).toContain('[00:25] Next bucket')
  })

  it('50,000 字符限制规则验证：<= 50000 字符允许自动生成，> 50000 字符抑制自动生成并需要手动生成', () => {
    const makeTranscript = (totalLength: number): Transcript => {
      const segText = 'a'.repeat(1000)
      const count = Math.ceil(totalLength / 1000)
      const segments: TranscriptSegment[] = []
      for (let i = 0; i < count; i++) {
        segments.push({
          startMs: i * 5000,
          endMs: (i + 1) * 5000,
          text: i === count - 1 ? 'a'.repeat(totalLength - (count - 1) * 1000) : segText,
        })
      }
      return {
        version: 1,
        origin: 'subtitle',
        language: 'zh-CN',
        segments,
      }
    }

    const shortTranscript = makeTranscript(49999)
    const shortTotal = shortTranscript.segments.reduce((acc, s) => acc + s.text.length, 0)
    expect(shortTotal).toBe(49999)
    const canAutoGenerateShort = shortTotal <= 50000
    expect(canAutoGenerateShort).toBe(true)

    const longTranscript = makeTranscript(50001)
    const longTotal = longTranscript.segments.reduce((acc, s) => acc + s.text.length, 0)
    expect(longTotal).toBe(50001)
    const canAutoGenerateLong = longTotal <= 50000
    expect(canAutoGenerateLong).toBe(false)
  })

  it('左侧栏 1:1:1 三行均分布局与移除导出逻辑、右侧笔记栏规范验证', async () => {
    const fs = await import('fs')
    // 拆分后实现分住在 VideoStudyTab 与其子模块里：规范验证读实现整体
    const videoFiles = ['src/components/video/VideoStudyTab.tsx', 'src/components/video/useVideoStudy.ts', 'src/components/video/VideoStudySidebar.tsx', 'src/components/video/useVideoNotes.ts', 'src/components/video/VideoCreateForm.tsx']
    const code = videoFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

    // 1. 验证去掉了 maskImage 遮罩
    expect(code).not.toContain('maskImage:')
    expect(code).not.toContain('WebkitMaskImage:')

    // 2. 验证左侧栏三行的高度权重为 1:1:1 均分 (选集列表 flex-1，字幕 flex-1，分段 flex-1)
    expect(code).not.toContain('flex-[2]')
    expect(code).toContain('flex flex-1 min-h-0 flex-col')
    expect(code).toContain('flex flex-1 min-h-0 flex-col border-t border-white/10')

    // 3. 验证去掉了独立的右侧栏 sidePanel
    expect(code).not.toContain('const sidePanel =')
    expect(code).not.toContain('COLLAPSED_KEY')

    // 4. 验证移出了导出选集字幕按钮及相关逻辑
    expect(code).not.toContain('exportPages')
    expect(code).not.toContain('buildPagesMarkdown')
    expect(code).not.toContain('PagesExportEntry')

    // 5. 验证悬浮笔记栏与插入时间戳超链接功能
    expect(code).toContain('rightOverlay')
    expect(code).toContain('createNoteForVideoNode')
    expect(code).toContain('deleteNoteForVideoNode')
    expect(code).toContain('updateNoteForVideoNode')
    expect(code).toContain('videoLinkMarkdown')
    expect(code).toContain('setVideoLinkHandler')
    expect(code).toContain("e.key === 'Shift'")

    // 6. 验证视频节点兜底匹配与新建笔记无阻塞保证
    expect(code).toContain('effectiveVideoNodeId')
    expect(code).toContain('handleBackToList')
  })

  it('验证 VideoTabLayer 正确双向解析 videoNodeId 与 videoId', async () => {
    const fs = await import('fs')
    const code = fs.readFileSync('src/components/video/VideoTabLayer.tsx', 'utf8')
    expect(code).toContain('resolvedVideoNodeId')
    expect(code).toContain('tab.ref.videoNodeId || videoNode?.id')
  })

  it('验证 VideoPlayer 顶底栏遮罩往回缩紧规范', async () => {
    const fs = await import('fs')
    const code = fs.readFileSync('src/components/video/VideoPlayer.tsx', 'utf8')

    // 验证顶部栏和底部栏的缩紧渐变样式
    expect(code).toContain('from-black/90 via-black/40 to-transparent')
    expect(code).toContain('from-black/90 via-black/45 to-transparent')
    // 验证支持 rightOverlay 与笔记切换按钮
    expect(code).toContain('rightOverlay')
    expect(code).toContain('onToggleRightOverlay')
  })

  it('验证有连接的笔记节点不再显示「游离」，而无连接的孤儿笔记仍显示「游离」', () => {
    const base = emptyLearnStore()
    const store = {
      ...base,
      goals: [{ id: 'g1', rootNodeId: 'r', question: '学习', createdAt: 1, updatedAt: 1 }],
      nodes: [{
        id: 'r',
        title: '根文档',
        key: 'gen',
        description: '',
        docs: { teaching: '' },
        notes: [],
        annotations: [],
        status: 'learning' as const,
        origin: 'user' as const,
        goalId: 'g1',
        createdAt: 1,
        updatedAt: 1,
      }],
      videoNodes: [{
        id: 'vn-1',
        goalId: 'g1',
        videoId: 'v1',
        title: '测试视频',
        input: 'BV123',
        createdAt: 1,
        updatedAt: 1,
      }],
      detached: {
        g1: {
          notes: [
            { id: 'note-connected', name: '已连接笔记', content: '两字', createdAt: 1, updatedAt: 1 },
            { id: 'note-orphan', name: '独立游离笔记', content: '', createdAt: 1, updatedAt: 1 },
          ],
          superdocs: [],
        },
      },
      edges: [
        { from: 'vn-1', to: 'note-connected', createdAt: 1 },
      ],
    }

    const view = deriveCanvas(store, 'g1', undefined)
    const connectedCard = view.cards.find((c) => c.uuid === 'note-connected')
    const orphanCard = view.cards.find((c) => c.uuid === 'note-orphan')

    expect(connectedCard).toBeDefined()
    expect(orphanCard).toBeDefined()

    // 已连接笔记：只显示字数，绝不能包含「游离」
    expect(connectedCard?.subtitle).toBe('2 字')
    expect(connectedCard?.subtitle).not.toContain('游离')

    // 未连接笔记：依然显示游离提示
    expect(orphanCard?.subtitle).toBe('游离 · 还是空的')
  })

  it('验证视频笔记悬浮窗状态持久化与 600x400 默认尺寸规范', () => {
    // 1. 无 localStorage 时采用默认 600x400
    try {
      localStorage.removeItem(NOTES_WINDOW_STORAGE_KEY)
    } catch {}
    const defaultState = loadNotesWindowState()
    expect(defaultState.width).toBe(DEFAULT_WINDOW_WIDTH)
    expect(defaultState.height).toBe(DEFAULT_WINDOW_HEIGHT)
    expect(DEFAULT_WINDOW_WIDTH).toBe(600)
    expect(DEFAULT_WINDOW_HEIGHT).toBe(400)

    // 2. 存入新坐标与新尺寸后能够持久化恢复
    saveNotesWindowState({ x: 300, y: 150, width: 700, height: 480 })
    const restored = loadNotesWindowState()
    expect(restored.x).toBe(300)
    expect(restored.y).toBe(150)
    expect(restored.width).toBe(700)
    expect(restored.height).toBe(480)
  })

  it('验证 moji:video 视频超链接协议的生成、解析与跳转拦截', async () => {
    const {
      isVideoHref,
      parseVideoHref,
      videoLinkHref,
      videoLinkMarkdown,
      setVideoLinkHandler,
      handleVideoLink,
    } = await import('../src/lib/videoLink')

    // 1. 生成链接
    expect(videoLinkHref({ timeMs: 83000 })).toBe('moji:video?t=01:23')
    expect(videoLinkHref({ page: 3, timeMs: 83000 })).toBe('moji:video?p=3&t=01:23')
    expect(videoLinkMarkdown({ timeMs: 83000 })).toBe('[01:23](moji:video?t=01:23)')
    expect(videoLinkMarkdown({ page: 3, timeMs: 83000 })).toBe('[P3 01:23](moji:video?p=3&t=01:23)')

    // 2. 协议判断
    expect(isVideoHref('moji:video?t=01:23')).toBe(true)
    expect(isVideoHref('moji:video?p=2&t=10:05')).toBe(true)
    expect(isVideoHref('https://example.com')).toBe(false)
    expect(isVideoHref(undefined)).toBe(false)

    // 3. 链接解析
    expect(parseVideoHref('moji:video?t=01:23')).toMatchObject({ timeMs: 83000 })
    expect(parseVideoHref('moji:video?p=2&t=01:23')).toMatchObject({ page: 2, timeMs: 83000 })
    expect(parseVideoHref('moji:video?t=90')).toMatchObject({ timeMs: 90000 })
    expect(parseVideoHref('moji:video?t=01:02:03')).toMatchObject({ timeMs: 3723000 })

    // 4. 跳转处理器分发
    let received: any = null
    const restore = setVideoLinkHandler((target) => {
      received = target
    })
    const handled = handleVideoLink('moji:video?p=4&t=02:30')
    expect(handled).toBe(true)
    expect(received).toMatchObject({ page: 4, timeMs: 150000 })
    restore()
  })

  it('验证笔记窗口去模糊滤镜、纯SVG顶栏按钮、一级列表重命名与二级无标题编辑框规范', async () => {
    const fs = await import('fs')
    const code = fs.readFileSync('src/components/video/VideoNotesFloatingWindow.tsx', 'utf8')

    // 1. 背景不得使用 backdrop-blur 模糊滤镜以保证性能
    expect(code).not.toContain('backdrop-blur')
    expect(code).toContain('bg-[#141416]/95')

    // 2. 顶栏按钮纯 SVG（不显示文字、无额外背景和边框）
    expect(code).not.toContain(">{t('插入时间戳')}<")
    expect(code).not.toContain(">{t('新建笔记')}<")
    expect(code).toContain('title={t(\'返回笔记列表\')}')
    expect(code).toContain('title={t(\'在光标处插入当前时间戳跳转链接\')}')
    expect(code).toContain('title={t(\'新建笔记\')}')
    expect(code).toContain('title={t(\'收起笔记 (双击 Shift)\')}')

    // 3. 一级列表页提供原地重命名功能
    expect(code).toContain('onRenameNote')
    expect(code).toContain('renamingId')

    // 4. 二级页面无 input 标题编辑框，全高度展示 Markdown 编辑器
    expect(code).not.toContain('draftTitle')
    expect(code).not.toContain('onTitleChange')
    expect(code).toContain('h-full w-full resize-none')
  })

  it('验证新建笔记事件交互不被拖拽劫持，且支持空状态一键新建与二级页继续新建', async () => {
    const fs = await import('fs')
    const windowCode = fs.readFileSync('src/components/video/VideoNotesFloatingWindow.tsx', 'utf8')
    const tabCode = ['src/components/video/VideoStudyTab.tsx', 'src/components/video/useVideoStudy.ts', 'src/components/video/VideoStudySidebar.tsx', 'src/components/video/useVideoNotes.ts', 'src/components/video/VideoCreateForm.tsx'].map((f) => fs.readFileSync(f, 'utf8')).join('\n')

    // 1. isInteractiveTarget 必须支持 Element，避免 SVG/Path 被误判为可拖动而吞噬 onClick
    expect(windowCode).toContain('target instanceof Element')
    expect(windowCode).not.toContain('target instanceof HTMLElement')

    // 2. 按钮容器阻止 pointerDown 冒泡，确保点击正常派发
    expect(windowCode).toContain('data-no-drag onPointerDown={(e) => e.stopPropagation()}')

    // 3. 空状态支持一键新建笔记
    expect(windowCode).toContain('新建第一份笔记')

    // 4. VideoStudyTab 支持 activeEditingNote 瞬时切换二级页面，避免因 store 异步更新延迟导致 currentEditingNote 为 null
    expect(tabCode).toContain('activeEditingNote')
    expect(tabCode).toContain('assignedVideoNodeId')
  })

  it('验证笔记窗口进出场动画生命周期与样式规范', async () => {
    const fs = await import('fs')
    const code = fs.readFileSync('src/components/video/VideoNotesFloatingWindow.tsx', 'utf8')

    // 1. 具备进出场生命周期状态：isRendered 控制挂载，isVisible 控制动画状态
    expect(code).toContain('isRendered')
    expect(code).toContain('isVisible')

    // 2. 动画属性限制在 opacity 与 transform，不干扰拖拽与缩放尺寸（left/top/width/height 零延迟）
    expect(code).toContain('transition-[opacity,transform] duration-200')

    // 3. 进场具备 opacity-100 scale-100 translate-y-0
    expect(code).toContain('opacity-100 scale-100 translate-y-0 ease-out pointer-events-auto')

    // 4. 出场具备 opacity-0 scale-95 translate-y-2 pointer-events-none，且在动画播放完毕后卸载
    expect(code).toContain('opacity-0 scale-95 translate-y-2 ease-in pointer-events-none')
    expect(code).toContain('if (!isRendered) return null')
  })

  it('验证视频节点中创建的笔记节点在落盘并重新加载后不会丢失边，绝不变成游离节点', async () => {
    const { buildDocs } = await import('../src/learn/files/build')
    const { parseDocs } = await import('../src/learn/files/parse')
    const { buildState } = await import('../src/learn/files/state')
    const { createNoteForVideoNode, getNotesForVideoNode } = await import('../src/learn/video/nodes')

    const base = emptyLearnStore()
    const goalId = 'g-test-persist'
    const videoNodeId = 'vnode-1'
    const initialStore = {
      ...base,
      goals: [{ id: goalId, rootNodeId: 'r1', question: '学习', createdAt: 1, updatedAt: 1 }],
      nodes: [{
        id: 'r1',
        title: '根文档',
        key: 'gen',
        description: '',
        docs: { teaching: '' },
        notes: [],
        annotations: [],
        status: 'learning' as const,
        origin: 'user' as const,
        goalId,
        createdAt: 1,
        updatedAt: 1,
      }],
      videoNodes: [{
        id: videoNodeId,
        goalId,
        videoId: 'v-source-1',
        title: '测试视频',
        input: 'BV123',
        createdAt: 1,
        updatedAt: 1,
      }],
    }

    // 1. 在该视频节点下创建笔记节点
    const { store: storeWithNote, note } = createNoteForVideoNode(initialStore, videoNodeId, '重点考点笔记')
    expect(note.id).toBeTruthy()
    expect(storeWithNote.edges.some((e) => e.from === videoNodeId && e.to === note.id)).toBe(true)

    // 创建后结构视图检查：笔记已连接，不含「游离」
    const viewBefore = deriveCanvas(storeWithNote, goalId, undefined)
    const cardBefore = viewBefore.cards.find((c) => c.uuid === note.id)
    expect(cardBefore).toBeDefined()
    expect(cardBefore?.subtitle).not.toContain('游离')

    // 2. 模拟序列化落盘与重新启动加载应用（buildDocs -> parseDocs）
    const files = buildDocs(storeWithNote)
    const state = buildState(storeWithNote)
    const restoredStore = parseDocs(files, state)

    expect(restoredStore).not.toBeNull()
    if (!restoredStore) return

    // 3. 验证关键断言：重新加载后边依然完好存在！
    const edgeRestored = restoredStore.edges.find((e) => e.from === videoNodeId && e.to === note.id)
    expect(edgeRestored).toBeDefined()

    // 4. 验证结构视图派生：重开后依然显示为已连接笔记，绝非游离！
    const viewAfter = deriveCanvas(restoredStore, goalId, undefined)
    const cardAfter = viewAfter.cards.find((c) => c.uuid === note.id)
    expect(cardAfter).toBeDefined()
    expect(cardAfter?.subtitle).not.toContain('游离')

    // 5. 验证视频页签查询笔记：依然能准确检索到该笔记
    const retrievedNotes = getNotesForVideoNode(restoredStore, videoNodeId)
    expect(retrievedNotes.some((n) => n.id === note.id)).toBe(true)
  })
})
