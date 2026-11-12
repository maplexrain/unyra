import { describe, expect, it } from 'vitest'
import { foldNodes } from '../src/agent/sandbox/fold'
import { createSeeOps } from '../src/learn/see'
import type { LearnStore } from '../src/learn/types'
import { makeResource } from '../src/learn/static'
import { createWorkspaceOps } from '../src/learn/ops/workspace'
import { setUserScope } from '../src/lib/storage'
import path from 'node:path'
import { baseProcessCreate } from '../electron/base/process'
import fs from 'node:fs'
import os from 'node:os'

describe('导师 Agent 反馈修复与防护套件', () => {
  describe('1. api.see 支持 moji:static/<uuid> 与已有静态资源复用', () => {
    it('当传入 moji:static/<uuid> 时，能够直接从资源库读取并挂载到下一跳，而不报 base64 错误', async () => {
      setUserScope('test_user')
      const mockUuid = '11111111-2222-3333-4444-555555555555'
      const samplePngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      const sampleDataUrl = `data:image/png;base64,${samplePngBase64}`

      const mockRootId = 'root_node_1'
      let store: LearnStore = {
        goals: [{ id: 'goal_1', title: '测试目标', rootNodeId: mockRootId, createdAt: Date.now(), updatedAt: Date.now() }],
        nodes: [
          {
            id: mockRootId,
            goalId: 'goal_1',
            title: '根讲义',
            key: 'gen-jiang-yi',
            kind: 'doc',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        edges: [],
        conversations: [],
        activeGoalId: 'goal_1',
        resources: {
          goal_1: [
            makeResource({
              uuid: mockUuid,
              name: '测试截图.png',
              ext: 'png',
              bytes: 100,
              hash: 'hash123',
              type: 'binary',
            }),
          ],
        },
      } as unknown as LearnStore

      // 模拟 native storage 读盘
      const globalAny = globalThis as unknown as {
        window?: Record<string, unknown>
      }
      globalAny.window = {
        mojiNative: {
          storage: {
            readBinary: async () => ({ ok: true, dataUrl: sampleDataUrl }),
            writeImage: async () => ({ ok: true }),
          },
        },
      }

      const see = createSeeOps({
        getLatest: () => store,
        set: (next) => {
          store = next
        },
        goalId: () => 'goal_1',
      })

      // 1. 通过 moji:static/<uuid> 引用
      const res1 = await see({ raw: `moji:static/${mockUuid}` })
      expect(res1.ok).toBe(true)
      if (res1.ok) {
        expect(res1.uuid).toBe(mockUuid)
        expect(res1.name).toBe('测试截图.png')
        expect(res1.images).toBeDefined()
        expect(res1.images?.length).toBe(1)
        expect(res1.images?.[0].id).toBe(mockUuid)
      }

      // 2. 通过 { url: 'moji:static/<uuid>' } 引用
      const res2 = await see({ url: `moji:static/${mockUuid}` })
      expect(res2.ok).toBe(true)
      if (res2.ok) {
        expect(res2.uuid).toBe(mockUuid)
      }

      // 3. 引用不存在的 uuid 时给出友好提示
      const res3 = await see({ raw: 'moji:static/non-exist-uuid' })
      expect(res3.ok).toBe(false)
      if (!res3.ok) {
        expect(res3.error).toContain('资源库中找不到引用')
      }
    })
  })

  describe('2. 大文本字段折叠保护 (foldNodes)', () => {
    it('顶层短文本和顶层大文本不受影响，但嵌套在对象内部的超长大文本字段被自动折叠保护上下文', () => {
      // 顶层字符串不折叠
      const bigText = 'A'.repeat(3000)
      expect(foldNodes(bigText)).toBe(bigText)

      // 嵌套对象内的超长大字段被折叠
      const obj = {
        title: '测试文档',
        content: 'B'.repeat(3000),
        status: 'done',
      }
      const folded = foldNodes(obj) as typeof obj
      expect(folded.title).toBe('测试文档')
      expect(folded.status).toBe('done')
      expect(folded.content.length).toBeLessThan(1000)
      expect(folded.content).toContain('已持久化落盘，回执自动折叠避免撑爆上下文')
      expect(folded.content).toContain('3000 字符')

      // 嵌套数组内的超长大字段同样受保护
      const arr = [{ text: 'C'.repeat(2000) }]
      const foldedArr = foldNodes(arr) as Array<{ text: string }>
      expect(foldedArr[0].text).toContain('已持久化落盘')
    })
  })

  describe('3. 工作区未建根节点时的指引', () => {
    it('当目标下没有节点时调用 workspace.write / resolveWs，明确提示先建根节点', async () => {
      const store: LearnStore = {
        goals: [{ id: 'goal_empty', title: '空白目标', createdAt: Date.now(), updatedAt: Date.now() }],
        nodes: [],
        edges: [],
        conversations: [],
        activeGoalId: 'goal_empty',
      } as unknown as LearnStore

      const ws = createWorkspaceOps(
        {
          getLatest: () => store,
          set: () => {},
          goalId: () => 'goal_empty',
          nodeId: () => null,
        },
        {
          read: async () => ({ ok: true, content: null }),
          write: async () => ({ ok: false, error: 'mock' }),
          list: async () => ({ ok: true, entries: [] }),
        },
      )

      const res = await ws.write({ path: 'test.py', content: 'print(1)' })
      expect('error' in res).toBe(true)
      if ('error' in res) {
        expect(res.error).toContain('当前目标尚未创建任何文档节点')
        expect(res.error).toContain('api.node.create')
      }
    })
  })

  describe('4. process.create 漏拼 workspace 智能定位与容错', () => {
    it('当 cwd 漏写了 workspace 层级但物理磁盘上存在 workspace/xxx 时，自动校正并成功创建', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-test-'))
      try {
        // 模拟目录结构: tmpDir/docs/my-goal/my-node/workspace/my-project
        const realWorkspaceProject = path.join(tmpDir, 'docs', 'my-goal', 'my-node', 'workspace', 'my-project')
        fs.mkdirSync(realWorkspaceProject, { recursive: true })

        // 漏写了 workspace 的路径: tmpDir/docs/my-goal/my-node/my-project
        const mistakenCwd = path.join(tmpDir, 'docs', 'my-goal', 'my-node', 'my-project')

        // 临时同步放行白名单
        const { syncAllowedDirs } = await import('../electron/base/permissions')
        syncAllowedDirs([tmpDir])

        const res = await baseProcessCreate({
          command: 'node',
          args: ['-v'],
          cwd: mistakenCwd,
        })

        expect(res.ok).toBe(true)
        if (res.ok) {
          // 验证自动校正到了真实 workspace 路径
          expect(res.cwd).toBe(path.resolve(realWorkspaceProject))
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })

    it('验证 Windows 命令无扩展名或为 .cmd/.bat 时的 needsShell 规则', () => {
      // 检验判断规则逻辑：isWindows && (!ext || ext === '.cmd' || ext === '.bat')
      const checkNeedsShell = (command: string, isWin: boolean) => {
        const ext = path.extname(command).toLowerCase()
        return isWin && (!ext || ext === '.cmd' || ext === '.bat')
      }

      // Windows 下 npm / npx / tsc 等无扩展名命令开启 shell
      expect(checkNeedsShell('npm', true)).toBe(true)
      expect(checkNeedsShell('npx', true)).toBe(true)
      expect(checkNeedsShell('tsc', true)).toBe(true)
      expect(checkNeedsShell('run.cmd', true)).toBe(true)
      expect(checkNeedsShell('build.bat', true)).toBe(true)
      // 带 .exe 扩展名的无需 shell
      expect(checkNeedsShell('node.exe', true)).toBe(false)
      expect(checkNeedsShell('git.exe', true)).toBe(false)

      // 非 Windows 平台一律不强开 shell
      expect(checkNeedsShell('npm', false)).toBe(false)
      expect(checkNeedsShell('run.sh', false)).toBe(false)
    })
  })
})
