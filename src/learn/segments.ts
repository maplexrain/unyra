/**
 * 文件名 / 目录名的取名规则。
 *
 * 原先住在 learn/files.ts 里。搬出来是因为用它的地方变多了：节点目录、节点文档、
 * 笔记文件（一节点多份笔记，见 learn/notes）都要按同一套规则取名。而 notes、tabs 这些
 * 只认字符串的纯逻辑模块，不该为了一个取名字的函数把 files ↔ store 那条互相 import
 * 的链拖进来（那会读到未初始化的绑定，见 files.ts 顶部关于循环依赖的说明）。
 */

/** 目录名里不能出现的字符（Windows 最严，取它）+ 控制字符 */
// eslint-disable-next-line no-control-regex -- 控制字符正是要挡掉的东西，这里的匹配是有意的
const ILLEGAL_IN_NAME = /[\\/:*?"<>|\u0000-\u001f]/g
/** Windows 上以这些名字命名的文件/目录会被拒绝 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** 目录名长度上限：够表达，又不会把整条路径顶到系统的长度限制 */
export const MAX_SEGMENT = 48

/**
 * 标题（或笔记名）→ 文件名分段。
 *
 * 中文基本原样保留；结尾的点与空格在 Windows 上会被静默吃掉，必须去掉——
 * 否则「写进去的名字」和「读回来的名字」对不上，每次保存都会重写一遍。
 */
export function sanitizeSegment(title: string): string {
  let s = (title || '').trim()
  s = s.replace(ILLEGAL_IN_NAME, '_').replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/, '')
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT).replace(/[. ]+$/, '')
  if (!s) s = '未命名'
  if (WINDOWS_RESERVED.test(s)) s = '_' + s
  return s
}

/**
 * 在同一层里分配一个不重名的名字；重名时按出现顺序加序号。
 *
 * used 里放的是**已经占掉的小写名字**（大小写不敏感：Windows 上 A.md 与 a.md 是同一个文件）。
 * 命中后把最终名字写回 used，调用方因此不必自己再记一次。
 */
export function allocate(title: string, used: Set<string>): string {
  const base = sanitizeSegment(title)
  let name = base
  for (let i = 2; used.has(name.toLowerCase()); i++) name = base + ' (' + i + ')'
  used.add(name.toLowerCase())
  return name
}
