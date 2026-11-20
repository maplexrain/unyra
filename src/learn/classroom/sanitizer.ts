/**
 * 课堂编译器级校验、容错与自愈层
 */
import type { LessonAction, LessonCourse, LessonScene, VisualAction } from './types'
import { expandClassroomComponents } from './components'
import { WAKING_VERBS } from './verbs'

/** 纯净口语文本清洗（剔除 Markdown 格式符、LaTeX $ 标记、动作提示及禁止的句号等） */
export function sanitizeTtsText(text: string): string {
  return text
    .replace(/\$([^$]+)\$/g, '$1') // 提取公式内容作为纯文本发音
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Markdown 链接只保留标题
    .replace(/\[([^\]]+)\]/g, '') // 纯中括号指令剔除
    .replace(/[*#_`~]/g, '') // 剔除 Markdown 格式符
    .replace(/（[^）]*）|\([^)]*\)/g, '') // 剔除中文/英文括号动作提示
    .replace(/[。.]/g, '') // 严禁句号
    .replace(/\s+/g, ' ')
    .trim()
}

/** 清洗并自愈单个画面 */
export function sanitizeScene(scene: LessonScene): LessonScene {
  if (typeof DOMParser === 'undefined') {
    return scene
  }

  const expandedHtml = expandClassroomComponents(scene.html)
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div>${expandedHtml}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement | null
  if (!root) {
    return scene
  }

  // 1. 安全过滤：剥离所有 <script> 标签与 on* 内联事件属性
  root.querySelectorAll('script').forEach((s) => s.remove())
  root.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name)
      }
    })
  })

  // 2. 收集所有合法 DOM ID
  const validIds = new Set<string>()
  root.querySelectorAll('[id]').forEach((el) => {
    if (el.id) validIds.add(el.id)
  })

  // 3. 动作清洗：过滤悬空目标，清洗 TTS 口语纯净度
  const appearedIds = new Set<string>()
  const cleanActions: LessonAction[] = []

  for (const action of scene.actions) {
    if (action.type === 'visual') {
      const cleanTarget = action.target.replace(/^#/, '')
      // 目标元素必须存在于当前画面 DOM 树
      if (!validIds.has(cleanTarget)) {
        continue
      }
      if (WAKING_VERBS.has(action.verb)) {
        appearedIds.add(cleanTarget)
      }
      cleanActions.push({
        ...action,
        target: cleanTarget,
      } as VisualAction)
    } else if (action.type === 'speak') {
      const cleanTtsText = sanitizeTtsText(action.text)

      if (cleanTtsText.length > 0) {
        cleanActions.push({
          ...action,
          subtitle: cleanTtsText,
          text: cleanTtsText,
        })
      }
    } else {
      cleanActions.push(action)
    }
  }

  // 4. 死元素自愈：若元素声明了 data-hidden 但全剧从未被 appear/drawSvg 唤醒，自动移除隐藏标，避免死锁隐藏
  root.querySelectorAll('[data-hidden]').forEach((el) => {
    if (!el.id || !appearedIds.has(el.id)) {
      el.removeAttribute('data-hidden')
    }
  })

  return {
    ...scene,
    html: root.innerHTML,
    actions: cleanActions,
  }
}

/** 清洗完整课堂配置 */
export function sanitizeCourse(course: LessonCourse): LessonCourse {
  return {
    ...course,
    scenes: (course.scenes || []).map(sanitizeScene),
  }
}
