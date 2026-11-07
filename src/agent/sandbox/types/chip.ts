/**
 * 这个文件负责什么：沙箱类型契约的**chip（引用 chip）**组的宿主实现 ChipOps——
 * chip 的生成与校验（见 learn/ops/chip）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- chip：引用 chip 的生成与校验 ---------- */

/**
 * chip.* 的宿主实现（见 learn/ops/chip）。build 把「拼对路径」从模型手里拿走——
 * 当场对 store 解析、生成的 payload 一定带 nodeId，定位不到就 ok:false；
 * check 让模型在交付前把草稿里的 chip 逐颗验一遍。
 */
export interface ChipOps {
  /** { type, path?, url?, note?, name?, examId?, attemptId?, dir?, title? } → { chip, type, title } 或 { ok:false, problem } */
  build: (input: Record<string, unknown>) => unknown
  /** 任意文本 → 逐颗解析其中的 #[{…}] 并验证定位 → { total, valid, invalid, problems? } */
  check: (text: string) => unknown
}

