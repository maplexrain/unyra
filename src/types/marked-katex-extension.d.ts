// 该包的 package.json 将未编译的 src/index.ts 直接作为类型入口，
// 会被本项目的 noUnusedLocals 检查报错，这里用声明文件替代其类型。
import type { KatexOptions } from 'katex'
import type { MarkedExtension } from 'marked'

export interface MarkedKatexOptions extends KatexOptions {
  nonStandard?: boolean
}

declare function markedKatex(options?: MarkedKatexOptions): MarkedExtension

export default markedKatex
