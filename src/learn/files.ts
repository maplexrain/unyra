/**
 * 教学文档在磁盘上的组织形式。
 *
 * ```
 * {root}/users/{uid}/docs/
 *   {目标}/{目标}.md              根节点的教学文档（这份文档就是「教学目标」本身）
 *   {目标}/{目标}.meta.json       根节点元数据 + 目标本身（goal 字段）
 *   {目标}/{目标}.notes/{笔记名}.md   根节点的笔记（一份笔记一个文件，可有多份）
 *   {目标}/chat.json              **目标的**对话（上下文是目标级的，不按节点分）
 *   {目标}/tmp.json               根节点的临时变量（Agent 的大块中间数据，可缺省）
 *   {目标}/{子节点}/{子节点}.md
 *   {目标}/{子节点}/{子节点}.notes/{笔记名}.md
 *   {目标}/{子节点}/{子节点}.meta.json
 *   {目标}/{子节点}/{孙节点}/…     再往下同理
 * ```
 *
 * 几个决定：
 * - **正文只放 .md，别的都进 .meta.json**。用户能直接打开 .md 读、改、拷走；
 *   掌握度/注解/依赖这些结构化字段不该混进正文里当语法。
 * - **教学文档一份、笔记多份**：`{节点}.md` 是教学文档，`{节点}.notes/{名字}.md` 是笔记。
 *   教学文档一律写出（它是节点的主体，空着也占位）；笔记没内容就不建文件——
 *   绝大多数笔记是从空白开始的，建一个空文件只会让人以为里面有东西。
 *   笔记单独收在一个 `.notes` 目录里（而不是与节点文档并排的 `{节点}.笔记.md`）：
 *   一个节点有几份笔记是用户说了算的，散在目录里会与子节点目录混成一片；收进一个带后缀的
 *   目录，既一眼看得出归属，也不会与叫「`.notes`」的子节点撞名（nodeLayout 里已经把
 *   `{base}.notes` 预先占掉）。老布局的 `{节点}.笔记.md` 仍然读得回来：解析时并成一份名为
 *   「笔记」的笔记，写回时那个老文件由差异比对删掉——这就是一节点多笔记那次改动的数据迁移。
 * - **chat.json 只在目标目录里**：会话的归属单位是目标（一个目标一份上下文），
 *   挂到每个节点目录下就会出现「同一份对话被写好多遍」。读到旧布局（节点目录下的
 *   chat.json）时按节点所属目标并进那一份，写回时旧的会被 diff 删掉。
 * - **目录名就是标题**。学习目标与知识点本来就按标题称呼，用标题当目录名，
 *   数据目录自己就是一份能看懂的大纲。重名、非法字符、Windows 保留名都在
 *   sanitizeSegment / allocate 里兜住。
 * - **目录树是「展示顺序」，图结构仍以 meta 里的 dependencies 为准**。节点可以有
 *   多个父节点（DAG），目录里只能待在一个地方，因此取从根出发的最短路径那条；
 *   其余的父子关系在 dependencies 里一条不少。
 * - 改标题 = 目录改名。保存时逐路径比对，新路径写、旧路径删，不做原地 move
 *   （文本文件很小，这样最不容易写坏）。
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

export { buildDocs, nodeDocPath } from './files/build'

export { parseDocs } from './files/parse'

export { buildState } from './files/state'
export type { LearnState } from './files/state'

export { assetMoves, diffDocs } from './files/diff'
export type { DocsDiff } from './files/diff'
