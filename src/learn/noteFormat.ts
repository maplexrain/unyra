/**
 * 笔记源码类型定义与默认偏好管理：
 * - markdown: Markdown 语法（富文本、公式、图表）
 * - text: 普通文本（纯文本、不解析标记）
 * - html: HTML（网页标记、富交互）
 * - typst: Typst（现代科学排版与数学公式）
 */

export type NoteFormat = 'markdown' | 'text' | 'html' | 'typst'

export const NOTE_FORMATS: readonly NoteFormat[] = ['markdown', 'text', 'html', 'typst'] as const

export const NOTE_FORMAT_META: Record<
  NoteFormat,
  { label: string; badge: string; desc: string; ext: string }
> = {
  markdown: {
    label: 'Markdown',
    badge: 'MD',
    desc: '富文本标记、LaTeX公式与图表',
    ext: '.md',
  },
  text: {
    label: '普通文本',
    badge: 'TXT',
    desc: '纯文本无格式、保留原有空格与换行',
    ext: '.txt',
  },
  html: {
    label: 'HTML',
    badge: 'HTML',
    desc: '网页标记语言、交互式组件',
    ext: '.html',
  },
  typst: {
    label: 'Typst',
    badge: 'TYP',
    desc: '现代科学排版系统与高精度学术公式',
    ext: '.typ',
  },
}

const STORAGE_KEY = 'moji:default-note-format'

/** 读取用户设定的新建笔记默认格式；缺省为 markdown */
export function getDefaultNoteFormat(): NoteFormat {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(STORAGE_KEY)
      if (v === 'text' || v === 'html' || v === 'typst' || v === 'markdown') return v
    }
  } catch {}
  return 'markdown'
}

/** 保存用户设定的新建笔记默认格式 */
export function setDefaultNoteFormat(fmt: NoteFormat): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, fmt)
    }
  } catch {}
}

/** 容错归一化笔记格式 */
export function normalizeNoteFormat(v: unknown): NoteFormat {
  if (typeof v === 'string') {
    const lower = v.toLowerCase().trim()
    if (lower === 'text' || lower === 'plain' || lower === 'txt') return 'text'
    if (lower === 'html' || lower === 'htm') return 'html'
    if (lower === 'typst' || lower === 'typ') return 'typst'
    if (lower === 'markdown' || lower === 'md') return 'markdown'
  }
  return 'markdown'
}
