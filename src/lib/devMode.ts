/**
 * 开发者模式：设置窗口里的一处隐藏入口。
 *
 * 三击设置窗口左上角的「设置」二字，才会多出一个「开发者」分页；该分页要口令解锁，
 * 解锁状态记在 localStorage 里——下次打开设置直接就有这一页，不必再连点三次。
 *
 * 口令**不以明文出现在任何地方**：
 * - 代码里只放它的 SHA-256 摘要，校验时把用户输入同样折成摘要再比对，比的是摘要；
 * - localStorage 里存的也是这个摘要（解锁凭据），不是口令本身。
 *
 * 这是一道「防误触、防随手点开」的门，不是密码学意义上的安全边界：能读到本机这份
 * 代码的人也能读到摘要。真要防住谁，得把校验挪进主进程并配合系统密钥链。
 */

/** 解锁凭据在 localStorage 里的键：值为口令摘要 */
const UNLOCK_KEY = 'moji:dev:unlock'

/**
 * 口令的 SHA-256 摘要（十六进制）。明文不入代码、不入库——
 * 这里只留一个不可逆的摘要，改口令就是换这一行。
 */
const DEV_PASSWORD_HASH = '81520fb634e043a2d2f458b66b7d306259565a2aa33d678f2d0ee791fcf4fd8e'

/* ---------- SHA-256 ---------- */

/** 循环右移；JS 的位运算是 32 位有符号，全程用 >>> 0 归一到无符号 */
const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0

/** 轮常量：前 64 个素数立方根小数部分的前 32 位（FIPS 180-4） */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/**
 * 字符串的 SHA-256 摘要（小写十六进制）。
 *
 * 自带实现而不是用 crypto.subtle：后者是异步的、且要求安全上下文，
 * 一个「按一下就要出结果」的本地校验没必要背这两个条件；
 * 纯函数也便于在 Node 里直接跑测试对答案。
 */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input)
  const bitLen = data.length * 8

  // 补位：先补一个 1 比特，再补 0 到 56 (mod 64)，最后 8 字节大端写入比特长度
  const padded = new Uint8Array((((data.length + 8) >> 6) << 6) + 64)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(padded.length - 4, bitLen >>> 0, false)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0

      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  let out = ''
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, '0')
  return out
}

/* ---------- 解锁状态 ---------- */

/**
 * localStorage 读写都包一层 try：隐私模式、配额满、被策略禁用时它会抛异常，
 * 而「记不住解锁状态」最多是每次多点一次，不该把设置面板带崩。
 */
function readStored(): string | null {
  try {
    return localStorage.getItem(UNLOCK_KEY)
  } catch {
    return null
  }
}

function writeStored(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(UNLOCK_KEY)
    else localStorage.setItem(UNLOCK_KEY, value)
  } catch {
    // 存不下就算了，本次会话内仍然算解锁（见 unlockDevMode 的返回值）
  }
}

/**
 * 是否已解锁：读 localStorage 里存的凭据与摘要比对。
 * 同步读，因此可以直接用于渲染期的条件判断。
 */
export function isDevUnlocked(): boolean {
  return readStored() === DEV_PASSWORD_HASH
}

/**
 * 用口令换解锁：把输入折成摘要与预期比对，对了就把摘要写进 localStorage。
 * 返回是否通过——调用方据此给出「口令不正确」的提示。
 */
export function unlockDevMode(input: string): boolean {
  if (sha256Hex(input) !== DEV_PASSWORD_HASH) return false
  writeStored(DEV_PASSWORD_HASH)
  return true
}
