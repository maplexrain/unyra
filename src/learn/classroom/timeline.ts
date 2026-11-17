/**
 * 无刻度节拍时间轴计算与聚合算法 (Tickless Beat Timeline)
 */
import type { LessonCourse, TimelineBeat } from './types'

/** 将课程的动作流聚合成无刻度节拍序列 */
export function buildTimelineBeats(course: LessonCourse): TimelineBeat[] {
  const beats: TimelineBeat[] = []

  course.scenes.forEach((scene, sceneIdx) => {
    let batchStart = 0
    let visualCount = 0

    scene.actions.forEach((action, actIdx) => {
      const isBlocking = action.blocking ?? (action.type === 'speak')

      if (action.type === 'visual') {
        visualCount++
      }

      const isLastAction = actIdx === scene.actions.length - 1

      // 遇到阻塞动作，或者处于本画面的最后一个动作，闭合成一个节拍
      if (isBlocking || isLastAction) {
        let label = ''
        if (action.type === 'speak') {
          label = action.text.slice(0, 18) + (action.text.length > 18 ? '...' : '')
        } else if (action.type === 'checkpoint') {
          label = action.title ? `[思考] ${action.title}` : '交互停顿点'
        } else if (action.type === 'wait') {
          label = `停顿 (${action.duration}ms)`
        } else {
          label = `画面呈现 (${visualCount}项动作)`
        }

        beats.push({
          beatId: `${scene.id}_beat_${beats.length}`,
          sceneIndex: sceneIdx,
          sceneTitle: scene.title || `画面 ${sceneIdx + 1}`,
          startActionIndex: batchStart,
          endActionIndex: actIdx,
          label,
          visualActionCount: visualCount,
        })

        batchStart = actIdx + 1
        visualCount = 0
      }
    })
  })

  return beats
}

/** 查找当前游标处于哪一个节拍节点 */
export function findBeatIndex(
  beats: TimelineBeat[],
  sceneIndex: number,
  actionIndex: number
): number {
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]
    if (b.sceneIndex === sceneIndex && actionIndex >= b.startActionIndex && actionIndex <= b.endActionIndex) {
      return i
    }
  }
  // 未严格落在区间内时，匹配该画面最近的节拍
  for (let i = beats.length - 1; i >= 0; i--) {
    if (beats[i].sceneIndex === sceneIndex) {
      return i
    }
  }
  return 0
}
