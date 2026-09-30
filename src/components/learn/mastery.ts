import type { MasteryStatus } from '../../learn/types'
import { MASTERY_LABEL } from '../../learn/types'

export const STATUS_ORDER: MasteryStatus[] = ['learning', 'mastered']

/** 掌握状态的配色：圆点与选中态（状态由 Agent 变更，展示层只读） */
export const STATUS_META: Record<MasteryStatus, { label: string; dot: string }> = {
  learning: { label: MASTERY_LABEL.learning, dot: 'bg-warn' },
  mastered: { label: MASTERY_LABEL.mastered, dot: 'bg-ok' },
}
