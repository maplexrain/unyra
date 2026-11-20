/**
 * 课堂 course 结构契约的唯一事实源：api.classroom.schema() 的载荷。
 *
 * 把结构、动词分界、布局常量、31 个内置组件索引、22 个内置音效入口与最小示例一次给齐，
 * 提示词规程只引用不重复。
 *
 * 画布常量（1920×1080 / padding / 预设类）以 src/styles/stage-kit.css 与
 * StageViewport.ts 为准，这里做提示词口径镜像。
 */

export interface StagePresetClass {
  name: string
  desc: string
}

/** 舞台布局常量（提示词口径；真值在 stage-kit.css / StageViewport.ts） */
export const CLASSROOM_LAYOUT = {
  canvas: '1920×1080 逻辑画布（渲染时整体等比缩放，直接写这个坐标系里的值）',
  padding: '56px 80px 120px——底部 120px 是字幕安全避让区，重要内容绝不贴底',
  usable: '约 1760×904',
  baseFontSize: '28px（舞台继承字号，行高 1.5）',
  presetClasses: [
    { name: 'stage-header', desc: 'flex 两端对齐的页眉行（带底分隔线）' },
    { name: 'stage-title', desc: '44px/800 大标题' },
    { name: 'stage-eyebrow', desc: '14px 全大写 tracked 眉标小字' },
    { name: 'stage-center', desc: '整屏居中容器（纵排，gap 28px）' },
    { name: 'stage-top-title', desc: 'grid「标题一行 + 内容一行」布局' },
    { name: 'stage-split', desc: '左右双栏（默认 1fr 1fr，推荐用 <ui-split ratio="3:2"> 做主次分区）' },
    { name: 'stage-split-3', desc: '三等分栏（gap 32px）' },
    { name: 'stage-grid-2x2', desc: '2×2 网格（gap 32px）' },
    { name: 'card-glass', desc: '墨韵建筑表面卡片（可配 card-tone-{seal|sky|ok|warn|purple|sunken}）' },
    { name: 'badge-pill + badge-{seal|sky|ok|warn|purple}', desc: '行内胶囊小标与五色变体' },
    { name: 'fx-highlight', desc: 'highlight 动词激活时的发光聚焦框（调度器自动挂，别手写）' },
    {
      name: 'ui-* 组件标签',
      desc: '优先使用 31 种 <ui-*> 组件（新增 <ui-pipeline>/<ui-node> 因果链、<ui-diagram> 蓝图插画框、<ui-breakdown> 比例条等），属性与子节点约定逐条见 api.classroom.components()',
    },
  ] as StagePresetClass[],
  visualNote:
    '课堂画布视觉自成一系（stage-kit）：基于纸墨主题令牌自动适配浅色与深色，严禁硬编码死白/死黑文字色；文档区「容器严禁圆角」等排版律不适用于课堂内 html',
}

/** 最小完整 course 示例：一个画面讲清全部要素（唯一 id / data-hidden / 四类动作 / sfx 标点） */
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
        '<ui-card id="answer" tone="seal" icon="sparkles" data-hidden>无限逼近，就是相等</ui-card>' +
        '</div>',
      actions: [
        { type: 'speak', text: '先看一个扎心的问题' },
        { type: 'visual', verb: 'appear', target: 'question', blocking: true },
        { type: 'speak', text: '你的直觉是什么' },
        { type: 'visual', verb: 'popIn', target: 'answer', params: { sfx: 'chime' } },
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
      sfx: 'string，可选——进幕转场音效（如 whoosh / swell / paper，清单 api.classroom.sounds()；none 静音）',
      html: 'string，H5 片段——受控元素必须有唯一 id；初始隐藏的声明 data-hidden；可用预置舞台类与 31 种 <ui-*> 组件（清单 api.classroom.components()）',
      actions: 'LessonAction[]——动作列表字段名就是 actions，不是 beats',
    },
    actions: {
      speak: '{ type:"speak", text, subtitle?, blocking? }——text 是朗读与字幕唯一源，严禁句号，每句 8-16 字（上限 20）；blocking 缺省 true',
      visual:
        '{ type:"visual", verb, target, params?, blocking? }——verb 白名单 api.classroom.verbs()；target 是本画面 html 里的元素 id（不带 #）；params.sfx 可挂同步音效（见 api.classroom.sounds()，传 none 关闭自带音）；blocking 缺省 false',
      wait: '{ type:"wait", duration, blocking: true }——气口留白，duration 毫秒',
      checkpoint:
        '{ type:"checkpoint", title?, sfx?, blocking: true }——暂停画面弹出 title 浮层让学生自己想（默认响 bell，可传 sfx:"none"）。**不判分**；随堂选项展示用 ui-quiz 组件（同样没有判定回路），别把它当题库',
    },
    verbs:
      '两套动效表严格分开：action.verb（时间轴调度：riseIn/unfold/stamp/shimmer/spotlight/ripple/dimOthers 等）→ api.classroom.verbs()；data-anim="名"（换幕挂载播一次，不受时间轴控制）→ api.classroom.animations()。动效名想当然填进 verb 会静默不生效',
    sounds:
      '内置 22 个 WebAudio 实时合成音效（零资源依赖）→ api.classroom.sounds()。原则：一幕只给 1~3 个戏剧节点配音（标点而非背景墙），checkpoint/countUp/typewriter/stamp/tada 已自带贴合音效，快进（seek）会自动保持静音',
    layout: CLASSROOM_LAYOUT,
    components:
      'ui-* 组件的属性与子节点约定（含 <ui-step> / <ui-option> / <ui-node> / <ui-timeline-item> 子项）逐条见 api.classroom.components() 每条的 description 与 example——课堂 html 手写样式前先查它',
    example: CLASSROOM_COURSE_EXAMPLE,
  }
}
