/**
 * web.search 的宿主实现：多引擎搜索，把 SERP 解析成「标题 + 链接 + 摘要」的列表。
 *
 * 与 webDocs（web.webFetch / web.read）同一条分工：**字节由主进程取**（native().web.fetch，
 * 只读 GET、4MB / 20 秒上限、本机与内网一律拒绝——一条新口子都不开；403/429 会自动
 * 换一套浏览器指纹再试一次，见 electron/web），**解析在渲染层**（lib/web/serp，DOMParser）。
 * 结果不落盘：一条摘要几百字，直接进观察就够了，与 webFetch「长文落盘」是两种体量。
 *
 * 引擎全挂时的缺省策略是**自动降级**（onEngineFail:'fallback'）：用缺省引擎里还没试过的
 * 补搜一轮——不让「task 里没写能不能换引擎」卡死交付（导师实测反馈 2026-10-02）；
 * 'strict' 才原样回报失败。回执带 searchedAt（抓取时刻）：结果里的「2 天前」这类相对
 * 时间按它折算日期；weak 列出「只回标题没摘要」的引擎——那是解析质量差，不是这条没摘要。
 */

import { native } from '../lib/native'
import {
  SEARCH_ENGINES, parseSerp, planFallback, serpUrl, weakEngines,
  type SearchEngine, type SerpResult,
} from '../lib/web/serp'

/** 一次搜索最多回几条：再多观察通道就成了结果堆 */
const RESULTS_MAX = 10
/** 并行引擎数上限：三家的结果拼起来已经够一轮观察消化 */
const ENGINES_MAX = 3

export interface WebSearchOptions {
  engine?: unknown
  /** 多引擎并行：一次调用同时搜几家（≤3），结果按引擎标注，省掉一轮轮的往返 */
  engines?: unknown
  lang?: unknown
  count?: unknown
  /** 引擎全挂后的策略：'fallback'（缺省）自动用缺省引擎补搜一轮；'strict' 原样回报失败 */
  onEngineFail?: unknown
}

type SearchOutcome = { engine: SearchEngine; results: SerpResult[] } | { engine: SearchEngine; error: string }

async function searchOne(engine: SearchEngine, query: string, lang: string | undefined, count: number): Promise<SearchOutcome> {
  const url = serpUrl(engine, query, { ...(lang ? { lang } : {}) })
  let page: Awaited<ReturnType<ReturnType<typeof native>['web']['fetch']>>
  try {
    page = await native().web.fetch(url)
  } catch (err) {
    return { engine, error: '搜索通道不可用：' + (err instanceof Error ? err.message : String(err)) }
  }
  if (!page.ok) return { engine, error: page.error }
  const results = parseSerp(engine, page.text, { ...(lang ? { lang } : {}) }).slice(0, count)
  if (!results.length) {
    return { engine, error: '没有解析出结果（可能是验证码、需要浏览器的页面，或结果页改版了）' }
  }
  return { engine, results }
}

/**
 * api.web.search(query, { engine? | engines?, lang?, count?, onEngineFail? })
 *
 * 引擎解析不出结果（验证码、需要浏览器的页面、改版、网络不可达）不是静默吞掉：
 * 回执里逐引擎写明原因。engines 全挂时缺省自动降级补搜（strict 关掉）；
 * weak 标出「只回标题没摘要」的引擎，searchedAt 给相对时间一个折算锚点。
 */
export async function searchForAgent(rawQuery: string, rawOpts?: WebSearchOptions): Promise<unknown> {
  const query = String(rawQuery ?? '').trim()
  if (!query) {
    return { error: 'web.search 需要搜索词，例如 web.search("梯度下降") 或 web.search("attention", { engines: ["baidu","bing"] })' }
  }
  const opts = rawOpts ?? {}
  const wanted = Array.isArray(opts.engines)
    ? opts.engines.map((x) => String(x).trim().toLowerCase())
    : [String(opts.engine ?? '').trim().toLowerCase()].filter(Boolean)
  const engines = [...new Set(wanted.filter((e) => (SEARCH_ENGINES as string[]).includes(e)))].slice(
    0,
    ENGINES_MAX,
  ) as SearchEngine[]
  const list: SearchEngine[] = engines.length ? engines : ['baidu']
  const lang = typeof opts.lang === 'string' ? opts.lang.trim() : undefined
  const count = Math.min(RESULTS_MAX, Math.max(1, Number(opts.count) || RESULTS_MAX))
  const strict = opts.onEngineFail === 'strict'

  const run = async (targets: SearchEngine[]) => {
    const settled = await Promise.all(targets.map((engine) => searchOne(engine, query, lang, count)))
    return {
      good: settled.filter((r): r is { engine: SearchEngine; results: SerpResult[] } => 'results' in r),
      failed: settled.filter((r): r is { engine: SearchEngine; error: string } => 'error' in r),
    }
  }

  let { good, failed } = await run(list)
  let fallback: SearchEngine[] = []
  if (!good.length && !strict) {
    // 引擎全挂：缺省自动降级——用缺省引擎里还没试过的补一轮
    const retry = planFallback(list)
    if (retry.length) {
      const second = await run(retry)
      fallback = retry
      good = second.good
      failed = [...failed, ...second.failed]
    }
  }
  if (!good.length) {
    return {
      error:
        '全部引擎都没搜到（' + failed.map((f) => f.engine + '：' + f.error).join('；') + '）。' +
        (fallback.length ? '已自动用 ' + fallback.join('、') + ' 补过一轮，仍然全挂。' : '') +
        '可选引擎：' + SEARCH_ENGINES.join(' / ') + '。换措辞或换引擎再试一次；连着失败就别恋战，把已知的部分先交付。',
      query,
    }
  }
  const weak = weakEngines(good)
  const results = good.flatMap((g) => g.results.map((r, i) => ({ rank: i + 1, ...r, engine: g.engine })))
  return {
    ok: true,
    engines: good.map((g) => g.engine),
    query,
    // 抓取时刻：结果里的「2 天前」这类相对时间按它折算成日期再交付
    searchedAt: new Date().toISOString(),
    results,
    ...(failed.length ? { failed: failed.map((f) => ({ engine: f.engine, reason: f.error })) } : {}),
    ...(weak.length ? { weak } : {}),
    ...(fallback.length ? { fallback } : {}),
    note:
      '先用摘要判断价值，确需细节再 webFetch 读原文（结果只有 ' + results.length + ' 条，够挑了）。' +
      'searchedAt 是抓取时刻，结果里的「2 天前」这类相对时间按它折算。' +
      (weak.length
        ? '（' + weak.join('、') + ' 只回了标题与链接、没有摘要——这是解析质量差不是没内容，细节必须 webFetch 核实再用。）'
        : '') +
      (fallback.length ? '（原引擎全挂，已自动用 ' + fallback.join('、') + ' 补搜；原失败记录在 failed。）' : '') +
      (good.some((g) => g.engine === 'baidu') ? '百度的链接常是跳转链，直接交给 web.webFetch 就能跟到真页。' : '') +
      (failed.length ? '（失败的引擎见 failed，别再对它们重试同一次搜索。）' : ''),
  } as unknown
}
