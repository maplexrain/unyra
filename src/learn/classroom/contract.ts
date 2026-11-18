/**
 * 课堂 course 结构契约的唯一事实源：api.classroom.schema() 的载荷。
 *
 * 「契约不可见」是课堂生成踩坑的根因（agent 自造 beats 字段、把 data-anim 名当
 * action.verb）：类型只在编译期可见，help() 一句话带过，写入又不校验。这份契约
 * 把结构、动词分界、布局常量与最小示例一次给齐，提示词规程只引用不重复。
 *
 * 画布常量（1920×1080 / padding / 预设类）以 src/styles/stage-kit.css 与
 * StageViewport.ts 为准，这里只做提示词口径的镜像；那边改了要同步这边。
 */

export interface StagePresetClass {
  name: string
  desc: string
}

/** 舞台布局常量（提示词口径；真值在 stage-kit.css / StageViewport.ts） */
export const CLASSROOM_LAYOUT = {
  canvas: '1920×1080 逻辑画布（渲染时整体等比缩放，直接写这个坐标系里的值）',
  padding: '56px 80px 120px——底部 120px 是字幕安全避让区，重要内容别贴底',
  usable: '约 1760×904',
  baseFontSize: '28px（舞台继承字号，行高 1.5）',
  presetClasses: [
    { name: 'stage-header', desc: 'flex 两端对齐的页眉行' },
    { name: 'stage-title', desc: '46px/800 大标题' },
    { name: 'stage-center', desc: '整屏居中容器（纵排，gap 32px）' },
    { name: 'stage-top-title', desc: 'grid「标题一行 + 内容一行」布局' },
    { name: 'stage-split', desc: '左右双栏 1fr 1fr（gap 48px）' },
    { name: 'stage-split-3', desc: '三等分栏（gap 36px）' },
    { name: 'stage-grid-2x2', desc: '2×2 网格（gap 36px）' },
    { name: 'card-glass', desc: '玻璃卡片底（圆角/描边/内边距齐全，任意容器可叠加）' },
    { name: 'badge-pill + badge-{seal|sky|ok|warn|purple}', desc: '行内胶囊小标与五色变体' },
    { name: 'fx-highlight', desc: 'highlight 动词激活时的发光样式（调度器自动挂，别手写）' },
    { name: 'ui-* 展开类', desc: 'card-ui-* / concept-* / formula-* / code-* / compare-* / step-* / stat-* / callout-* / quote-* / quiz-* 是组件展开后的内部结构类——优先用 <ui-*> 组件别手拼；组件的属性与子节点约定逐条见 api.classroom.components() 的 example' },
  ] as StagePresetClass[],
  /**
   * 课堂画布的视觉律自成一系（stage-kit）：卡片圆角、毛玻璃与强调色都按主题配好了——
   * 文档区「容器严禁圆角」等排版律**不适用于**课堂内 html，别往里硬搬。
   */
  visualNote: '课堂画布视觉自成一系（stage-kit）：卡片圆角与主题强调色是课堂自有样式；文档区「容器严禁圆角」等排版律不适用于课堂内 html',
}

/** 最小完整 course 示例：一个画面讲清全部要素（唯一 id / data-hidden / 四类动作） */
export const CLASSROOM_COURSE_EXAMPLE = {
  courseId: 'limit-intro',
  title: '极限的直觉',
  scenes: [
    {
      id: 'scene-1',
      title: '痛点引入',
      html:
        '<div class="stage-center">' +
        '<h2 id="question" data-hidden>0.999… 到底等不等于 1？</h2>' +
        '<ui-card id="answer" data-hidden>无限逼近，就是相等</ui-card>' +
        '</div>',
      actions: [
        { type: 'speak', text: '先看一个扎心的问题' },
        { type: 'visual', verb: 'appear', target: 'question', blocking: true },
        { type: 'speak', text: '你的直觉是什么' },
        { type: 'visual', verb: 'popIn', target: 'answer' },
        { type: 'speak', text: '其实答案藏在这句话里' },
        { type: 'checkpoint', title: '你选哪一个？', blocking: true },
      ],
    },
  ],
}

/** api.classroom.schema() 的回执载荷（纯 JSON，可过结构化克隆） */
export function classroomSchemaPayload(): Record<string, unknown> {
  return {
    course: {
      courseId: 'string，可省（回落课堂节点 uuid）',
      title: 'string，课件标题',
      description: 'string，可选',
      scenes: 'LessonScene[]，画面序列',
    },
    scene: {
      id: 'string，画面唯一 id',
      title: 'string，画面名（时间轴分段导航用）',
      html: 'string，H5 片段——受控元素必须有唯一 id；初始隐藏的声明 data-hidden；可用预置舞台类与 <ui-*> 组件（清单 api.classroom.components()）',
      actions: 'LessonAction[]——动作列表字段名就是 actions，不是 beats',
    },
    actions: {
      speak: '{ type:"speak", text, subtitle?, blocking? }——text 是朗读与字幕唯一源，严禁句号，每句 8-16 字（上限 20）；blocking 缺省 true',
      visual: '{ type:"visual", verb, target, params?, blocking? }——verb 白名单 api.classroom.verbs()；target 是本画面 html 里的元素 id（不带 #）；blocking 缺省 false（与讲解并行）',
      wait: '{ type:"wait", duration, blocking: true }——气口留白，duration 毫秒',
      checkpoint: '{ type:"checkpoint", title?, blocking: true }——暂停画面弹出 title 浮层让学生自己想，点「继续」才走。**不判分**；随堂选项展示用 ui-quiz 组件（同样没有判定回路），别把它当题库',
    },
    verbs: '两套动效表严格分开：action.verb（时间轴调度）→ api.classroom.verbs()；data-anim="名"（换幕挂载播一次，不受时间轴控制）→ api.classroom.animations()。动效名想当然填进 verb 会静默不生效',
    layout: CLASSROOM_LAYOUT,
    components: 'ui-* 组件的属性与子节点约定（含 <ui-step> / <ui-option> 子项）逐条见 api.classroom.components() 每条的 description 与 example——课堂 html 手写样式前先查它',
    example: CLASSROOM_COURSE_EXAMPLE,
  }
}
