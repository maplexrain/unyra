/**
 * aiqa 围栏：解析教学文档中的 ```aiqa 代码块为随文 AI 考察与问答组件。
 *
 * 语法示例：
 * ```aiqa
 * - system: 你是一个经验丰富的计算机体系结构老师，你需要在这里考察学生对于虚拟内存和分页机制的理解，可以依次询问虚拟地址转换、TLB 命中率与缺页中断，考察范围仅限内存管理核心概念。
 * - question: 请你简单叙述一下从虚拟地址到物理地址的转换过程是怎样的？
 * ```
 */

export { AIQA_LANG, aiqaBlock } from './aiqaBlock/render'
export { hydrateAiqa } from './aiqaBlock/hydrate'
export {
  setAiqaBlockHost,
  aiqaBlockHost,
  subscribeAiqaBlockHost,
} from './aiqaBlock/host'
export { parseAiqaBlock } from './aiqaBlock/parse'
export { AIQA_SYNTAX_GUIDE } from './aiqaBlock/guide'
export { streamAiqaAnswer } from './aiqaBlock/agent'
export type {
  AiqaChatMessage,
  AiqaChatSession,
  AiqaBlockHost,
  ParsedAiqaBlock,
} from './aiqaBlock/types'
