import { describe, expect, it } from 'vitest'
import { BUILTIN_SKILLS } from '../src/agent/skill/builtins'
import {
  formatActiveSkillsPrompt,
  getActiveSkills,
  getEffectiveSkills,
} from '../src/agent/skill/registry'
import { MCP_PRESETS, type McpSettings } from '../src/agent/mcp/types'
import { makeMcpOps } from '../src/agent/mcp/ops'
import { normalizeAgentSettings } from '../src/agent/settings'

describe('Agent 技能 (Skills) 与 MCP 设施测试', () => {
  describe('Skills 聚合与系统提示词注入', () => {
    it('内置技能库已清空，全部技能通过用户自定义或磁盘安装', () => {
      expect(BUILTIN_SKILLS).toEqual([])
    })

    it('无自定义配置且无磁盘技能时返回空', () => {
      const skills = getEffectiveSkills(null)
      expect(skills.length).toBe(0)

      const active = getActiveSkills(null)
      expect(active).toEqual([])
    })

    it('用户自定义技能可正确解析生效并生成发现层提示词', () => {
      const customSkill = {
        id: 'custom-math',
        name: '数学公理验证师',
        description: '严格检查公理体系',
        instructions: '严格依据集合论推导',
        enabled: true,
      }

      const settings = {
        enabled: true,
        skills: [customSkill],
      }

      const effective = getEffectiveSkills(settings)
      const math = effective.find((s) => s.id === 'custom-math')
      expect(math?.enabled).toBe(true)
      expect(math?.builtin).toBe(false)

      const prompt = formatActiveSkillsPrompt(effective)
      expect(prompt).toContain('数学公理验证师')
      expect(prompt).toContain('严格检查公理体系')
    })

    it('技能总开关为 false 时，getActiveSkills 返回空', () => {
      const active = getActiveSkills({ enabled: false, skills: [] })
      expect(active).toEqual([])
    })
  })

  describe('MCP 服务接入 execute 沙箱（agent/mcp/ops：mcp.list / discover / call）', () => {
    it('预设列表中包含 fetch, filesystem 等标准服务', () => {
      expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(3)
      expect(MCP_PRESETS.some((p) => p.id === 'mcp-fetch')).toBe(true)
      expect(MCP_PRESETS.some((p) => p.id === 'mcp-filesystem')).toBe(true)
    })

    const mkSettings = (): McpSettings => ({
      enabled: true,
      servers: [
        {
          id: 'fetch-srv',
          name: 'FetchServer',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@tokenizin/mcp-npx-fetch'],
          enabled: true,
          tools: [{ name: 'fetch_url', description: '抓取指定网页内容' }],
        },
        {
          id: 'disabled-srv',
          name: 'DisabledServer',
          transport: 'sse',
          enabled: false,
          tools: [{ name: 'dummy' }],
        },
      ],
    })

    /**
     * 装一个假的主进程 MCP 桥（native() 读的是 window.mojiNative）；返回还原函数。
     * 真桥的两端在 electron/mcp（主进程）与真进程用例 tests/mcpStdio.test.ts——
     * 这里只验「渲染层把什么递过去、把什么带回来」。
     */
    const withMcpBridge = <T>(
      bridge: { discover?: unknown; call?: unknown },
      fn: () => Promise<T>,
    ): Promise<T> => {
      const g = globalThis as { window?: unknown }
      const orig = g.window
      g.window = { mojiNative: { mcp: bridge } }
      return fn().finally(() => {
        if (orig === undefined) delete g.window
        else g.window = orig
      })
    }

    it('mcp.list 只列已启用服务与缓存的工具清单（禁用的不出现）', () => {
      const listed = makeMcpOps(mkSettings())!.list() as {
        ok: boolean
        servers: Array<{ id: string; tools: Array<{ name: string }> }>
      }
      expect(listed.ok).toBe(true)
      expect(listed.servers.map((s) => s.id)).toEqual(['fetch-srv'])
      expect(listed.servers[0].tools[0].name).toBe('fetch_url')
    })

    it('总开关关闭时 makeMcpOps 返回 null（宿主据此不注入这一组）', () => {
      expect(makeMcpOps({ ...mkSettings(), enabled: false })).toBeNull()
      expect(makeMcpOps(null)).toBeNull()
    })

    it('mcp.discover：stdio 委托主进程桥做真实探测（渲染层不直接起进程、不吃缓存）', async () => {
      const seen: Array<Record<string, unknown>> = []
      const r = (await withMcpBridge(
        {
          discover: async (payload: Record<string, unknown>) => {
            seen.push(payload)
            return { ok: true, tools: [{ name: 'fetch_markdown', description: '抓取并转 Markdown' }] }
          },
        },
        () => makeMcpOps(mkSettings())!.discover('fetch-srv'),
      )) as { ok: boolean; servers: Array<{ id: string; ok: boolean; tools: Array<{ name: string }> }> }
      expect(r.ok).toBe(true)
      expect(r.servers[0].id).toBe('fetch-srv')
      // 回来的必须是桥给的实时清单（不是设置里那份缓存）
      expect(r.servers[0].tools[0].name).toBe('fetch_markdown')
      expect(seen[0]).toMatchObject({ id: 'fetch-srv', name: 'FetchServer', command: 'npx' })
    })

    it('mcp.call：stdio 把服务配置与参数递给主进程，回执原样映射', async () => {
      const seen: Array<unknown[]> = []
      const r = (await withMcpBridge(
        {
          call: async (...args: unknown[]) => {
            seen.push(args)
            return { ok: true, isError: false, content: [{ type: 'text', text: '外部结果：极限' }] }
          },
        },
        () => makeMcpOps(mkSettings())!.call('FetchServer', 'fetch_markdown', { url: 'https://example.com' }),
      )) as Record<string, unknown>
      expect(r.ok).toBe(true)
      expect(r.server).toBe('fetch-srv')
      expect(r.tool).toBe('fetch_markdown')
      expect(r.content).toBe('外部结果：极限')
      expect(seen[0][0]).toMatchObject({ id: 'fetch-srv', command: 'npx', args: ['-y', '@tokenizin/mcp-npx-fetch'] })
      expect(seen[0][1]).toBe('fetch_markdown')
      expect(seen[0][2]).toEqual({ url: 'https://example.com' })
    })

    it('没有主进程桥（非桌面环境）：给出可读错误而不是假成功', async () => {
      const g = globalThis as { window?: unknown }
      const saved = g.window
      delete g.window
      const r = (await makeMcpOps(mkSettings())!.call('fetch-srv', 'fetch_url', {})) as {
        ok: boolean
        content: string
      }
      expect(r.ok).toBe(false)
      expect(r.content).toContain('桌面应用环境')
      if (saved !== undefined) g.window = saved
    })

    it('未启用的服务给出可读原因（不静默失败）', async () => {
      const r = (await makeMcpOps(mkSettings())!.call('DisabledServer', 'dummy')) as { ok: boolean; error?: string }
      expect(r.ok).toBe(false)
      expect(r.error).toContain('未启用')
    })

    it('未知服务报出可读错误与现有服务清单', async () => {
      const r = (await makeMcpOps(mkSettings())!.discover('不存在')) as { ok: boolean; error?: string }
      expect(r.ok).toBe(false)
      expect(r.error).toContain('没有找到')
      expect(r.error).toContain('FetchServer')
    })

    it('call 参数不是对象时拒绝（不把字符串塞给服务端）', async () => {
      const r = (await makeMcpOps(mkSettings())!.call('fetch-srv', 'fetch_url', '不是对象')) as {
        ok: boolean
        error?: string
      }
      expect(r.ok).toBe(false)
      expect(r.error).toContain('对象')
    })

    it('SSE 服务的 call 走 JSON-RPC tools/call（fetch 打桩，不碰网络）', async () => {
      const orig = globalThis.fetch
      const seen: string[] = []
      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body))
        seen.push(String(payload.method) + ':' + String(payload.params?.name))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            id: payload.id,
            result: { content: [{ type: 'text', text: '外部结果：' + payload.params.arguments.q }] },
          }),
        } as unknown as Response
      }) as typeof fetch
      try {
        const ops = makeMcpOps({
          enabled: true,
          servers: [
            {
              id: 's1',
              name: '远端服务',
              transport: 'sse',
              url: 'http://localhost:9/sse',
              enabled: true,
              tools: [{ name: 'query' }],
            },
          ],
        })!
        const r = (await ops.call('s1', 'query', { q: '极限' })) as Record<string, unknown>
        expect(r.ok).toBe(true)
        expect(r.content).toBe('外部结果：极限')
        expect(seen).toEqual(['tools/call:query'])
      } finally {
        globalThis.fetch = orig
      }
    })

    it('工具级报错（isError）转成 ok:false 且保留错误文本', async () => {
      const orig = globalThis.fetch
      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            id: payload.id,
            result: { isError: true, content: [{ type: 'text', text: '参数不对' }] },
          }),
        } as unknown as Response
      }) as typeof fetch
      try {
        const ops = makeMcpOps({
          enabled: true,
          servers: [{ id: 's1', name: '远端服务', transport: 'sse', url: 'http://localhost:9/sse', enabled: true }],
        })!
        const r = (await ops.call('s1', 'query', {})) as Record<string, unknown>
        expect(r.ok).toBe(false)
        expect(r.content).toBe('参数不对')
      } finally {
        globalThis.fetch = orig
      }
    })
  })

  describe('AgentSettings 针对 Skills 和 MCP 的归一化', () => {
    it('缺省时自动补充默认值，老版本配置平滑升级', () => {
      const normalized = normalizeAgentSettings({})
      expect(normalized.skills?.enabled).toBe(true)
      expect(normalized.skills?.skills).toEqual([])
      expect(normalized.mcp?.enabled).toBe(true)
      expect(normalized.mcp?.servers).toEqual([])
    })

    it('保留用户合法的 skills 和 mcp 配置', () => {
      const custom = {
        skills: {
          enabled: false,
          skills: [{ id: 's1', name: 'S1', description: '', instructions: '', enabled: true }],
        },
        mcp: {
          enabled: true,
          servers: [{ id: 'm1', name: 'M1', transport: 'sse' as const, enabled: true }],
        },
      }
      const normalized = normalizeAgentSettings(custom)
      expect(normalized.skills?.enabled).toBe(false)
      expect(normalized.skills?.skills.length).toBe(1)
      expect(normalized.mcp?.servers.length).toBe(1)
      expect(normalized.mcp?.servers[0].id).toBe('m1')
    })

    it('老预设的死参数会被迁移：404 包名与 ./workspace 换成能跑的形态', () => {
      const normalized = normalizeAgentSettings({
        mcp: {
          enabled: true,
          servers: [
            { id: 'f', name: 'F', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], enabled: true },
            { id: 's', name: 'S', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', 'data.db'], enabled: true },
            { id: 'fs', name: 'FS', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', './workspace'], enabled: true },
            // 用户自己改过的（别的包）原样不动
            { id: 'mine', name: 'Mine', transport: 'stdio', command: 'node', args: ['/my/server.js'], enabled: true },
          ],
        },
      })
      const byId = (id: string) => normalized.mcp?.servers.find((s) => s.id === id)
      expect(byId('f')?.args).toEqual(['-y', '@tokenizin/mcp-npx-fetch'])
      expect(byId('s')?.args).toEqual(['-y', 'mcp-sqlite-server'])
      expect(byId('fs')?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '.'])
      expect(byId('mine')?.args).toEqual(['/my/server.js'])
    })
  })

  describe('物理独立技能目录与 SKILL.md 读写规范', () => {
    it('正确解析带有标准 YAML Frontmatter 的 SKILL.md 文件', async () => {
      const { parseSkillMd, serializeSkillMd } = await import('../src/agent/skill/fs')

      const rawMd = `---
name: 深度反向批判
description: 通过层层反问识别认知偏差
category: learning
tags:
  - 批判思考
  - 逻辑学
icon: Sparkles
enabled: true
---

## 技能规范：反向批判
1. 识别前提假设
2. 构造反例
`
      const parsed = parseSkillMd(rawMd, 'critical-thinking')
      expect(parsed.id).toBe('critical-thinking')
      expect(parsed.name).toBe('深度反向批判')
      expect(parsed.description).toBe('通过层层反问识别认知偏差')
      expect(parsed.category).toBe('learning')
      expect(parsed.tags).toEqual(['批判思考', '逻辑学'])
      expect(parsed.enabled).toBe(true)
      expect(parsed.instructions).toContain('## 技能规范：反向批判')
      expect(parsed.instructions).toContain('1. 识别前提假设')

      // 测试序列化与往返解析
      const serialized = serializeSkillMd(parsed)
      expect(serialized).toContain('name: 深度反向批判')
      expect(serialized).toContain('category: learning')
      expect(serialized).toContain('## 技能规范：反向批判')

      const reparsed = parseSkillMd(serialized, 'critical-thinking')
      expect(reparsed.name).toBe(parsed.name)
      expect(reparsed.category).toBe(parsed.category)
      expect(reparsed.instructions).toBe(parsed.instructions)
    })

    it('无 Frontmatter 时安全回退为纯 Markdown 指令', async () => {
      const { parseSkillMd } = await import('../src/agent/skill/fs')
      const pureMd = '## 纯指令正文\n直接按步骤执行。'
      const parsed = parseSkillMd(pureMd, 'pure-skill')
      expect(parsed.id).toBe('pure-skill')
      expect(parsed.name).toBe('pure-skill')
      expect(parsed.instructions).toBe('## 纯指令正文\n直接按步骤执行。')
      expect(parsed.enabled).toBe(true)
    })

    it('技能目录标识 ID 规范化安全处理', async () => {
      const { sanitizeSkillId } = await import('../src/agent/skill/fs')
      expect(sanitizeSkillId('  My First Skill!  ')).toBe('my-first-skill')
      expect(sanitizeSkillId('deep__learning//v2')).toBe('deep__learning-v2')
      expect(sanitizeSkillId('---test---')).toBe('test')
    })
  })
})

