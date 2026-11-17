/**
 * 互动课堂实体存储与默认课件模板
 */
import type { ClassroomEntity, LessonCourse } from './types'
import type { LearnStore } from '../types'

const CLASSROOM_STORE_KEY_PREFIX = 'moji:classroom:'

/** 生成初始演示互动课堂数据 */
export function createDefaultLessonCourse(title: string = '互动课堂教学演示'): LessonCourse {
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
