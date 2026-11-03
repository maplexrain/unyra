/**
 * 节点宇宙的新手教学：画布内全屏遮罩 + SVG 挖洞聚焦，一步步指给用户看。
 *
 * 聚焦为什么用 SVG mask 而不是四块 div 拼边框：mask 里一块黑矩形把目标「抠」出来、
 * 四周半透明压暗——洞的圆角、描边与跟随都是一层图形的事，不用去对付 box-shadow 的
 * 多层 hack。每一步认一个选择器；目标不在了（比如画布上还没有节点）就整屏压暗，
 * 不空转也不跳步。
 *
 * **全部坐标都相对画布容器算**（fixed 在这棵树里会被带 transform/backdrop-filter 的
 * 祖先劫持包含块——卡片因此错位又被 pane 裁掉过一截，真错过一次）；遮罩挂在画布根上
 * absolute 铺满，量目标时减去容器的矩形，两边从此说的是同一套坐标。
 *
 * 提示卡**跟着洞走**：
 * - 当目标在画布左侧（如左侧节点列表）时，卡片优先落在洞右侧，绝不盖住左侧栏，且绝不会被顶栏截断；
 * - 当目标在右下角（如控制工具栏）时，优先落在上方；
 * - 其他节点优先落在下方（下方不足换上方）；
 * - 结合 cardRef 动态测量实际高度，并以严格的 clampX 与 clampY 限制在容器安全边距内，杜绝任何截断。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../../i18n'

/** 教学的一步：selector 找得到就挖洞聚焦它，找不到就整屏压暗 */
interface TourStep {
  selector?: string
  title: string
  body: string
}

const STEPS: TourStep[] = [
  {
    title: '欢迎来到节点宇宙',
    body: '节点宇宙是课程的知识全景空间：文档、大纲、视频、便签、测验与超级文档都在这张画布上摆放并自由连线。教学期间展示的是模拟数据，退出后自动恢复您的真实空间。随时按 Esc 或点击「跳过教学」即可退出。',
  },
  {
    selector: '[data-tour="palette"]',
    title: '从顶部栏创建节点',
    body: '新建目标后，画布默认是一张纯净的空白宇宙。按住顶部任意节点类型（文档、大纲、笔记、试卷、超级文档、视频）拖拽到画布空白处，即可创建独立实体；拖到卡片上则能快速建立从属连接。',
  },
  {
    selector: '[data-tour-node="entry-doc"]',
    title: '卡片即学习节点',
    body: '每张卡片代表一个学习实体。点击标题可直接在工作区打开文档阅读或编辑；按住卡片可自由拖拽摆位；右键卡片可唤出快捷菜单（设为入口、添加便条、重命名、删除等）。',
  },
  {
    selector: '[data-tour-node="outline"]',
    title: '大纲与菱形接口',
    body: '大纲节点用于梳理知识体系结构。右侧的菱形代表目标项接口点：从空菱形拖出连线可直接认领并创建子文档；已连接的菱形可拖动重连换绑，层层向下构建严密的知识树。',
  },
  {
    selector: '[data-tour-node="note"]',
    title: '便签笔记与要点速记',
    body: '笔记节点可以自由连接或挂载在文档旁边，用于记录核心公式、面试必背或个人心得。点击笔记标题即可直接在工作区打开进行编辑与沉淀。',
  },
  {
    selector: '[data-tour-node="exam"]',
    title: '随堂测试与考试记录',
    body: '试卷节点可挂载在知识点文档下检验学习成果。点击卡片右侧的「开始作答」即可开启独立测验窗口；下方清晰列出历次作答记录与判分结果（如 95 分），点击记录直接回顾错题与解析。',
  },
  {
    selector: '[data-tour-node="superdoc"]',
    title: '超级文档交互组件',
    body: '超级文档支持嵌入富交互式 HTML/JS 实验与沙盒仿真（如网络协议时序模拟、算法动态演练）。连线挂载在文档下，让抽象理论变成可动手操作的具象实验。',
  },
  {
    selector: '[data-tour-node="video"]',
    title: '视频与拓展学习资源',
    body: '视频节点支持选集联动、生成总览文档以及分段笔记。可以在左侧栏拖入视频卡，随时与知识点文档建立关联。',
  },
  {
    selector: '[data-tour="minimap"]',
    title: '小地图全景导航',
    body: '左上角为缩略小地图：当学习体系规模逐渐扩大时，点击或拖动小地图视野框即可快速穿梭定位，随时掌握全图脉络。',
  },
  {
    selector: '[data-tour="controls"]',
    title: '画布辅助工具组',
    body: '右下角工具组支持视口缩放、切换直线/曲线连线风格、撤销操作、一键适应全图居中以及智能自动排列。想重温本教学，随时点击最右侧的问号。',
  },
]

/** 挖洞时目标外扩的白边：别让描边贴着元素 */
const HOLE_PAD = 8
/** 提示卡与洞、与容器边缘的最小安全间距 */
const GAP = 16
/** 提示卡宽度 */
const CARD_W = 320
/** 提示卡预估高度（未完成测量时的兜底值） */
const CARD_EST_H = 190

export function StructureTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  /** 当前目标元素的**容器相对**矩形；目标缺席时是 null（整屏压暗） */
  const [hole, setHole] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  /** 提示卡的落点与限高（容器相对） */
  const [card, setCard] = useState<{ x: number; y: number; maxH: number }>({ x: 160, y: GAP, maxH: 400 })
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLParagraphElement | null>(null)

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const base = wrap.getBoundingClientRect()
    const cardEl = cardRef.current
    const cardW = cardEl?.offsetWidth || CARD_W
    const cardH = cardEl?.offsetHeight || CARD_EST_H

    const clampX = (x: number) => Math.max(GAP, Math.min(x, base.width - cardW - GAP))
    const clampY = (y: number) => Math.max(GAP, Math.min(y, base.height - cardH - GAP))

    const sel = STEPS[step]?.selector
    const el = sel ? document.querySelector<HTMLElement>(sel) : null
    if (!el) {
      // 目标缺席：整屏压暗，提示卡落在画布中央
      setHole(null)
      setCard({
        x: clampX((base.width - cardW) / 2),
        y: clampY((base.height - cardH) / 2),
        maxH: Math.max(160, base.height - GAP * 2),
      })
      return
    }
    const r = el.getBoundingClientRect()
    const holeRect = {
      x: r.left - base.left - HOLE_PAD,
      y: r.top - base.top - HOLE_PAD,
      w: r.width + HOLE_PAD * 2,
      h: r.height + HOLE_PAD * 2,
    }
    setHole(holeRect)

    // 计算四周可用空间
    const spaceBelow = base.height - (holeRect.y + holeRect.h) - GAP
    const spaceAbove = holeRect.y - GAP
    const spaceRight = base.width - (holeRect.x + holeRect.w) - GAP

    let targetX = holeRect.x + holeRect.w / 2 - cardW / 2
    let targetY = holeRect.y + holeRect.h + GAP

    // 智能方位决策：
    // 1. 如果目标位于画布左侧（如左侧节点列表 palette 或小地图 minimap）且右侧空间宽裕：优先贴在洞右侧
    if (holeRect.x < base.width * 0.35 && spaceRight >= cardW) {
      targetX = holeRect.x + holeRect.w + GAP
      // 洞高度若大于卡片则居中对齐，否则与洞顶部对齐
      targetY = holeRect.h > cardH ? holeRect.y + (holeRect.h - cardH) / 2 : holeRect.y
    }
    // 2. 如果目标位于右下角（如 controls）且下方空间不足：优先贴在洞上方
    else if (spaceBelow < cardH && spaceAbove >= cardH) {
      targetY = holeRect.y - cardH - GAP
      targetX = holeRect.x + holeRect.w / 2 - cardW / 2
    }
    // 3. 一般卡片：优先贴在洞下方
    else if (spaceBelow >= cardH) {
      targetY = holeRect.y + holeRect.h + GAP
      targetX = holeRect.x + holeRect.w / 2 - cardW / 2
    }
    // 4. 下方不足则尝试上方
    else if (spaceAbove >= cardH) {
      targetY = holeRect.y - cardH - GAP
      targetX = holeRect.x + holeRect.w / 2 - cardW / 2
    }
    // 5. 否则尝试右侧或左侧
    else if (spaceRight >= cardW) {
      targetX = holeRect.x + holeRect.w + GAP
      targetY = holeRect.y
    } else {
      targetX = holeRect.x - cardW - GAP
      targetY = holeRect.y
    }

    setCard({
      x: clampX(targetX),
      y: clampY(targetY),
      maxH: Math.max(160, base.height - GAP * 2),
    })
  }, [step])

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0
    }
  }, [step])

  useEffect(() => {
    // 双重 RAF：第一拍量出基本位置，第二拍在 DOM 文本渲染撑开后微调至像素级对齐
    let raf2: number | null = null
    const raf1 = requestAnimationFrame(() => {
      measure()
      raf2 = requestAnimationFrame(measure)
    })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2 !== null) cancelAnimationFrame(raf2)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const last = step === STEPS.length - 1

  return (
    <div ref={wrapRef} className="absolute inset-0 z-40">
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <mask id="moji-tour-mask">
            <rect width="100%" height="100%" fill="#fff" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="10" fill="#000" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(23,20,17,0.55)" mask="url(#moji-tour-mask)" />
        {hole && (
          <rect
            x={hole.x}
            y={hole.y}
            width={hole.w}
            height={hole.h}
            rx="10"
            fill="none"
            stroke="var(--color-seal, #a8432f)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        )}
      </svg>

      <div
        ref={cardRef}
        className="absolute flex flex-col rounded-xl border border-line bg-card p-3.5 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
        style={{ left: card.x, top: card.y, width: CARD_W, maxHeight: card.maxH }}
      >
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-ink-strong">{t(STEPS[step].title)}</span>
          <span className="shrink-0 tabular-nums text-[10.5px] text-ink-faint">
            {step + 1} / {STEPS.length}
          </span>
        </div>
        <p
          ref={bodyRef}
          className="moji-scroll-thin min-h-0 flex-1 overflow-y-auto text-[12px] leading-relaxed text-ink-soft"
        >
          {t(STEPS[step].body)}
        </p>
        <div className="mt-3 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 py-1 text-[11.5px] text-ink-faint transition hover:text-ink"
          >
            {t('跳过教学')}
          </button>
          <span className="flex-1" />
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/50"
            >
              {t('上一步')}
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? onClose() : setStep(step + 1))}
            className="rounded-lg bg-ink px-3 py-1 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong"
          >
            {last ? t('完成') : t('下一步')}
          </button>
        </div>
      </div>
    </div>
  )
}
