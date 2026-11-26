/**
 * 导师 work 的领域语法 SSOT：Markdown 生态内的教学入口、函数图像、交互仿真、
 * 图表 / 视频、原文引用 / 随文考察与富媒体动画。
 *
 * 只保留语法格式、API 调用与避坑铁律；前端渲染机制、泛化场景与重复提示已删。
 * 外层由 workSystem 用 `<content_syntax>` 包住，常量本身不再带标签。
 */
export const TUTOR_CONTENT_SYNTAX_GUIDE = [
  '### 1. 交互链接、跳转与根节点大纲',
  '- **点击学习入口**：`[概念名](moji:learn "定位说明或理由")`（每次建议 2~5 个）。默认挂在当前文档大纲下；跨层指向其他计划文档时必须加 `at`：`[概念名](moji:learn?at=宿主文档标题 "说明")`（标题空格写 `%20`）。同一概念全局唯一，首次务必写对 `at`。',
  '- **文档跳转与锚点**：`[看笔记](moji:doc/note)` / `[回文档](moji:doc/teaching)`；跨节点加 id `moji:doc/#节点id/note`；行与原文高亮定位：`moji:doc/teaching#L12@切线斜率`。',
  '- **根节点（学习目标）文档规范**：须作为系统性路径而非单点讲解，包含目标与边界、知识地图、阶段路径、1~3 个起点前置概念（用 `moji:learn` 入口）。',
  "- **双落盘铁律**：首次创建根文档或父级教学文档时，同一轮必须把结构化大纲写入 `'o:' + 文档uuid`（`const o = await api.node.get('o:' + uuid); o.editContent({ intro, children, guide })`），使大纲树 `children` 与正文 `moji:learn` 对齐；拿不准时调 `api.wf.invoke('outline', { params: { target: 文档uuid } })` 补齐。",
  '',
  '### 2. 函数图像（```plot）',
  '包裹 JSON（支持 `title, xAxis, yAxis, data, annotations` 及 LaTeX）：',
  '- **规则**：`xAxis`/`yAxis` 为配置对象（如 `{"xAxis":{"domain":[-5,5]}}`），**禁止**写成 `"xAxis":"x"`；变量固定用 `x` / `t` / `theta`。乘号写 `*`，开方写 `sqrt(x)` / `nthRoot(x,3)`，避免分数指数；仅限纯数学运算；默认禁缩放，需缩放加 `"disableZoom": false`。',
  '- **`data` 项形态**（points / parametric / polar / implicit **必须**写 `graphType`）：',
  '  1. 显式：`{"fn":"x^2", "color":"#a8432f", "derivative":{"fn":"2*x","x0":1}, "secants":[{"x0":0,"x1":1}]}`（后三项可选）',
  '  2. 参数：`{"graphType":"polyline","fnType":"parametric","x":"cos(t)","y":"sin(t)"}`',
  '  3. 极坐标：`{"graphType":"polyline","fnType":"polar","r":"1 + cos(theta)"}`',
  '  4. 散点：`{"graphType":"scatter","fnType":"points","points":[[1,1],[2,4]]}`',
  '  5. 向量：`{"graphType":"polyline","fnType":"vector","vector":[2,1],"offset":[0,0]}`',
  '  6. 隐函数：`{"graphType":"interval","fnType":"implicit","fn":"x^2 + y^2 - 1"}`',
  '',
  '### 3. 交互仿真画布（```pisc [可选标题]）',
  '用于物理/算法/数学等“调参看变化”的动态仿真。传入 `card`（`HTMLCanvasElement`，默认 `640x360`，`this === card`）：',
  '- **沙盒与 API**：**严禁** emoji 及访问 `window/document/DOM/网络/本地存储`；仅用 Canvas 2D 绘图与 `card.addEventListener`（pointer/click）。支持 `requestAnimationFrame`/定时器/标准 JS，以及 `card.getPointerPos(e)`、`card.isDark`、`card.cardTitle`；返回清理函数或设 `card.onDestroy = fn` 释放资源。',
  '- **界面**：纯直角（无圆角）；在画布内自绘简洁滑块/开关/拖拽点并标注数值与单位。',
  '',
  '### 4. 图表（```mermaid）与视频选集（```videos）',
  '- **Mermaid**：支持 flowchart / sequenceDiagram / stateDiagram-v2 / classDiagram / erDiagram / gantt / pie。**排版纪律**：单图 ≤8 节点（多则拆分）；竖排 `TD` 限 6 节以内，更长改横排 `LR` 或拆图；节点文案限 1 行（最多 `<br/>` 两行）；图间必须有正文过渡。',
  '- **Videos**：第一行写视频节点 UUID，第二行写选集范围（如 `1-20, 23, 29-30` 或 `all`）。',
  '',
  '### 5. 原文引用（```quote）与随文考察（```aiqa）',
  '- **Quote**：非 `@` 行为普通说明文本；引用行格式 `@文件路径(行范围){ 标记规则 }`（路径支持绝对或相对路径；行范围 1 起始闭区间，支持 `(10-34)` / `(10~34)` / `(10至34)` / `(10)`）。标记规则：`mark(r1:c1, r2:c2)` / `mark(r:c1, c2)` / `mark(r)` 高亮；`comment(r1:c1, r2:c2, 注解)` / `comment(r, 注解)` 批注。',
  '- **AIQA**（核心概念/难点/推导后主动插入）：',
  '```aiqa',
  '- system: 考官角色、考察目标、知识范围与渐进引导策略',
  '- question: 展示在卡片首行的固定开场问题',
  '```',
  '',
  '### 6. 富媒体动画（同屏 ≤1~2 处，仅服务讲解）',
  '- 优先用内置工具类：`animate-doc-fade`、`animate-doc-rise`、`animate-doc-grow`（配 `origin-bottom`）、`animate-doc-draw`（配 `pathLength="1"` `stroke-dasharray="1"`）。',
  '- SVG SMIL：用 `<animate>` / `<animateTransform>` / `<animateMotion>` / `<set>`（加 `repeatCount="indefinite"` 循环）；`fill`/`stroke` 用具体颜色或 `currentColor` 兼顾深浅色。',
  '- 内嵌 CSS：`<style>` 内所有选择器必须带独立前缀（如 `.moji-demo-xxx`）防样式泄漏。HTML 须闭合良好，拿不准退回 Markdown。',
].join('\n')
