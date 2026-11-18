/**
 * calculatorEngine: 悬浮计算器核心运算与状态逻辑。
 *
 * 覆盖三种计算模式：
 * 1. 标准模式（Standard）：基础算术运算（+ - × ÷）、百分比、倒数、平方与平方根；
 * 2. 科学模式（Scientific）：三角函数（弧度/角度制）、指数对数、幂次、阶乘、常数 π 与 e、括号优先级；
 * 3. 程序员模式（Programmer）：多进制转换（HEX/DEC/OCT/BIN 同步显示与输入限制）、位运算（AND/OR/XOR/NOT/LSH/RSH/MOD）与位宽限制。
 */

export type ProgrammerBase = 'HEX' | 'DEC' | 'OCT' | 'BIN'
export type WordSize = 64 | 32 | 16 | 8

export interface BaseRepresentations {
  hex: string
  dec: string
  oct: string
  bin: string
}

export function formatBin(val: bigint, bits: number = 64): string {
  const mask = bits === 64 ? ~0n : (1n << BigInt(bits)) - 1n
  const unsigned = BigInt.asUintN(bits, val & mask)
  let binStr = unsigned.toString(2)
  // 补齐 4 位一组
  const padLen = Math.ceil(binStr.length / 4) * 4
  binStr = binStr.padStart(Math.min(padLen, bits), '0')
  return binStr.replace(/(.{4})/g, '$1 ').trim() || '0'
}

export function formatOct(val: bigint, bits: number = 64): string {
  const unsigned = BigInt.asUintN(bits, val)
  return unsigned.toString(8)
}

export function formatHex(val: bigint, bits: number = 64): string {
  const unsigned = BigInt.asUintN(bits, val)
  return unsigned.toString(16).toUpperCase()
}

export function formatDec(val: bigint, bits: number = 64): string {
  const signed = BigInt.asIntN(bits, val)
  return signed.toString(10)
}

export function getBaseValues(val: bigint, bits: number = 64): BaseRepresentations {
  return {
    hex: formatHex(val, bits),
    dec: formatDec(val, bits),
    oct: formatOct(val, bits),
    bin: formatBin(val, bits),
  }
}

/** 阶乘计算 */
export function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN
  if (n > 170) return Infinity
  let res = 1
  for (let i = 2; i <= n; i++) res *= i
  return res
}

/** 安全格式化显示数值 */
export function formatNumberOutput(num: number): string {
  if (Number.isNaN(num)) return 'Error'
  if (!Number.isFinite(num)) return num > 0 ? 'Infinity' : '-Infinity'
  // 消除浮点数精度误差，如 0.1 + 0.2 = 0.30000000000000004
  const fixed = Number(num.toPrecision(12))
  const str = String(fixed)
  return str
}
