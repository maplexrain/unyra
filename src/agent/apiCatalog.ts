/**
 * execute 沙箱的 api 目录：**从 apiRegistry 派生**，不再手工维护第二份名单。
 *
 * 这是「execute 工具 api 上下文管理」页（超级导师设置 → 开发者）的数据源，
 * 也是 work 的 apiBrief（work/groups）的来源。注册表是唯一入口：
 * 签名、用法、示例都在 `sandbox/apiRegistry.ts` 里，这里只做一次投影。
 */
import { catalogGroups } from './sandbox/apiRegistry'

export interface ApiEntry {
  name: string
  signature: string
  summary: string
}

export interface ApiGroup {
  key: string
  label: string
  intro: string
  items: ApiEntry[]
}

/** 设置页与 work brief 共用的目录视图（与 Worker 名单同源，探针对账） */
export const SANDBOX_API_CATALOG: ApiGroup[] = catalogGroups().map((group) => ({
  key: group.key,
  label: group.label,
  intro: group.intro,
  items: group.items,
}))
