/**
 * 课堂 course 的静态校验与体检（不渲染画面）。
 *
 * 2026-11-18 之前 editContent 对 course 只查「是对象」就原样存盘：未知 verb、悬空
 * target、自造的 beats 字段全部静默入库，画面全静还无从查起——「交付约定不可见 +
 * 写入不校验」叠加出的最坏失败形态。这里的回执即人话：errors 拒绝保存（editContent
 * 用），warnings 随 ok 回执带出（note），classroom.check() 也用它做整卷体检。
 */
import { VISUAL_VERB_WHITELIST } from './verbs'

export interface CourseAudit {
  errors: string[]
  warnings: string[]
  stats: { scenes: number; actions: number; speaks: number; visuals: number }
}

const COURSE_FIELDS = new Set(['courseId', 'title', 'description', 'scenes'])

/** 能唤醒 data-hidden 的动词（与 sanitizer 的唤醒口径一致） */
const WAKING_VERBS = new Set([
  'appear',
  'drawSvg',
  'popIn',
  'zoomIn',
  'slideInLeft',
  'slideInRight',
  'slideInTop',
  'slideInBottom',
  'flip',
  'bounce',
  'animate',
])

/** 从 html 片段里扫出元素 id 与是否声明 data-hidden（宿主侧无 DOMParser，用标签正则） */
function scanElements(html: string): Map<string, { hidden: boolean }> {
  const out = new Map<string, { hidden: boolean }>()
  const idRe = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i
  for (const tag of html.match(/<[^>]+>/g) ?? []) {
    const m = tag.match(idRe)
    if (!m) continue
    const id = (m[1] ?? m[2] ?? '').trim()
    if (id) out.set(id, { hidden: /data-hidden/i.test(tag) })
  }
  return out
}

/** 校验完整 course：结构、动词白名单、target 对号、字幕纪律、data-hidden 语义 */
export function auditCourse(course: unknown): CourseAudit {
  const errors: string[] = []
  const warnings: string[] = []
  const stats = { scenes: 0, actions: 0, speaks: 0, visuals: 0 }

  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    return {
      errors: ['course 必须是对象（{ courseId?, title?, scenes: [...] }），完整契约先调 api.classroom.schema()'],
      warnings,
      stats,
    }
  }
  const c = course as Record<string, unknown>
  if (!Array.isArray(c.scenes)) {
    return {
      errors: [
        'course.scenes 缺失或不是数组——画面序列挂在 scenes 上，动作列表挂在每个 scene 的 actions 字段（不是 beats）；契约先调 api.classroom.schema()',
      ],
      warnings,
      stats,
    }
  }
  for (const k of Object.keys(c)) {
    if (!COURSE_FIELDS.has(k)) {
      warnings.push('course.' + k + ' 不是契约字段，会被忽略（合法：courseId / title / description / scenes）')
    }
  }
  if (c.scenes.length === 0) errors.push('course.scenes 是空数组——至少要有一个画面')

  c.scenes.forEach((raw, si) => {
    stats.scenes++
    const at = 'scenes[' + si + ']'
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(at + ' 不是对象')
      return
    }
    const s = raw as Record<string, unknown>
    const sid = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : at
    const where = at + '（' + sid + '）'
    if (typeof s.id !== 'string' || !s.id.trim()) errors.push(where + '.id 缺失——每个画面要有唯一 id')
    if (typeof s.title !== 'string' || !s.title.trim()) errors.push(where + '.title 缺失——画面名用于时间轴分段')
    if (typeof s.html !== 'string' || !s.html.trim()) {
      errors.push(where + '.html 缺失——画面内容是 H5 片段（1920×1080 坐标系，受控元素带唯一 id）')
    } else if (/<script[\s\S]*<\/script\s*>/i.test(s.html) || /\son[a-z]+\s*=/i.test(s.html)) {
      // 渲染器走 innerHTML：<script> 不执行但 on* 内联事件会；手动编辑路径有 sanitizer
      // 剥离，agent 写入路径一律拒存逼着改对（这也让冒烟测试能探出问题而不是 ok:true）
      errors.push(where + '.html 含 <script> 或 on* 内联事件——课堂画布禁用脚本，互动暂停用 checkpoint 动作')
    }
    if (!Array.isArray(s.actions)) {
      errors.push(where + '.actions 缺失或不是数组——动作列表字段名是 actions，不是 beats；契约先调 api.classroom.schema()')
      return
    }
    const elements = typeof s.html === 'string' ? scanElements(s.html) : new Map<string, { hidden: boolean }>()
    let speaks = 0
    let visuals = 0
    const woken = new Set<string>()

    s.actions.forEach((rawA, ai) => {
      stats.actions++
      const at2 = where + '.actions[' + ai + ']'
      if (!rawA || typeof rawA !== 'object' || Array.isArray(rawA)) {
        errors.push(at2 + ' 不是对象')
        return
      }
      const a = rawA as Record<string, unknown>
      switch (a.type) {
        case 'speak': {
          speaks++
          stats.speaks++
          const text = typeof a.text === 'string' ? a.text : ''
          if (!text.trim()) {
            errors.push(at2 + '.text 缺失——speak 的 text 是朗读与字幕唯一源')
          } else {
            if (/[。.]/.test(text)) {
              warnings.push(at2 + '.text 含句号（。或 .）——讲解词严禁句号，用逗号、感叹号或空格断句')
            }
            const len = text.replace(/\s/g, '').length
            if (len > 20) warnings.push(at2 + '.text 共 ' + len + ' 字——每句 8-16 字（上限 20），拆短或分段')
          }
          if (typeof a.subtitle === 'string' && a.subtitle.trim() && a.subtitle !== text) {
            warnings.push(at2 + '.subtitle 会被忽略——字幕与朗读共用 text，不要另写 subtitle')
          }
          break
        }
        case 'visual': {
          visuals++
          stats.visuals++
          const verb = typeof a.verb === 'string' ? a.verb.trim() : ''
          if (!VISUAL_VERB_WHITELIST.has(verb)) {
            errors.push(
              at2 + '.verb "' + (verb || '(空)') + '" 不在 action.verb 白名单——时间轴动词逐条见 api.classroom.verbs()；data-anim 的动效名不能想当然照搬',
            )
          }
          const target = typeof a.target === 'string' ? a.target.replace(/^#/, '').trim() : ''
          if (!target) {
            errors.push(at2 + '.target 缺失——要给目标元素的 id（不带 #）')
          } else if (elements.size > 0 && !elements.has(target)) {
            errors.push(at2 + '.target "' + target + '" 在 ' + where + ' 的 html 里找不到对应 id——受控元素必须有唯一 id 属性')
          }
          if (verb === 'appear' && target && elements.get(target)?.hidden === false) {
            warnings.push(at2 + ' 对 "' + target + '" 用 appear 但元素没声明 data-hidden——它一开始就可见，appear 看不出效果')
          }
          if (WAKING_VERBS.has(verb) && target) woken.add(target)
          break
        }
        case 'wait': {
          const d = a.duration
          if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) errors.push(at2 + '.duration 要是正数（毫秒）')
          break
        }
        case 'checkpoint':
          break
        default:
          errors.push(at2 + '.type "' + String(a.type) + '" 不认识——只有 speak / visual / wait / checkpoint 四类')
      }
    })

    if (speaks > 0 && visuals === 0) {
      warnings.push(where + ' 有讲解但没有任何 visual 动效——讲解不能静止画面，几乎每句 speak 都配 1-2 个 visual')
    }

    // data-hidden 死锁：声明了隐藏但全剧从未被唤醒（宿主侧存盘不会自愈，会一直看不见）
    for (const [id, el] of elements) {
      if (el.hidden && !woken.has(id)) {
        warnings.push(where + ' 的 "' + id + '" 声明了 data-hidden 但全剧从未被唤醒——会一直看不见，安排唤醒动词或删掉 data-hidden')
      }
    }
  })

  return { errors, warnings, stats }
}
