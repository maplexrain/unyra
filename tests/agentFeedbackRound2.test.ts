import { describe, it, expect, vi } from 'vitest'
import { buildApi } from '../src/agent/sandbox/api'
import { wsChipUserRel } from '../src/learn/chipRef'
import { createChipOps } from '../src/learn/ops/chip'
import { createWorkspaceOps } from '../src/learn/ops/workspace'
import { buildInspectElementPickerScript } from '../src/learn/web/guestInspectPicker'
import { buildApplyPureModeScript } from '../src/learn/web/guestPureMode'
import { makeBrowserOps } from '../src/learn/web/browserOps'
import type { LearnStore, KnowledgeNode } from '../src/learn/types'
import type { SandboxOptions } from '../src/agent/sandbox/types'

describe('Agent Feedback Round 2 Optimizations', () => {
  describe('B4: api.fetch maxChars strict limit', () => {
    it('strictly truncates content to maxChars without appending overflowing characters', async () => {
      const mockWeb = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          title: 'Test Article',
          content: 'A'.repeat(15000),
        }),
      }
      const { api } = buildApi({ web: mockWeb } as unknown as SandboxOptions, [])
      const res = (await (api as any).fetch('https://example.com/test', { maxChars: 12000 })) as any

      expect(res.ok).toBe(true)
      expect(res.content.length).toBe(12000)
      expect(res.truncated).toBe(true)
      expect(res.totalChars).toBe(15000)
      expect(res.note).toContain('12000')
    })
  })

  describe('B5: node.create isomorphic return', () => {
    it('returns both top-level uuid/id/kind and compatible node object', async () => {
      const mockNodeService = {
        create: vi.fn().mockReturnValue({
          ok: true,
          uuid: 'node-uuid-123',
          title: '新建测试文档',
          created: true,
          note: '节点创建成功',
        }),
        get: vi.fn(),
        setRoot: vi.fn(),
        list: vi.fn(),
        brief: vi.fn(),
        delete: vi.fn(),
      }
      const { api } = buildApi({ nodes: { service: () => mockNodeService as any } } as unknown as SandboxOptions, [])
      const res = (await (api as any).node.create({ kind: 'doc', title: '新建测试文档' })) as any

      expect(res.ok).toBe(true)
      expect(res.uuid).toBe('node-uuid-123')
      expect(res.id).toBe('node-uuid-123')
      expect(res.kind).toBe('doc')
      expect(res.node).toBeDefined()
      expect(res.node.uuid).toBe('node-uuid-123')
      expect(res.node.id).toBe('node-uuid-123')
      expect(res.node.kind).toBe('doc')
      expect(res.node.title).toBe('新建测试文档')
    })
  })

  describe('A4 & C1: workspace delete, move, download', () => {
    it('supports delete, move, and download via workspace and files aliases', async () => {
      const mockIo = {
        list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
        read: vi.fn().mockResolvedValue({ ok: true, content: 'test content' }),
        write: vi.fn().mockResolvedValue({ ok: true }),
        delete: vi.fn().mockResolvedValue({ ok: true }),
        move: vi.fn().mockResolvedValue({ ok: true }),
        writeBinary: vi.fn().mockResolvedValue({ ok: true }),
      }

      const dummyStore = {
        goals: [{ id: 'g1', title: '目标1', question: '目标1', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'n1',
            key: 'root',
            goalId: 'g1',
            createdAt: 1,
            updatedAt: 1,
            docs: { teaching: '教学' },
            annotations: [],
          } as unknown as KnowledgeNode,
        ],
        edges: [],
        exams: [],
        docArea: { groups: [{ id: 'main', tabs: [], active: '' }] },
      } as unknown as LearnStore

      const deps = {
        getLatest: () => dummyStore,
        set: vi.fn(),
        goalId: () => 'g1',
        nodeId: () => 'n1',
      }

      const ws = createWorkspaceOps(deps as any, mockIo as any)

      // 1. Delete
      const delRes = (await ws.delete('n1/temp.md')) as any
      expect(delRes.ok).toBe(true)
      expect(delRes.deleted).toBe(true)
      expect(mockIo.delete).toHaveBeenCalled()

      // 2. Move
      const moveRes = (await ws.move('n1/old.md', 'n1/new.md')) as any
      expect(moveRes.ok).toBe(true)
      expect(moveRes.moved).toBe(true)
      expect(mockIo.move).toHaveBeenCalled()

      // 3. API bridge wiring
      const { api } = buildApi({ workspace: ws } as unknown as SandboxOptions, [])
      expect(typeof (api as any).workspace.delete).toBe('function')
      expect(typeof (api as any).workspace.move).toBe('function')
      expect(typeof (api as any).workspace.download).toBe('function')
      expect(typeof (api as any).files.download).toBe('function')
    })
  })

  describe('B1 & B2: chip.build and wsChipUserRel path compatibility', () => {
    it('supports bare filename and workspace/ prefix for workspace chips', () => {
      const dummyStore = {
        goals: [{ id: 'g1', title: '微积分', question: '微积分', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'n1',
            key: '微积分',
            goalId: 'g1',
            createdAt: 1,
            updatedAt: 1,
            docs: { teaching: '教学' },
            annotations: [],
          } as unknown as KnowledgeNode,
        ],
        edges: [],
        exams: [],
        docArea: { groups: [{ id: 'main', tabs: [], active: '' }] },
      } as unknown as LearnStore

      // 1. chip.build 裸文件名自动锚定节点上下文
      const chipOps = createChipOps({
        getLatest: () => dummyStore,
        set: () => {},
        nodeId: () => 'n1',
        goalId: () => 'g1',
      })
      const chipRes = chipOps.build({ type: 'ws', path: 'article.md' })
      expect(chipRes.ok).toBe(true)
      if ('chip' in chipRes) {
        expect(chipRes.chip).toContain('workspace/article.md')
        expect(chipRes.path).toContain('workspace/article.md')
      }

      // 2. workspace/ 前缀兼容
      const rel2 = wsChipUserRel(dummyStore, 'workspace/article.md')
      expect(rel2).toContain('workspace/article.md')

      // 3. docs/... 磁盘路径透传
      const rel3 = wsChipUserRel(dummyStore, 'docs/微积分/workspace/article.md')
      expect(rel3).toBe('docs/微积分/workspace/article.md')
    })

    it('reports clear error message on chip.build when ws path is missing', () => {
      const dummyStore = {
        goals: [{ id: 'g1', title: '微积分', question: '微积分', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
        nodes: [
          {
            id: 'n1',
            key: '微积分',
            goalId: 'g1',
            createdAt: 1,
            updatedAt: 1,
            docs: { teaching: '教学' },
            annotations: [],
          } as unknown as KnowledgeNode,
        ],
        edges: [],
        exams: [],
        docArea: { groups: [{ id: 'main', tabs: [], active: '' }] },
      } as unknown as LearnStore
      const chipOps = createChipOps({
        getLatest: () => dummyStore,
        set: vi.fn(),
        goalId: () => 'g1',
        nodeId: () => 'n1',
      } as any)

      const res = chipOps.build({ type: 'ws' }) as any
      expect(res.ok).toBe(false)
      expect(res.problem).toContain('需为工作区文件路径')
    })
  })

  describe('B6: browser.tabs tab source and fileNode attribution', () => {
    it('marks source as fileNode when opened from file node and user otherwise', () => {
      const dummyStore = {
        goals: [{ id: 'g1', title: '目标1', question: '目标1', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
        nodes: [],
        fileNodes: [
          {
            id: 'fn-web-1',
            goalId: 'g1',
            title: 'B 站视频页面',
            fileKind: 'web',
            url: 'https://bilibili.com/video',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        edges: [],
        exams: [],
        docArea: {
          groups: [
            {
              id: 'main',
              tabs: [
                {
                  id: 'tab-1',
                  ref: { kind: 'web', url: 'https://bilibili.com/video', key: 'k1', fileNodeId: 'fn-web-1' },
                },
                {
                  id: 'tab-2',
                  ref: { kind: 'web', url: 'https://google.com', key: 'k2' },
                },
              ],
              active: 'tab-1',
            },
          ],
        },
      } as unknown as LearnStore

      const browserOps = makeBrowserOps({
        getLatest: () => dummyStore,
        openWebTab: vi.fn(),
        activeWebview: () => null,
      } as any)

      const res = browserOps.tabs()
      expect(res.tabs.length).toBe(2)

      const tab1 = res.tabs.find((t) => t.tabId === 'tab-1')!
      expect(tab1.source).toBe('fileNode')
      expect(tab1.fileNodeId).toBe('fn-web-1')
      expect(tab1.fileNodeTitle).toBe('B 站视频页面')

      const tab2 = res.tabs.find((t) => t.tabId === 'tab-2')!
      expect(tab2.source).toBe('user')
      expect(tab2.fileNodeId).toBeUndefined()
    })
  })

  describe('Inspector element picker script', () => {
    it('generates a valid IIFE Promise script containing overlay, badge, and event listeners', () => {
      const script = buildInspectElementPickerScript()
      expect(script).toContain('__agent_inspect_overlay__')
      expect(script).toContain('__agent_inspect_badge__')
      expect(script).toContain('__agent_inspect_banner__')
      expect(script).toContain('mousemove')
      expect(script).toContain('click')
      expect(script).toContain('Escape')
      expect(script).toContain('computeBestSelector')
      // 保证使用原生 SVG 图标，杜绝 emoji 字符
      expect(script).toContain('<svg')
      expect(/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(script)).toBe(false)
    })

    it('supports whitelist and blacklist pick modes with distinct prompts and themes', () => {
      const scriptWhite = buildInspectElementPickerScript('whitelist')
      expect(scriptWhite).toContain('加入白名单')
      expect(scriptWhite).toContain('#f59e0b')

      const scriptBlack = buildInspectElementPickerScript('blacklist')
      expect(scriptBlack).toContain('加入黑名单')
      expect(scriptBlack).toContain('#ef4444')
    })
  })

  describe('Pure reading and DOM filter script (guestPureMode)', () => {
    it('generates CSS that applies blacklist without destroying page when whitelist is empty', () => {
      const script = buildApplyPureModeScript({ blacklist: ['.ad-container', 'header.site-header'] })
      expect(script).toContain('.ad-container')
      expect(script).toContain('header.site-header')
      expect(script).toContain('blacklist_only')
    })

    it('generates non-destructive ancestor rules when whitelist is provided', () => {
      const script = buildApplyPureModeScript({
        whitelist: ['article.main-article', '.markdown-body'],
        blacklist: ['.promo-banner'],
      })
      expect(script).toContain('article.main-article')
      expect(script).toContain('.markdown-body')
      expect(script).toContain('.promo-banner')
      expect(script).toContain('__agent_pure_ancestor__')
      expect(script).toContain('__agent_pure_target__')
      expect(script).toContain('whitelist_and_blacklist')
    })

    it('cleans up styles and marker classes when pure mode is disabled', () => {
      const script = buildApplyPureModeScript(undefined, false)
      expect(script).toContain('__agent_pure_mode_style__')
      expect(script).toContain('styleEl.remove()')
      expect(script).toContain('enabled: false')
    })
  })
})
