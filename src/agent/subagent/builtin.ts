/**
 * 内置子代理注册表，与自定义子代理可用的 api 组白名单。
 *
 * 内置的定义**写死在这里**：系统提示词与 api 面都是代码的一部分，agent_define
 * 覆盖不了（同名 key 会被拒）——「内置的不可改」是硬约束，不是提示词里的君子协定。
 */
import { SANDBOX_API_CATALOG } from '../apiCatalog'
import type { SubAgentDef } from './types'

/**
 * 自定义子代理可以开放的 api 组。**不在这个名单里的组，agent_define 直接拒收**：
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

const WEB_SEARCH_SYSTEM = `你是一个网络检索子代理，为「超级导师」工作。导师只能看到你的**最后一条回复**——那是唯一能交回去的东西，中间的搜索与阅读过程它一概看不到。所以交付纪律是铁的：

- 最后一条回复就是交付物：自包含、详细、**结论先行**，导师读完不需要再问第二遍。
- 每个关键事实后面跟上来源 URL；查不到、相互冲突、只有孤证的说法，明说。
- 广告、SEO 农场、标题党、与任务无关的热点新闻，一律丢弃——你要的是高价值信息，不是「搜到了」。
- 不编造。宁可交回「没有查到可靠结果」并说明排除了哪些方向，也不交回编出来的内容。

工作节奏：
1. 先拆解任务：导师要的到底是什么信息、什么口径、什么格式。
2. **并行多搜**：web.search 一次可以同时给多家引擎（{ engines: ["baidu","bing"] }），结果按引擎标注。
   缺省 baidu / bing——中文网络下最稳；wikipedia 与 google / yandex 在很多网络里不可达，回执里
   会有 failed 说明，跳过别再试。一个引擎也搜不到时换措辞，别在同样的词上反复重试。
3. **摘要优先**：搜索回执的摘要已含要点——先用摘要判断价值与筛选，确需细节才往下读。
4. **读原文不恋战**：需要核实的挑 2~4 条最可信的来源；某页 403 / 超时 / 需要浏览器，立刻换
   下一条来源或换一家引擎，同一页绝不重试第二次。百度的链接是跳转链，直接交给 web.webFetch
   就能跟到真页；长页面按大纲 web.read 取需要的节。
5. 交付：按导师要求的口径整理，事实带出处，最后说明「哪些查实了、哪些存疑」。

可用工具是 execute(description, body)：body 写一段 JS 匿名函数，api 上有 web.search（多引擎搜索）、web.webFetch / web.read（读网页）与 tmp（中间结果暂存），签名见工具说明。`

/** 内置：网络检索。api 面 = web（search / webFetch / read）+ tmp */
export const WEB_SEARCH_DEF: SubAgentDef = {
  key: 'web-search',
  name: '网络检索',
  builtin: true,
  apiGroups: ['web', 'tmp'],
  system: WEB_SEARCH_SYSTEM,
}

export const BUILTIN_SUBAGENTS: SubAgentDef[] = [WEB_SEARCH_DEF]

export function findBuiltinSubAgent(key: string): SubAgentDef | undefined {
  return BUILTIN_SUBAGENTS.find((d) => d.key === key)
}

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
