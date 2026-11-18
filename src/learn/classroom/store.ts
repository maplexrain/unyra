/**
 * 互动课堂实体存储与默认课件模板
 */
import type { ClassroomEntity, LessonAction, LessonCourse, LessonScene } from './types'
import type { LearnStore } from '../types'

const CLASSROOM_STORE_KEY_PREFIX = 'moji:classroom:'

/** 生成初始互动课堂数据（默认空白，等待 AI 导师生成或用户编写） */
export function createDefaultLessonCourse(title: string = '新互动课堂'): LessonCourse {
  return {
    courseId: `course_${Date.now()}`,
    title,
    description: '',
    scenes: [],
  }
}

/** 生成初始演示互动课堂数据（供测试或样例参考） */
export function createDemoLessonCourse(title: string = '互动课堂教学演示'): LessonCourse {
  return {
    courseId: `course_${Date.now()}`,
    title,
    description: '16:9 画布互动教学示例：画面、动作与时间轴联动',
    scenes: [
      {
        id: 'scene_intro',
        title: '1. 概念引入',
        html: `
          <div class="stage-top-title">
            <div class="flex items-center justify-between border-b border-white/10 pb-4">
              <div class="flex items-center gap-4">
                <span class="badge-step">第 1 节</span>
                <span class="text-[44px] font-bold text-white tracking-wide">什么是确定性互动课堂？</span>
              </div>
              <span class="text-[24px] text-sky-400 font-mono">1920 × 1080 STAGE</span>
            </div>
            <div class="stage-split">
              <div id="card_concept" class="card-glass flex flex-col gap-4">
                <div class="text-[36px] font-bold text-sky-400">传统 PPT vs 互动数字课堂</div>
                <div class="text-[28px] text-slate-300 leading-relaxed">
                  传统课件依靠单向翻页与固定时长，而互动课堂由<span class="text-sky-300 font-semibold">【画面 + 动作 + 节拍轴】</span>构成，时间根据语音解说与动画动态推进。
                </div>
              </div>
              <div id="card_features" data-hidden class="card-glass flex flex-col gap-5">
                <div class="text-[32px] font-bold text-emerald-400">核心能力</div>
                <div id="feat_1" class="text-[26px] text-slate-200 flex items-center gap-3">
                  <span class="w-3 h-3 rounded-full bg-sky-400"></span> 16:9 绝对逻辑坐标系，消灭排版错乱
                </div>
                <div id="feat_2" data-hidden class="text-[26px] text-slate-200 flex items-center gap-3">
                  <span class="w-3 h-3 rounded-full bg-emerald-400"></span> 阻塞讲解与非阻塞视觉并行调度
                </div>
                <div id="feat_3" data-hidden class="text-[26px] text-slate-200 flex items-center gap-3">
                  <span class="w-3 h-3 rounded-full bg-pink-400"></span> 任意时间轴跳转，0毫秒精准终态重现
                </div>
              </div>
            </div>
          </div>
        `,
        actions: [
          {
            type: 'visual',
            verb: 'highlight',
            target: 'card_concept',
          },
          {
            type: 'speak',
            text: '欢迎来到全新互动课堂。这里不再是单调的翻页，而是由画面、动作与节拍构成的动态剧场。',
            subtitle: '欢迎来到全新互动课堂：16:9 画布 · 动态动作流 · 语音协同',
          },
          {
            type: 'visual',
            verb: 'appear',
            target: 'card_features',
          },
          {
            type: 'speak',
            text: '看右侧的核心优势，画布锁定高清比例，排版永远稳如泰山。',
            subtitle: '16:9 锁定分辨率，外层等比自适应视口',
          },
          {
            type: 'visual',
            verb: 'appear',
            target: 'feat_2',
          },
          {
            type: 'speak',
            text: '动作被拆解为阻塞讲解与后台动画，实现音画天然对齐。',
            subtitle: '双通道并发调度：非阻塞动画 + 阻塞讲解',
          },
          {
            type: 'visual',
            verb: 'appear',
            target: 'feat_3',
          },
          {
            type: 'visual',
            verb: 'pulse',
            target: 'feat_3',
          },
          {
            type: 'speak',
            text: '无论你在时间轴上跳到哪里，都能一瞬间还原画面终态。',
            subtitle: '0ms 确定性快进，告别繁重逆向 Undo',
          },
          {
            type: 'checkpoint',
            title: '准备好进入下一步公式推导了吗？',
            blocking: true,
          },
        ],
      },
      {
        id: 'scene_formula',
        title: '2. 公式与推导',
        html: `
          <div class="stage-top-title">
            <div class="flex items-center justify-between border-b border-white/10 pb-4">
              <div class="flex items-center gap-4">
                <span class="badge-step">第 2 节</span>
                <span class="text-[44px] font-bold text-white tracking-wide">数学公式与动画步进</span>
              </div>
              <span class="text-[24px] text-emerald-400 font-mono">KaTeX FORMULA</span>
            </div>
            <div class="stage-center">
              <div id="formula_main" class="formula-box w-3/4 shadow-2xl">
                $$E = mc^2$$
              </div>
              <div id="formula_desc" data-hidden class="card-glass w-3/4 flex flex-col gap-3 text-center">
                <div class="text-[34px] font-bold text-sky-300">质能等价方程</div>
                <div class="text-[28px] text-slate-300">
                  能量 $E$ 等于质量 $m$ 乘以光速 $c$ 的平方，揭示了微观质量蕴含的巨大能量。
                </div>
              </div>
            </div>
          </div>
        `,
        actions: [
          {
            type: 'visual',
            verb: 'highlight',
            target: 'formula_main',
            params: { color: '#38bdf8' },
          },
          {
            type: 'speak',
            text: '课堂原生支持数学公式。中间是著名的爱因斯坦质能等价方程。',
            subtitle: '公式直接经 KaTeX 硬件渲染：$E = mc^2$',
          },
          {
            type: 'visual',
            verb: 'appear',
            target: 'formula_desc',
          },
          {
            type: 'speak',
            text: '画面能够根据讲解节奏，按步揭示知识细节与重点推导。',
            subtitle: '伴随讲解动态展开推导释义',
          },
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

    const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '互动课堂'
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
