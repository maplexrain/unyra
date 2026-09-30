/** 这个文件负责什么：节点落盘时的文件名规则——教学文档、笔记文件与老布局的笔记后缀。 */

import { NOTES_SUFFIX } from '../layout'
import { sanitizeSegment } from '../segments'

/** 老布局里笔记文档的后缀（`{节点}.笔记.md`）。只用于**读回**旧数据，不再写出 */
export const LEGACY_NOTE_SUFFIX = '.笔记'

/**
 * 教学文档在该目录里的文件名（`{节点}.md`）。
 *
 * 笔记不走它：一个节点有多份笔记，文件名是「目录 + 笔记名」（见 noteFileName）。
 * 这两条路必须分得干净——教学文档是「节点名.md」，笔记是「节点名.notes/笔记名.md」，
 * 后者多一层目录，因此笔记叫什么都不可能盖住教学文档。
 */
export function docFileName(base: string): string {
  return `${base}.md`
}

/**
 * 大纲文件名（`{节点}.outline.json`）。
 *
 * 与教学文档一一配对：创建节点时两份同时生成（见 OutlineDoc 与 graph/nodes 的 addNode）。
 * 它是结构化 JSON 而不是 Markdown——大纲在页签里打开是一个交互页面，不是源码/预览。
 * 用 `.outline.json` 这个后缀而不是塞进 meta.json：它是与教学文档平级的**内容文件**
 * （导师整份写入、交互页整份读），meta 里只该放元数据。
 */
export function outlineFileName(base: string): string {
  return `${base}.outline.json`
}

/**
 * 某一份笔记在该目录下的相对路径：`{节点}.notes/{笔记名}.md`。
 *
 * 名字在这里再 sanitize 一次（内存里的名字本就已经是合法的，这一步是兜底）：
 * 万一有哪条路径漏了规范化，落盘前还会被挡住，不至于写出一个非法文件名。
 */
export function noteFileName(base: string, name: string): string {
  return `${base}${NOTES_SUFFIX}/${sanitizeSegment(name)}.md`
}
