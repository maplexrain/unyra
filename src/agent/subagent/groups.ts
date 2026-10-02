/**
 * 自定义子代理可用的 api 组白名单，与按组生成的 execute 参数说明。
 *
 * 子代理没有内置的：要用就先 agent_spawn 定义——系统提示词与 api 面都由导师写在
 * 定义里，本文件只守「哪些 api 组**允许**被开放」这条边界。
 */
import { SANDBOX_API_CATALOG } from '../apiCatalog'

/**
 * 自定义子代理可以开放的 api 组。**不在这个名单里的组，agent_spawn 直接拒收**：
 * - ask：子代理没有宿主表单通道，调了会永远阻塞；
 * - ui：界面操作是导师与用户之间的事；
 * - exam / checkin / review / pomodoro：学习状态的判断与落账是导师的职责；
 * - userInfo：学习者画像；
 * - compact / wf / code / method / sdoc / state：压缩、登记表、伪编译、持久化函数、
 *   超级文档、学习状态——这些都是「导师」这一层的事，子代理拿了只会越权。
 */
export const SUBAGENT_ALLOWED_GROUPS = [
  'web',
  'tmp',
  'res',
  'doc',
  'node',
  'outline',
  'mind',
  'workspace',
  'reading',
  'attention',
] as const

/**
 * 从 api 目录（apiCatalog，与实现对账的那份）按组生成 execute 参数说明里的 api 清单。
 *
 * 子代理的工具描述只写它真有的 api——按名字的组前缀过滤（reading 那个目录组里
 * 混着 checkin / pomodoro 的条目，它们不是 reading 组，不能混进去）。
 * 目录是单一来源：实现改了目录没改，探针会红；这里照抄目录，清单就不会漂。
 */
export function apiBriefForGroups(groups: string[]): string {
  const allow = new Set(groups)
  const lines: string[] = []
  for (const group of SANDBOX_API_CATALOG) {
    for (const item of group.items) {
      const dot = item.name.indexOf('.')
      const g = dot < 0 ? item.name : item.name.slice(0, dot)
      if (!allow.has(g)) continue
      lines.push(item.name + '(' + item.signature.slice(item.signature.indexOf('(') + 1) + ')：' + item.summary)
    }
  }
  return lines.join('；\n') + '。'
}
