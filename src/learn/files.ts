/**
 * 教学文档在磁盘上的组织形式（v3：一个节点一个文件）。
 *
 * ```
 * {root}/users/{uid}/docs/
 *   {目标}/{目标}.node.json       根节点：正文 / 大纲 / 笔记 / 试卷 / 超级文档 + 目标本身（goal 字段）
 *   {目标}/chat.json              **目标的**对话（上下文是目标级的，不按节点分）
 *   {目标}/tmp.json               根节点的临时变量（Agent 的中间数据，可缺省）
 *   {目标}/reading.json / mind.json / method.json / workflow.json / structure.json
 *   {目标}/static/                目标级资源库（含 manifest.json）
 *   {目标}/{子节点}/{子节点}.node.json
 *   {目标}/{子节点}/workspace/    这个节点的真实文件（代码、数据），随节点目录走
 *   {目标}/{子节点}/tmp.json      临时变量（可缺省）
 *   {目标}/{子节点}/{孙节点}/…     再往下同理
 * ```
 *
 * 几个决定：
 * - **一个节点一个文件**：正文、大纲、笔记、试卷、超级文档全部装进 `{节点}.node.json` 的
 *   parts 数组。旧布局是「一种内容一个落点」（.md / .meta.json / .outline.json /
 *   .notes/ / superdocs/ / exams/），每加一种挂件就要多设计一套目录与命名规则，
 *   而且试卷与超级文档是双写的。合并之后加一种挂件只是 parts 里多一条。
 * - **文件名带 .node.json 后缀**：目标目录里已经有 chat.json / reading.json /
 *   structure.json 这些账本文件，一个叫「chat」的目标会与 chat.json 撞车；
 *   后缀把节点文件与账本彻底分开，也让「这是节点」一眼可辨。
 * - **目录名就是标题**：数据目录自己就是一份能看懂的大纲。重名、非法字符、
 *   Windows 保留名都在 sanitizeSegment / allocate 里兜住。改标题 = 目录改名。
 * - **目录树是「展示顺序」，图结构仍以节点文件里的 dependencies 为准**：节点可以有
 *   多个父节点（DAG），目录里只能待在一个地方，因此取从根出发的最短路径那条。
 * - **tmp.json 不并进节点文件**：它是随时可丢的草稿，塞进去只会让每次保存重写一大坨无关数据。
 *
 * 旧布局（v2）仍然读得回来（见 files/parse 的 parseDocsV2），那是迁移失败时的降落伞；
 * 写盘只写 v3。
 */

/* 取名的规则住在 learn/segments（节点目录、节点文档、笔记文件共用同一套）。
   这里 re-export 一次，本模块内部与老引用都不必改。 */
export { sanitizeSegment } from './segments'

/**
 * 本文件是 barrel：实现按职责拆在 learn/layout.ts 与 learn/files/ 下，
 * 这里只把原来的导出原样转出去，调用方的 import 一行都不用改。
 *
 * - layout.ts       磁盘布局：目录常量与 nodeLayout（files 与 static 的共同下游，环断在这里）
 * - files/names.ts  文件名规则：教学文档、笔记文件、老布局的笔记后缀
 * - files/meta.ts   meta.json 的形状与落盘 JSON 的小工具
 * - files/build.ts  内存 → 磁盘：buildDocs 与 nodeDocPath
 * - files/parse.ts  磁盘 → 内存：parseDocs 与笔记读回
 * - files/state.ts  state.json：LearnState 与 buildState
 * - files/diff.ts   差异：diffDocs 与 assetMoves
 */

export {
  ASSET_DIRS,
  DOCS_DIR,
  IMAGES_DIR,
  MANIFEST_FILE,
  NOTES_SUFFIX,
  STATIC_DIR,
  nodeLayout,
} from './layout'
export type { NodeLayout } from './layout'

export { docFileName, noteFileName } from './files/names'

export { buildDocs, buildDocsChunked, nodeDocPath } from './files/build'

export { NODE_FILE_SUFFIX, NODE_FILE_VERSION, partsOfNode, contentOfParts } from './files/nodeFile'
export type { NodeFile, NodePart, NodeContent } from './files/nodeFile'

export { parseDocs, parseDocsV2, parseDocsV3 } from './files/parse'

export { buildState } from './files/state'
export type { LearnState } from './files/state'

export { assetMoves, diffDocs } from './files/diff'
export type { DocsDiff } from './files/diff'
