/**
 * 这个文件负责什么：沙箱的几个体量上限——一次编排跑多久、回给模型的结果多长、最多记多少笔 api 调用。
 *
 * 为什么单独成一个文件（而不是随手放进 execute 或 api）：这两个文件互相都要用这几个数——
 * api 记账要 MAX_LOGGED_CALLS 与 MAX_RESULT_CHARS，execute 要常量、又要 buildApi——
 * 常量放在任意一边都会绕出一个循环 import。数字本身与谁用它无关，单独立在这里最干净。
 */

/** 沙箱一次最多跑多久；到点就 terminate，界面不会跟着卡 */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 15_000

/** 返回给模型的结果上限：够用即可，别把上下文顶爆 */
export const MAX_RESULT_CHARS = 32_000

/** 一次编排里最多记录多少个 api 调用（只影响展示，不影响执行） */
export const MAX_LOGGED_CALLS = 40
