/** 这个文件负责什么：后缀 / 类型 / mime 的推导与展示名——文件名进来、可编辑与否出去。 */

import type { ResourceType, StaticResource } from './types'

/* ---------- 后缀 / 类型 / mime ---------- */

/** 认作文本的后缀。判错的代价是「能编辑」变成「不能编辑」，因此这里取常见的那些 */
const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'text', 'json', 'jsonc', 'csv', 'tsv', 'yaml', 'yml',
  'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py',
  'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat',
  'ps1', 'sql', 'log', 'tex', 'ini', 'toml', 'conf', 'env', 'srt', 'vtt',
])

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  xml: 'text/xml',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
}

/** 从文件名取后缀：小写、不含点；没有后缀返回空串 */
export function extOf(fileName: string): string {
  const base = fileName.trim().replace(/[\\/]+/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  // 前导点的隐藏文件（.gitignore）不算「后缀是 gitignore」
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 文件名去后缀（展示名）；粘贴/拖拽来的可能没有名字 */
export function baseNameOf(fileName: string): string {
  const base = fileName.trim().replace(/[\\/]+/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const name = dot > 0 ? base.slice(0, dot) : base
  return name.trim()
}

export const typeOfExt = (ext: string): ResourceType => (TEXT_EXTS.has(ext) ? 'text' : 'binary')

export const mimeOfExt = (ext: string): string =>
  EXT_MIME[ext] ?? (typeOfExt(ext) === 'text' ? 'text/plain' : 'application/octet-stream')

/** 图片类资源：文档里能内联渲染、能挂给模型看的就是这一类 */
export const isImageExt = (ext: string): boolean => mimeOfExt(ext).startsWith('image/')

/** 清单里的展示名 + 后缀，如 \`题图.png\` */
export function fileNameOf(res: StaticResource): string {
  return res.ext ? res.name + '.' + res.ext : res.name
}

/** 短 id：清单列表里用它区分同名资源（完整 uuid 太长，读不动） */
export const shortUuid = (uuid: string): string => uuid.slice(0, 8)
