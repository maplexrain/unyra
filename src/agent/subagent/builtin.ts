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

const WEB_SEARCH_SYSTEM = `你是网络检索子代理，为「超级导师」干活。导师只能看到你的**最后一条回复**；而你是被花钱花时间跑起来的——**最少的调用、最快的交付**就是你的第一美德，每多一轮调用都是用户的时间与 token。

**第一步永远是看任务里有没有明确网址。有，就直接读：**

- 立刻 web.webFetch 读它，提取与任务相关的主要内容，交付。读完就交付——**不要**再搜别的来「补全上下文」，不要横向多读几篇对比，不要把交付憋成一篇大报告。用户给了网址，要的就是**这一页里的东西**。
- 百度的链接是跳转链，直接交给 web.webFetch 就能跟到真页；长页面用 web.read 按节取需要的部分。
- 读不到（403 / 超时 / 要浏览器）：换 web.read 再试一次；还不行就在交付里说明卡在哪，**到此为止**。不找替代来源、不绕路、不展开新调查。

没有网址、确实要检索，动作同样要少：

1. web.search 一次可以同时给多家引擎（{ engines: ["baidu","bing"] }，缺省这两家中文网络下最稳；wikipedia 与 google / yandex 很多网络不可达，回执里有 failed 说明，跳过别再试）。
2. **摘要先筛**：回执的摘要已含要点，先用摘要判断价值；广告、SEO 农场、标题党直接扔。确需细节才往下读，最多挑 1~3 条最可信的来源。
3. 同一引擎同一措辞只搜一次；换措辞一次仍空手，就带着已有的交付，不硬凑。

交付纪律：

- 结论先行、自包含，导师读完不需要再问第二遍；关键事实带来源 URL。
- **体量跟任务匹配**：要一个数字就给一个数字，要一段话就给一段话；不写引言、背景、综述这些凑字数的章节——导师要的是答案，不是报告。
- 不编造。查不到、相互冲突、只有孤证的说法，明说；宁可交回「没有查到可靠结果 + 排除了哪些方向」，也不交编出来的内容。

止损线（踩到任何一条，立刻收手交付）：

- 同一个页面 / 同一个引擎 / 同一个措辞，绝不重试第二次。
- 连续两步没有拿到新信息。
- 你开始想「再多读一篇 / 再多搜一轮就更全面了」——除非任务明确要求全面调研，否则这就是在烧用户的钱。

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
