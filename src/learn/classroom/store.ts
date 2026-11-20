/**
 * 课堂实体存储与默认课件模板
 */
import type { ClassroomEntity, LessonAction, LessonCourse, LessonScene } from './types'
import type { LearnStore } from '../types'

const CLASSROOM_STORE_KEY_PREFIX = 'moji:classroom:'

/** 生成初始课堂数据（默认空白，等待 AI 导师生成或用户编写） */
export function createDefaultLessonCourse(title: string = '新课堂'): LessonCourse {
  return {
    courseId: `course_${Date.now()}`,
    title,
    description: '',
    scenes: [],
  }
}

/** 生成初始演示课堂数据（供测试或样例参考，通过静态体检零警告） */
export function createDemoLessonCourse(title: string = '课堂教学演示'): LessonCourse {
  return {
    courseId: `course_${Date.now()}`,
    title,
    description: '16:9 墨韵舞台课堂示例：版式、动效与音效协同',
    scenes: [
      {
        id: 'scene_intro',
        title: '1. 概念引入',
        sfx: 'swell',
        html: `
          <div class="stage-top-title">
            <div class="stage-header">
              <div class="flex items-center gap-4">
                <ui-badge color="seal" variant="solid">第 1 幕</ui-badge>
                <h1 class="stage-title">什么是确定性课堂？</h1>
              </div>
              <span class="stage-eyebrow">1920 × 1080 STAGE</span>
            </div>
            <ui-split gap="44" ratio="3:2">
              <ui-card id="card_concept" eyebrow="PARADIGM SHIFT" title="动态剧场 vs 静态幻灯片" tone="seal" icon="sparkles">
                <p>传统课件依赖机械翻页，而课堂由<ui-highlight color="seal">画面 + 动作 + 节拍轴</ui-highlight>驱动，讲解到哪一词，视觉聚焦到哪一处！</p>
              </ui-card>
              <ui-steps id="card_features" title="核心引擎能力" data-hidden>
                <ui-step id="feat_1" num="1" title="绝对比例画布" state="done">锁定 16:9 坐标，拒绝视口挤压错乱</ui-step>
                <ui-step id="feat_2" num="2" title="双通道并发" state="active" badge="协同" data-hidden>讲解阻塞推进，动效与音效并行呼吸</ui-step>
                <ui-step id="feat_3" num="3" title="零毫秒快进" data-hidden>任意拖拽时间轴，瞬间安静重现终态</ui-step>
              </ui-steps>
            </ui-split>
          </div>
        `,
        actions: [
          { type: 'visual', verb: 'spotlight', target: 'card_concept', params: { sfx: 'focus' } },
          { type: 'speak', text: '欢迎来到课堂，这里不是静态幻灯片' },
          { type: 'visual', verb: 'unfold', target: 'card_features', params: { sfx: 'paper' } },
          { type: 'speak', text: '画布锁定了黄金比例，排版永远稳固' },
          { type: 'visual', verb: 'slideInLeft', target: 'feat_2', params: { sfx: 'tick' } },
          { type: 'speak', text: '嘴里讲到哪一句，画面就同步推演到哪一步' },
          { type: 'visual', verb: 'slideInLeft', target: 'feat_3', params: { sfx: 'tick' } },
          { type: 'visual', verb: 'stamp', target: 'feat_3' },
          { type: 'speak', text: '无论跳到时间轴哪里，都能瞬间安静还原画面' },
          { type: 'checkpoint', title: '准备好进入下一幕公式推导了吗？', blocking: true },
        ],
      },
      {
        id: 'scene_formula',
        title: '2. 公式与推导',
        sfx: 'whoosh',
        html: `
          <div class="stage-center">
            <ui-formula id="formula_main" eyebrow="EINSTEIN MASS-ENERGY" title="质能等价方程" latex="E = mc^2" desc="静止质量本身就蕴藏着按光速平方放大的巨大能量" tone="seal"></ui-formula>
            <ui-callout id="formula_desc" type="insight" title="物理直觉" data-hidden>
              光速 c 是一个天文数字，所以极微小的质量亏损就能释放惊人能量！
            </ui-callout>
          </div>
        `,
        actions: [
          { type: 'visual', verb: 'shimmer', target: 'formula_main', params: { sfx: 'shimmer' } },
          { type: 'speak', text: '看中间这个著名的质能等价方程' },
          { type: 'visual', verb: 'riseIn', target: 'formula_desc', params: { sfx: 'chime' } },
          { type: 'speak', text: '微小质量乘上光速平方，能量就几何放大' },
        ],
      },
    ],
  }
}

/** 内存缓存字典 */
const entityCache = new Map<string, ClassroomEntity>()

/**
 * course 形状自愈（读盘兜底）。旧版 agent 写入路径没有结构校验：scene 可能缺 actions
 * （自造了 beats 字段）、id/title/html 可能缺——渲染层逐字段假设它们在，坏一幕就把
 * 整个课堂页签掀了（timeline.ts 的 forEach 直接 TypeError，画面全白）。读进来时修好：
 * actions 缺失就采纳 beats（旧 agent 的意图还在里面），其余缺省补空，不丢幕。
 */
function repairScenes(raw: unknown): LessonScene[] {
  if (!Array.isArray(raw)) return []
  const out: LessonScene[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const actions = Array.isArray(s.actions) ? (s.actions as LessonAction[]) : Array.isArray(s.beats) ? (s.beats as LessonAction[]) : []
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : `scene-${out.length + 1}`,
      title: typeof s.title === 'string' ? s.title : `画面 ${out.length + 1}`,
      html: typeof s.html === 'string' ? s.html : '',
      actions,
    })
  }
  return out
}

/** 加载或创建课堂实体 */
export function loadClassroomEntity(id: string, defaultTitle: string = '新课堂', store?: LearnStore): ClassroomEntity {
  if (store?.classrooms) {
    const found = store.classrooms.find((c) => c.id === id)
    if (found) {
      entityCache.set(id, found)
      return found
    }
  }

  if (entityCache.has(id)) {
    return entityCache.get(id)!
  }

  try {
    const raw = localStorage.getItem(`${CLASSROOM_STORE_KEY_PREFIX}${id}`)
    if (raw) {
      const parsed = JSON.parse(raw) as ClassroomEntity
      // localStorage 直读不过 normalizeClassrooms：course 形状在这里自愈
      if (parsed.course && typeof parsed.course === 'object') {
        parsed.course = { ...parsed.course, scenes: repairScenes(parsed.course.scenes) }
      }
      entityCache.set(id, parsed)
      return parsed
    }
  } catch {}

  const newEntity: ClassroomEntity = {
    id,
    title: defaultTitle,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    course: createDefaultLessonCourse(defaultTitle),
    childNodeIds: [],
  }
  saveClassroomEntity(newEntity)
  return newEntity
}

/** 保存课堂实体 */
export function saveClassroomEntity(entity: ClassroomEntity): void {
  entity.updatedAt = Date.now()
  entityCache.set(entity.id, entity)
  try {
    localStorage.setItem(`${CLASSROOM_STORE_KEY_PREFIX}${entity.id}`, JSON.stringify(entity))
  } catch {}
}

export function findClassroom(store: LearnStore, id: string): ClassroomEntity | undefined {
  return (store.classrooms ?? []).find((c) => c.id === id) || entityCache.get(id)
}

export function upsertClassroom(store: LearnStore, entity: ClassroomEntity): LearnStore {
  const list = store.classrooms ?? []
  const idx = list.findIndex((c) => c.id === entity.id)
  const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? entity : c)) : [...list, entity]
  saveClassroomEntity(entity)
  return { ...store, classrooms: nextList }
}

/** 读盘反序列化归一化：过滤坏条目与已不存在的目标，补齐默认字段 */
export function normalizeClassrooms(raw: unknown, goalIds?: ReadonlySet<string>): ClassroomEntity[] {
  if (!Array.isArray(raw)) return []
  const out: ClassroomEntity[] = []
  const seenIds = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    if (!id || seenIds.has(id)) continue
    const goalId = typeof r.goalId === 'string' && r.goalId.trim() ? r.goalId.trim() : undefined
    if (goalId && goalIds && !goalIds.has(goalId)) continue
    seenIds.add(id)

    const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '课堂'
    const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now()
    const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : createdAt
    const rawCourse = r.course && typeof r.course === 'object' ? (r.course as LessonCourse) : createDefaultLessonCourse(title)
    const course: LessonCourse = {
      courseId: typeof rawCourse.courseId === 'string' && rawCourse.courseId ? rawCourse.courseId : id,
      title: typeof rawCourse.title === 'string' && rawCourse.title.trim() ? rawCourse.title : title,
      // description 是契约字段（api.classroom.schema()）：归一化白名单漏了它会被静默丢弃
      ...(typeof rawCourse.description === 'string' && rawCourse.description ? { description: rawCourse.description } : {}),
      scenes: repairScenes(rawCourse.scenes),
    }
    const childNodeIds = Array.isArray(r.childNodeIds)
      ? r.childNodeIds.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : []

    const entity: ClassroomEntity = {
      id,
      title,
      ...(typeof r.description === 'string' && r.description ? { description: r.description } : {}),
      ...(goalId ? { goalId } : {}),
      createdAt,
      updatedAt,
      course,
      childNodeIds,
    }
    entityCache.set(id, entity)
    out.push(entity)
  }

  return out
}
