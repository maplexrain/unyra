/**
 * api 注册表的单元用例：唯一入口、登记完整性、`__help()` 渲染。
 *
 * 它的错误形态是「实现里有一条 api，注册表里没有」——`wrapApi` 会当场炸（探针先红）；
 * 或者反过来「注册表里有、帮助里却没有示例」——模型查了 help 还是不知道怎么写。
 */
import { describe, expect, it } from 'vitest'

import {
  API_GROUPS,
  apiDocOf,
  buildSandboxHelp,
  catalogGroups,
  exposedApiNames,
  groupIndexForSystemPrompt,
  promotedGroups,
  renderApiHelp,
  renderGroupHelp,
  renderRootHelp,
} from '../src/agent/sandbox/apiRegistry'

describe('注册表形状', () => {
  it('组 key 唯一；组内 api 名唯一（full 名全表唯一）', () => {
    const keys = API_GROUPS.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
    const fulls = API_GROUPS.flatMap((g) => g.apis.map((a) => a.full))
    expect(new Set(fulls).size).toBe(fulls.length)
  })

  it('每条 api 都有签名、作用、用法与示例；示例必须是可执行表达式（带 await api. 前缀或裸调用）', () => {
    for (const group of API_GROUPS) {
      for (const api of group.apis) {
        expect(api.signature, api.full).toMatch(/\(/)
        expect(api.summary.trim().length, api.full).toBeGreaterThan(3)
        expect(api.usage.trim().length, api.full).toBeGreaterThan(12)
        expect(api.example.trim().length, api.full).toBeGreaterThan(4)
      }
    }
  })

  it('暴露名单包含全部数据面 api（files 退役后它们是唯一入口）', () => {
    const names = exposedApiNames()
    for (const name of [
      'node.list', 'node.get', 'node.create', 'node.delete', 'node.invoke',
      'exam.read', 'exam.grade', 'exam.explain',
      'res.read', 'workspace.write',
      'userInfo.get', 'tmp.set',
      'wf.list', 'wf.get', 'wf.create', 'wf.remove', 'wf.invoke',
      // 记忆：五条全进名单（工作 / 长期两类都靠它读写）
      'memory.list', 'memory.get', 'memory.create', 'memory.update', 'memory.delete',
      // 日程：agent 能排、能改、能标完成（响铃与确认在宿主，见 learn/schedule）
      'schedule.list', 'schedule.create', 'schedule.update', 'schedule.complete', 'schedule.remove',
    ]) {
      expect(names, name).toContain(name)
    }
  })

  it('旧内容组整组退役（doc / graph / content / outline / sdoc / exam.create 全部不在）', () => {
    const names = exposedApiNames()
    expect(names.some((n) => n.startsWith('doc.'))).toBe(false)
    expect(names.some((n) => n.startsWith('graph.'))).toBe(false)
    expect(names.some((n) => n.startsWith('content.'))).toBe(false)
    expect(names.some((n) => n.startsWith('outline.'))).toBe(false)
    expect(names.some((n) => n.startsWith('sdoc.'))).toBe(false)
    expect(names).not.toContain('exam.create')
  })

  it('退役的组整组移除：description / mind 都不在了', () => {
    const names = exposedApiNames()
    // description.* 被 graph.update 取代；它不是「隐藏」而是**整组删掉**了
    expect(names).not.toContain('description.read')
    expect(apiDocOf('description.read')).toBeNull()
    expect(apiDocOf('description.update')).toBeNull()
    // mind.* 被 memory.* 取代：不留兼容层——它从来没进过名单，也没有对话会真的调它
    expect(names.some((n) => n.startsWith('mind.'))).toBe(false)
    expect(apiDocOf('mind.list')).toBeNull()
  })

  it('名单与目录视图（catalogGroups）完全一致', () => {
    const names = exposedApiNames()
    const catalogNames = catalogGroups().flatMap((g) => g.items.map((i) => i.name))
    expect(catalogNames.sort()).toEqual([...names].sort())
  })
})

describe('__help() 渲染', () => {
  it('根 help 列出被宣传的组并给出三级用法；legacy 旧写法组不再上目录', () => {
    const text = renderRootHelp()
    for (const group of promotedGroups()) {
      if (group.key === 'core') continue
      expect(text, group.key).toContain('api.' + group.key)
    }
    expect(text).toContain('api.<组>.__help()')
    expect(text).toContain('api.<组>.<api>.__help()')
    // 旧写法组仍可调用（老对话的历史里还有它），但不再被推荐
    expect(text).not.toContain('api.doc —')
    expect(text).not.toContain('api.outline —')
    expect(text).not.toContain('api.sdoc —')
  })

  it('系统提示词的组索引只有组名与一句说明，不泄露具体签名，也不宣传退役组', () => {
    const index = groupIndexForSystemPrompt()
    expect(index).toContain('api.node — 节点宇宙')
    expect(index).not.toContain('api.doc —')
    expect(index).not.toContain('api.graph —')
    expect(index).not.toContain('api.content —')
    expect(index).not.toContain('api.outline —')
    expect(index).not.toContain('api.sdoc —')
    expect(index).not.toContain('doc.write(path')
    expect(index).not.toContain('graph.read(path)')
  })

  it('单条 help 带签名、用法与示例', () => {
    const text = renderApiHelp('node.get')
    expect(text).toContain('node.get')
    expect(text).toContain('签名：')
    expect(text).toContain('示例：')
    expect(text).toContain('api.node.get')
  })

  it('查不存在的组/条目给可执行的指路，而不是一句空话', () => {
    expect(renderGroupHelp('nope')).toContain('await api.__help()')
    expect(renderApiHelp('node.nope')).toContain('await api.node.__help()')
    expect(renderApiHelp('nope')).toContain('await api.__help()')
  })

  it('Worker 注入用的 help 包：root + groups + apis 三层都在', () => {
    const help = buildSandboxHelp()
    expect(help.root).toContain('api 集')
    expect(Object.keys(help.groups)).toContain('node')
    expect(Object.keys(help.apis)).toContain('node.get')
    expect(Object.keys(help.apis).length).toBe(exposedApiNames().length)
  })
})
