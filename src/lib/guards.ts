/**
 * 「这是不是一个对象」——解析外部 JSON 时的第一道守卫。
 *
 * 单独一份：Anthropic / CommandCode / Responses 三家协议与 lib/tmpStore 各抄了一遍，
 * 四份逐字相同。它们面对的都是**外面来的** JSON（网关回帧、磁盘上的旧文件），
 * 每个字段下手前都得先问这一句，判断的口径必须一致——排掉 null 与数组，
 * 只留真正的键值对象。
 */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
