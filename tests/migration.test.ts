import { describe, expect, it } from 'vitest'
import { compareVersions, stepOfLegacyVersion } from '../src/lib/migration/version'
import { planChain } from '../src/lib/migration/engine'
import {
  LATEST_SCHEMA_STEP,
  latestStep,
  MIGRATION_SCRIPTS,
  RELEASED_SCHEMA_STEP,
  registerMigrationScript,
} from '../src/lib/migration/scripts'
import type { MigrationContext, MigrationScript } from '../src/lib/migration/types'
import { flattenGoalNodes } from '../src/lib/migration/flattenGoalNodes'
import type { StorageEntry } from '../src/lib/native'
import { parseDocsV3 } from '../src/learn/files/parse'

describe('Migration System', () => {
  describe('compareVersions', () => {
    it('correctly compares version numbers', () => {
      expect(compareVersions('0.6.3', '0.7.0')).toBe(-1)
      expect(compareVersions('0.7.0', '0.6.3')).toBe(1)
      expect(compareVersions('0.6.3', '0.6.3')).toBe(0)
      expect(compareVersions('0.7.0', '0.7.1')).toBe(-1)
      expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    })
  })

  /**
   * 迁移系统改成了**序号制**（见 lib/migration/types.ts 的文件头）：
   * 序号只跟「数据形状改了几回」走，不再跟发版号走。所以这里钉死的是序号，
   * 而不是「0.6.3 会被规划到 0.7.0」这种版本区间断言。
   */
  describe('序号制：脚本清单的不变量', () => {
    it('序号从 1 起、连续、唯一、升序', () => {
      const steps = MIGRATION_SCRIPTS.map((s) => s.step)
      expect(steps.length).toBeGreaterThan(0)
      expect(new Set(steps).size).toBe(steps.length)
      expect(steps).toEqual([...steps].sort((a, b) => a - b))
      expect(steps).toEqual(steps.map((_, i) => i + 1))
    })

    it('LATEST_SCHEMA_STEP 是从清单算出来的，不是手写常量', () => {
      const max = Math.max(...MIGRATION_SCRIPTS.map((s) => s.step))
      expect(LATEST_SCHEMA_STEP).toBe(max)
      expect(latestStep()).toBe(max)
    })

    it('RELEASED_SCHEMA_STEP 不超过最新序号（发版后要把它推到当时的最新）', () => {
      expect(RELEASED_SCHEMA_STEP).toBeLessThanOrEqual(LATEST_SCHEMA_STEP)
      expect(RELEASED_SCHEMA_STEP).toBeGreaterThanOrEqual(0)
    })

    it('真脚本在册：1 大纲树→结构图、2 拓扑重建、3 节点文件合并、4 目标节点同级平铺存储', () => {
      expect(MIGRATION_SCRIPTS.map((s) => s.id)).toEqual([
        'm1-outline-to-structure',
        'm2-structure-topology',
        'm3-node-single-file',
        'm4-flatten-goal-nodes',
      ])
      expect(MIGRATION_SCRIPTS.map((s) => s.step)).toEqual([1, 2, 3, 4])
    })

    it('同一序号或同一 id 不能注册两次（否则执行顺序没有意义）', () => {
      const dup: MigrationScript = {
        step: 1,
        id: 'm-dup-step',
        title: '重复序号',
        summary: '',
        changes: [],
        migrate: async () => ({ ok: true, step: 1, modifiedFiles: [] }),
      }
      const before = MIGRATION_SCRIPTS.length
      registerMigrationScript(dup)
      expect(MIGRATION_SCRIPTS.length).toBe(before)
    })
  })

  describe('stepOfLegacyVersion：老 schema.json 的版本号折算', () => {
    it('0.7.0 之前算 0（一次迁移都没跑过）', () => {
      expect(stepOfLegacyVersion('0.6.3')).toBe(0)
      expect(stepOfLegacyVersion('')).toBe(0)
    })

    it('0.7.0 / 0.7.1 分别折算成第 1 / 第 2 次', () => {
      expect(stepOfLegacyVersion('0.7.0')).toBe(1)
      expect(stepOfLegacyVersion('0.7.1')).toBe(2)
    })

    it('比已知版本更新的一律算最新（不会因为版本号没登记就漏跑）', () => {
      expect(stepOfLegacyVersion('0.9.9')).toBe(2)
    })
  })

  describe('planChain', () => {
    it('已是最新时返回空链', () => {
      const plan = planChain(LATEST_SCHEMA_STEP, LATEST_SCHEMA_STEP)
      expect(plan.isUpToDate).toBe(true)
      expect(plan.scripts.length).toBe(0)
    })

    it('从 0 开始会把全部脚本按序排出来', () => {
      const plan = planChain(0, LATEST_SCHEMA_STEP)
      expect(plan.isUpToDate).toBe(false)
      expect(plan.scripts.map((s) => s.step)).toEqual(MIGRATION_SCRIPTS.map((s) => s.step))
      expect(plan.currentStep).toBe(0)
      expect(plan.targetStep).toBe(LATEST_SCHEMA_STEP)
    })

    it('只跑比当前序号大的（重跑不会把老脚本再跑一遍）', () => {
      const plan = planChain(1, LATEST_SCHEMA_STEP)
      expect(plan.scripts.map((s) => s.step)).toEqual(
        MIGRATION_SCRIPTS.filter((s) => s.step > 1).map((s) => s.step),
      )
    })

    it('目标序号是上限：给了 1 就只跑到第 1 次', () => {
      const plan = planChain(0, 1)
      expect(plan.scripts.map((s) => s.step)).toEqual([1])
      expect(plan.targetStep).toBe(1)
    })

    it('数据序号比代码还新时标记 dataAhead，不能静默当成「已是最新」', () => {
      // 场景：本机跑过未发布的第 5 次迁移，之后上线前把它并进了第 4 次
      const plan = planChain(LATEST_SCHEMA_STEP + 1, LATEST_SCHEMA_STEP)
      expect(plan.scripts).toEqual([])
      expect(plan.dataAhead).toBe(true)

      const normal = planChain(0, LATEST_SCHEMA_STEP)
      expect(normal.dataAhead).toBe(false)
    })
  })

  describe('Script Execution', () => {
    it('executes a migration script and transforms data', async () => {
      const store: Record<string, unknown> = {
        'users/test/state.json': {
          dataVersion: 'old',
        },
      }

      const logs: string[] = []
      const ctx: MigrationContext = {
        uid: 'test',
        userDir: 'users/test',
        storage: {
          readJson: async <T>(rel: string) => (store[rel] as T) ?? null,
          writeJson: async (rel: string, data: unknown) => {
            store[rel] = data
            return true
          },
          readYaml: async () => null,
          writeYaml: async () => true,
          readText: async () => null,
          writeText: async () => true,
          listDir: async () => [],
          removePath: async () => true,
          mkdir: async () => true,
        },
        log: (msg) => logs.push(msg),
      }

      const testScript: MigrationScript = {
        step: 99,
        id: 'test-upgrade',
        title: 'Test Upgrade',
        summary: 'Test data migration',
        changes: ['Update dataVersion to new'],
        migrate: async (context) => {
          const state = await context.storage.readJson<Record<string, unknown>>('users/test/state.json')
          if (state) {
            state.dataVersion = 'new'
            await context.storage.writeJson('users/test/state.json', state)
          }
          return {
            ok: true,
            step: 99,
            modifiedFiles: ['users/test/state.json'],
          }
        },
      }

      const res = await testScript.migrate(ctx)
      expect(res.ok).toBe(true)
      expect(res.step).toBe(99)
      expect((store['users/test/state.json'] as { dataVersion?: string }).dataVersion).toBe('new')
    })
  })

  describe('flattenGoalNodes: 第 4 次迁移（目标节点同级平铺解耦）', () => {
    it('正确将多层嵌套节点平铺到目标直属的一级子目录，并安全搬迁工作区与清理旧路径', async () => {
      const files: Record<string, string> = {
        // 目标级与根节点
        'users/u1/docs/微积分/goal.json': JSON.stringify({
          version: 1,
          id: 'g1',
          title: '微积分',
          question: '学懂微积分',
          rootNodeId: 'root',
          createdAt: 1000,
          updatedAt: 1000,
        }),
        'users/u1/docs/微积分/微积分.node.json': JSON.stringify({
          version: 1,
          id: 'root',
          title: '微积分',
          key: '微积分',
          description: '',
          parts: [{ kind: 'teaching', text: '# 微积分根节点' }],
          origin: 'user',
          status: 'learned',
          dependencies: [{ to: 'child1' }],
          createdAt: 1000,
          updatedAt: 1000,
        }),
        // 一级子节点
        'users/u1/docs/微积分/极限/极限.node.json': JSON.stringify({
          version: 1,
          id: 'child1',
          title: '极限',
          key: '极限',
          description: '',
          parts: [{ kind: 'teaching', text: '# 极限内容' }],
          origin: 'user',
          status: 'learning',
          dependencies: [{ to: 'grandchild1' }],
          createdAt: 1001,
          updatedAt: 1001,
        }),
        // 旧多层嵌套子节点（深度 5）
        'users/u1/docs/微积分/极限/导数/导数.node.json': JSON.stringify({
          version: 1,
          id: 'grandchild1',
          title: '导数',
          key: '导数',
          description: '',
          parts: [{ kind: 'teaching', text: '# 导数内容' }],
          origin: 'user',
          status: 'learning',
          dependencies: [],
          createdAt: 1002,
          updatedAt: 1002,
        }),
        // 旧嵌套节点内部的工作区文件
        'users/u1/docs/微积分/极限/导数/workspace/calc.py': 'print("derivative")',
      }

      const logs: string[] = []
      const ctx: MigrationContext = {
        uid: 'u1',
        userDir: 'users/u1',
        storage: {
          readJson: async <T>(rel: string) => {
            const raw = files[rel]
            return raw ? (JSON.parse(raw) as T) : null
          },
          writeJson: async (rel: string, data: unknown) => {
            files[rel] = JSON.stringify(data)
            return true
          },
          readYaml: async () => null,
          writeYaml: async () => true,
          readText: async (rel: string) => files[rel] ?? null,
          writeText: async (rel: string, content: string) => {
            files[rel] = content
            return true
          },
          listDir: async (rel: string): Promise<StorageEntry[]> => {
            const prefix = rel.endsWith('/') ? rel : rel + '/'
            const entries = new Map<string, StorageEntry>()
            for (const path of Object.keys(files)) {
              if (path.startsWith(prefix)) {
                const sub = path.slice(prefix.length)
                const parts = sub.split('/')
                const name = parts[0]
                const isDir = parts.length > 1
                if (!entries.has(name)) {
                  entries.set(name, {
                    name,
                    dir: isDir,
                  })
                }
              }
            }
            return [...entries.values()]
          },
          removePath: async (rel: string) => {
            delete files[rel]
            // 也删除所有以该目录为前缀的项
            const prefix = rel.endsWith('/') ? rel : rel + '/'
            for (const k of Object.keys(files)) {
              if (k.startsWith(prefix)) delete files[k]
            }
            return true
          },
          mkdir: async () => true,
          movePath: async (from: string, to: string) => {
            const fromPrefix = from.endsWith('/') ? from : from + '/'
            const toPrefix = to.endsWith('/') ? to : to + '/'
            for (const k of Object.keys(files)) {
              if (k.startsWith(fromPrefix)) {
                const rel = k.slice(fromPrefix.length)
                files[toPrefix + rel] = files[k]
                delete files[k]
              }
            }
            return true
          },
        },
        log: (msg) => logs.push(msg),
      }

      // 执行迁移
      const res = await flattenGoalNodes.migrate(ctx)
      expect(res.ok).toBe(true)
      expect(res.step).toBe(4)

      // 验证平铺结构：导数节点应当在 docs/微积分/导数/ 下，而不是 docs/微积分/极限/导数/ 下
      expect(files['users/u1/docs/微积分/导数/导数.node.json']).toBeDefined()
      expect(files['users/u1/docs/微积分/导数/workspace/calc.py']).toBe('print("derivative")')

      // 旧多层嵌套文件应已被删除
      expect(files['users/u1/docs/微积分/极限/导数/导数.node.json']).toBeUndefined()
      expect(files['users/u1/docs/微积分/极限/导数/workspace/calc.py']).toBeUndefined()

      // 验证自查与 parseDocsV3 解析无误
      const docsMap = new Map<string, string>()
      for (const [k, v] of Object.entries(files)) {
        if (k.startsWith('users/u1/')) docsMap.set(k.slice('users/u1/'.length), v)
      }
      const storeBack = parseDocsV3(docsMap, {})
      expect(storeBack).not.toBeNull()
      expect(storeBack!.nodes.length).toBe(3)
      expect(storeBack!.nodes.map((n) => n.title).sort()).toEqual(['导数', '微积分', '极限'])

      // 验证幂等性：再次执行直接跳过
      const rerun = await flattenGoalNodes.migrate(ctx)
      expect(rerun.ok).toBe(true)
      expect(rerun.details).toContain('已在同一级存储（已迁移过）')
    })
  })
})
