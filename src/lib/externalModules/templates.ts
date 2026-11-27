/**
 * 外部组件的默认 TSX 模板。
 *
 * 新建组件时先把模板写到 `doc-design/<kind>--<id>.tsx`，用户/模型再改文件；
 * 模板本身是可运行的合法模块，保存后立即可热更新。所有字符串都用 JSON.stringify
 * 转义，避免 tag / 名称里的引号把源码打断。
 *
 * 组件类是真正的 React 组件：`export default { ..., component: (props) => <...> }`。
 * 渲染层用 Sucrase 把 TSX 动态编译成 `jsx/jsxs` 调用，再交给 React 渲染。
 * 模板只生成 JSX component，不再生成 `template` 字符串，也不接受旧式模板参数。
 */
import type { DocumentComponentDef } from '../componentBlock/registry'
import type { ExternalModuleKind } from './types'

const q = (value: unknown): string => JSON.stringify(value ?? '')

/** 多行示例用模板字符串落盘，避免生成文件里出现一长串 `\n` 转义 */
const multiline = (value: string): string =>
  '`' + value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`'

/** JSON 块在对象里缩进一层，生成的文件更好读 */
const indentBlock = (value: unknown, spaces = 2): string =>
  JSON.stringify(value ?? null, null, 2).replace(/\n/g, `\n${' '.repeat(spaces)}`)

/**
 * 新建外部模块时生成唯一 seed：时间戳 + 随机尾，既能直接当 id / 文件名，
 * 也避免连点几次「新建」互相覆盖。前缀只留字母数字与短横线。
 */
export function externalModuleSeed(prefix = 'new'): string {
  const safePrefix = prefix.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-') || 'new'
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${safePrefix}-${stamp}-${rand}`
}

/** 安全文件名：只留字母数字与 _-，避免路径穿越；同一类加前缀防重名 */
export function externalModuleFileName(kind: ExternalModuleKind, id: string): string {
  const safe = (id || 'component')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60) || 'component'
  const prefix =
    kind === 'doc-component'
      ? 'doc-component'
      : kind === 'classroom-component'
        ? 'classroom-component'
        : kind === 'classroom-animation'
          ? 'classroom-animation'
          : 'classroom-sound'
  return `${prefix}--${safe}.tsx`
}

function header(kind: ExternalModuleKind): string {
  return `/**
 * 归一 Unyra 外部组件 · ${kind}
 *
 * 放在用户目录 users/<uid>/doc-design/ 下，应用运行时会动态加载；保存本文件后约 2 秒内热更新。
 * 只改这个文件即可，不需要重新打包应用。文件统一为 .tsx，按 React 组件动态编译。
 *
 * 约定：export default { kind: '${kind}', ... }
 * 保存失败时看设置 → 设计 里的错误提示，或开发者控制台。
 */`
}

/** 文档排版组件：生成一个纯 JSX 的 React 组件。 */
export function docComponentTemplate(def: {
  id: string
  tag: string
  name: string
  description: string
  category?: string
  slots?: DocumentComponentDef['slots']
  attrs?: DocumentComponentDef['attrs']
  example?: string
}): string {
  const example =
    def.example?.trim() ||
    `<${def.tag}>\n  <div #title>${def.name}</div>\n  <div #describe>把这里换成组件要展示的内容。</div>\n</${def.tag}>`
  const slots = def.slots ?? [
    { name: 'title', description: '组件标题' },
    { name: 'describe', description: '组件正文（支持内联 Markdown）' },
  ]

  return `${header('doc-component')}

export default {
  kind: 'doc-component',
  id: ${q(def.id)},
  tag: ${q(def.tag)},
  name: ${q(def.name)},
  description: ${q(def.description)},
  category: ${q(def.category || 'custom')},
  slots: ${indentBlock(slots)},
  attrs: ${indentBlock(def.attrs ?? [])},
  // example 是文档里的使用示例（DSL 字符串）；组件结构见下面的 component。
  example: ${multiline(example)},

  // React 组件：结构直接用 JSX 写，slots 是围栏内已渲染好的 HTML。
  component: ({ slots = {}, attrs = {} }) => {
    const title = slots.title ?? attrs.title ?? ${q(def.name)}
    const describe = slots.describe ?? attrs.describe ?? ''
    return (
      <div
        style={{
          margin: '20px 0',
          border: '1px solid #d9d3c6',
          borderRadius: 12,
          background: '#fffdf8',
          padding: '18px 20px',
          color: '#2e2a25',
        }}
      >
        <div style={{ font: '600 11px/1.4 ui-monospace, monospace', letterSpacing: '.16em', color: '#9c9284' }}>
          CUSTOM
        </div>
        <div style={{ marginTop: 4, fontSize: 17, fontWeight: 600 }}>{title}</div>
        <div
          style={{ marginTop: 8, fontSize: 14, lineHeight: 1.75 }}
          dangerouslySetInnerHTML={{ __html: describe }}
        />
      </div>
    )
  },
}
`
}

/** 课堂组件：生成一个接收 content / attrs / props 的 React 组件。 */
export function classroomComponentTemplate(def: {
  tag: string
  name: string
  description: string
  category?: string
  defaultProps?: Record<string, string>
  example?: string
}): string {
  const example =
    def.example?.trim() ||
    `<${def.tag} title="${def.name}">把这里换成课堂画面内容。</${def.tag}>`
  const defaultProps = def.defaultProps ?? { title: def.name }

  return `${header('classroom-component')}

export default {
  kind: 'classroom-component',
  tag: ${q(def.tag)},
  name: ${q(def.name)},
  description: ${q(def.description)},
  category: ${q(def.category || 'visual')},
  defaultProps: ${indentBlock(defaultProps)},
  // example 是课堂 DSL 的使用示例；组件结构见下面的 component。
  example: ${multiline(example)},

  // React 组件：结构直接用 JSX 写；content 是标签内的 HTML。
  component: ({ content = '', props = {}, attrs = {} }) => {
    const merged = { ...${JSON.stringify(defaultProps)}, ...props, ...attrs }
    return (
      <div
        style={{
          border: '1px solid #37506a',
          borderRadius: 16,
          background: 'rgba(24,35,49,.78)',
          padding: '20px 24px',
          color: '#e2e8f0',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '.08em', color: '#8fb8d8' }}>CUSTOM CLASSROOM</div>
        <h3 style={{ margin: '6px 0 8px', fontSize: 22 }}>{merged.title ?? ${q(def.name)}}</h3>
        <div style={{ fontSize: 15, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    )
  },
}
`
}

/** 课堂动效：keyframes 直接交给 Anime.js */
export function classroomAnimationTemplate(def: {
  verb: string
  name: string
  description: string
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  recommendedSfx?: string
  example?: string
}): string {
  const keyframes = def.keyframes ?? { scale: [0.85, 1], opacity: [0, 1] }
  return `${header('classroom-animation')}

export default {
  kind: 'classroom-animation',
  verb: ${q(def.verb)},
  name: ${q(def.name)},
  description: ${q(def.description)},
  duration: ${Number(def.duration) || 600},
  easing: ${q(def.easing || 'easeOutCubic')},
  recommendedSfx: ${q(def.recommendedSfx || '')},
  example: ${multiline(def.example || `<div class="${def.verb}">点「播放」预览这个动效</div>`)},
  // 直接写 Anime.js 的 keyframes：数值数组 = 起止关键帧
  keyframes: ${indentBlock(keyframes)},
}
`
}

/** 课堂音效：play(v, kit) 里用 kit.tone / kit.noise 合成，避免依赖应用内部实现 */
export function classroomSoundTemplate(def: {
  name: string
  label: string
  description: string
  category?: string
  mood?: string
  use?: string
  defaultDuration?: number
  recommended?: boolean
}): string {
  return `${header('classroom-sound')}

export default {
  kind: 'classroom-sound',
  name: ${q(def.name)},
  label: ${q(def.label)},
  description: ${q(def.description)},
  category: ${q(def.category || 'feedback')},
  mood: ${q(def.mood || '干净')},
  use: ${q(def.use || '按钮点击 / 正确反馈')},
  recommended: ${def.recommended ? 'true' : 'false'},
  defaultDuration: ${Number(def.defaultDuration) || 420},

  /**
   * v 是引擎给的声音参数（ctx / dry / wet / t / vol / dur / onStop），
   * kit.tone({ f, d, peak, type, at, f2, wet }) 与 kit.noise({ filter, f, d, peak, at, f2, wet })
   * 已绑定当前声部，直接调用即可；也可以直接操作 v.ctx 写任意 WebAudio。
   */
  play(v, kit) {
    kit.tone({ f: 660, d: 0.18, peak: 0.12, type: 'sine', f2: 880 })
    kit.tone({ f: 990, d: 0.12, peak: 0.08, type: 'triangle', at: 0.16 })
  },
}
`
}
