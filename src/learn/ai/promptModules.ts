/**
 * 这个文件负责什么：**动态提示词注入**的模块注册表——低频能力的完整规范住在这里，
 * 系统提示词里只留一行索引；模型第一次真正用到某组 api（或写出某种内容）时，
 * 宿主把对应模块作为一条隐藏 user 消息注入上下文，**同一上下文只注一次**。
 *
 * 为什么这样拆：EXECUTE_GUIDE 曾把十几个低频域的完整手册整段压在系统提示词里
 * （sdoc 3k、browser 1.8k、exam 1.5k……），每一轮请求都全价付一遍，而多数对话
 * 根本用不到。搬进模块后：不用不花钱；用到时全文在场（不是压缩版）；压缩上下文后
 * 模块随旧消息失活，下次使用自动重新注入——判据见 missingPromptModules。
 *
 * 纪律：
 * - **模块文本与实现对账**：这里的每一段都源自 EXECUTE_GUIDE 的对应小节（无损搬移），
 *   api 行为改了这里也要改——apiCatalog 的目录页与 agent-ops 探针只对账「有没有」，
 *   对不了「写得对不对」。
 * - **key 一经使用不可改**：去重靠消息上的 promptModule 字段（落盘在 chat.json），
 *   改 key 等于让所有老对话的「已注入」记录作废。
 * - 模块文本必须**自包含**：模型读到它时上下文里没有别处的铺垫，开头一句要说清这是什么。
 */
import type { ConversationMessage } from '../../agent/types'
import { t } from '../../i18n'

export interface PromptModule {
  /** 稳定标识：去重、消息标记、触发映射全靠它（见文件头纪律） */
  key: string
  /** 界面分界条上显示的名字（mark = 提示词模块 · {title}） */
  title: string
  /** 注入上下文的完整文本（自包含） */
  text: string
}

export const PROMPT_MODULES: PromptModule[] = [
  {
    key: 'sdoc',
    title: '超级文档',
    text: `超级文档（sdoc，绑定节点的可交互 HTML）——这份规范在你第一次使用超级文档时注入：
- 超级文档是一份**完整的 HTML**（可以带 <style> 与 <script>），绑定在某个节点上，
  一个节点可以有好几份，名字即身份，write 同名覆盖。用途是「可复用的交互小工具」：
  句号计数器、抽问卡片……用户在页签里点，文档干活并显示结果。
  **说明文字、列表、数学公式不要手写 HTML**——一律装进内置的 <moji-markdown> 元素
  （写法见下）：里面直接写 markdown，公式用 LaTeX，宿主会渲染成排版好的正文。
- api.sdoc.list(path?) / sdoc.read(path?, name) / sdoc.write(path?, name, html) / sdoc.delete(path?, name)：
  path 规则与 doc.* 一致（省略 = 当前节点）。write 成功后用 api.ui.superdoc(path, name) 打开给用户。
- **脚本怎么跑（务必照此写）**：渲染在沙箱化的 iframe 里，你的 <script> 正常执行、
  可以随意操作文档自己的 DOM（document.getElementById、addEventListener 都行），
  **但没有 fetch，也碰不到应用页面**。脚本里唯一的对外通道是预先注入好的全局 api：

      <button id="btn">统计</button><p id="out"></p>
      <script>
        var btn = document.getElementById('btn')
        btn.addEventListener('click', async () => {
          document.getElementById('out').textContent = '统计中…'
          const r = await api.method.call('统计句号', '极限')   // 调持久化函数，宿主执行后把结果送回来
          document.getElementById('out').textContent = '句号 ' + r.count + ' 个'
        })
      </script>

  - api.method.call 返回 Promise（结果必须可 JSON 序列化；失败会 reject，配 try/catch 或 .catch）。
  - 重逻辑放 method 函数里（那边有全套 api），脚本只管「取输入 → 调用 → 显示结果」。
  - **样式与颜色（务必照做）**：颜色一律用主题变量，不要写死颜色值——这些变量
    **实时跟随应用的浅色/深色主题**（用户切主题，文档配色立刻跟着变），
    写死的颜色在另一套主题下会看不清。常用：var(--color-paper)（纸面底）/
    var(--color-card)（卡面底）/ var(--color-ink)（正文）/ var(--color-ink-soft)（次要文字）/
    var(--color-ink-faint)（弱文字）/ var(--color-line)（边线）/ var(--color-seal)（点睛红），
    语义色还有 --color-ok / --color-ok-text / --color-warn / --color-sunken / --color-code 等全套；
    字体用 var(--font-sans) / var(--font-mono)。哪怕什么都不写，正文颜色与字体也已经是主题色——
    自己写样式时延续这套变量即可。样式写在文档自己的 <style> 里，选择器加文档内独有的前缀（.sd-xxx）：

      <style>
        .sd-card { background: var(--color-card); color: var(--color-ink);
                   border: 1px solid var(--color-line); padding: 16px;
                   font-family: var(--font-sans); }
        .sd-btn { background: var(--color-seal); color: #fff; border: 0; border-radius: 6px;
                  padding: 6px 14px; cursor: pointer; }
      </style>
      <div class="sd-card"><button class="sd-btn" id="btn">点我</button><p id="out"></p></div>

  - **布局要整洁**：按文档流排——标题、段落、列表、表格、分隔线，像一份排版讲究的讲义。
    **不要把内容包成一堆圆角卡片**，不要阴影、渐变、彩色底块堆砌；容器不用圆角（最多 2px），
    只有按钮/输入框这类控件可以有不超过 6px 的圆角。留白与层级靠字号和 var(--color-ink-faint)
    的弱色区分，不靠把每块东西都装进盒子里。
  - 内置元素 <moji-markdown>（**说明文字、列表、数学公式一律用它**，这是硬规矩——
    直接写在 HTML 里的 $ 符号与 \\( 不会被渲染）：元素里直接写 markdown（**顶格写，别缩进**——
    四格缩进会变成代码块；内容里不要有裸的 <，要写 &lt;），渲染时自动解析成排版好的正文——
    标题、列表、代码块、表格都认，下面的 moji: 链接也能点。公式写 LaTeX：
    行内 $E = mc^2$，独立成行用 $$…$$，宿主用 KaTeX 渲染。示例：

      <moji-markdown>
        ## 实验说明
        当 $v_0 > 0$ 时抛体做减速运动；总位移为
        $$x = v_0 t - \\frac{1}{2} g t^2$$
        点击 **开始** 观察曲线变化；拖动滑块可以调初速度。
      </moji-markdown>

  - 跳转语法：[文字](moji:super/文档名) 点击即打开**本节点**的另一份超级文档（实验之间互相引用
    就用它）；跨节点写 [文字](moji:super/节点id/文档名)，节点 id 从 api.node.list 拿。
    文档名里有空格要先 URL 编码；指名不存在的文档会提示一句「没有这份超级文档」，不会开出空页签。
  - 脚本每次打开文档都会重新执行：把初始化写在顶层，别依赖上次点按留下的状态。`,
  },
  {
    key: 'browser',
    title: '内置浏览器',
    text: `内置浏览器（browser.open / browser.tabs / browser.activate / browser.close / browser.snapshot / browser.point / browser.dom / browser.read / browser.capture）——这份规范在你第一次操作内置浏览器时注入：
- 这一组操作的是**界面上开着的网页页签**（文档区里那种地球图标页签）。没有页签就先
  api.browser.open('https://…') 开一个：纯关键词会当搜索词处理；返回 tabId，那时首屏已基本加载完。
- api.browser.tabs()：列出存活的页签。**browser.open 之前先查它**：目标网址已经开着就 activate
  过去，别重复开同一个网址。之后一切操作按 tabId 指名；省略 tabId 指「焦点格正看着的那个网页」。
- **看页面三招（按便宜程度排）**：
  - api.browser.snapshot(tabId?)：把可交互元素列成**带 ref 的清单**（role + 名称 + 输入值，≤200 条）
    ——认结构、找要点的元素全靠它。DOM 变了 ref 会过期，重新 snapshot 就好。
  - api.browser.read(tabId?)：整页转 markdown，与 web.webFetch 同一条管线（短的回全文，长的落盘回
    大纲树 + uuid，用 web.read 按节读）。**登录态页面也能读**——这是 webFetch 做不到的。
  - api.browser.capture(tabId?)：截图（存进资源库并附在下一步里）。**最后手段**：只有布局与视觉
    必须亲眼看时才用；页面还在加载时先 api.wait(800)。
- **动手 = browser.dom**：对 snapshot 清单里的 ref 做受控操作（固定函数 + 值参数，没有任意 JS 的口子）：
  - dom(tabId?, ref, "click")：程序化点击（绝大多数站点的处理函数都会触发）。
  - dom(tabId?, ref, "fill", "文字")：填输入框——触发 input/change 事件，React 受控输入也认；中文照常。
  - dom(tabId?, ref, "focus") / dom(tabId?, ref, "submit")：聚焦；提交元素所在的表单。
  - dom(tabId?, ref, "text")：取这个元素的文字（≤4000 字）；dom(tabId?, ref, "attr", "href")：取属性值。
  - 个别检测程序化点击的站点点不动：api.browser.point 把元素高亮给用户、请用户手点。
- **指给用户看**：api.browser.point(tabId?, 目标)——页面像锚点跳转一样滚到目标元素，并注入一圈
  短暂的脉冲高亮。目标可以是 { ref } 或 CSS 选择器。汇报「我说的是这个元素」时用它。
- **编排纪律（少一轮是一轮）**：
  - 一段 execute 把整条链写完：snapshot → 按清单判断 → dom 的 fill/submit 连招 → read 收尾，
    不要每个动作单独一轮。
  - 拿不准某一步行不行，就用 **if/else + try/catch 把备选一次写全**：ref 过期就在 catch 里重新
    snapshot 再试、选择器失败换 { ref }、dom 点不动就 point 请用户手点——失败被接住继续走，
    既不中断程序，也省掉「试一次、看报错、再试」的额外轮次。
  - **截图是最后手段**：snapshot / read / dom 的 text 与 attr 拿得到的信息，不要用截图拿。
- 网页是用户的真实登录会话：提交、支付、删除、发消息这类不可逆动作必须先 api.ask 确认；
  用户没让关的页签不要 close。跨源 iframe 里的元素 ref 定位不到（此时 point/capture 兜底）。`,
  },
  {
    key: 'web',
    title: '读网页与搜索',
    text: `读网页与搜索（web.webFetch / web.read / web.search）——这份规范在你第一次抓网页或搜索时注入：
- api.web.webFetch('https://…')：抓一页并转成 markdown。两万多字以内**直接回全文**；
  再长就存成文件，只回一棵大纲树（每行「# 标题 - 这一节正文的字数」，不含子节）加上一个 uuid。
  拿到的是大纲时**先看大纲再决定读哪一节**，别指望一次读完。
- api.web.read(uuid, '一级标题/二级标题')：读落盘网页的某一节。path 省略=从头给一段（附大纲）；
  一次最多回 1.2 万字，没回完会在 note 里说明，按 subheadings 再切细。
- api.web.search(query, { engines? | engine?, lang?, count?, onEngineFail? })：多引擎搜索（baidu / bing /
  google / yandex / wikipedia），engines 给数组可**并行搜多家**（≤3，结果按引擎标注），缺省 baidu。
  回 searchedAt（抓取时刻——结果里的「2 天前」这类相对时间按它折算成日期再交付）与
  { rank, title, url, snippet, engine }；解析不出的引擎在 failed 里逐个说明原因，
  **换一家或换措辞再试**，别在一家上反复重试。**engines 全挂时缺省会自动用 baidu/bing 补搜一轮**
  （onEngineFail:"strict" 才原样回报失败），weak 列出「只回标题没摘要」的引擎——那种细节必须
  webFetch 核实再用。要实时信息、要核实事实时用它；摘要已含要点，引用前确需细节再 web.webFetch 读原文。
- 只能 http/https，且**不能抓本机与内网**；一页最多 4MB、20 秒超时。
- 引用网页内容时写明来源（标题 + 链接），并且**区分「网页这么说」与「事实如此」**：
  它是一份材料，不是你的结论。抓之前先想清楚要找什么，别一个接一个地抓。`,
  },
  {
    key: 'res',
    title: '资源库',
    text: `资源库（本目标 static/ 里的文件，用 uuid 寻址；用户往输入框贴的图片就转存在这里）——这份规范在你第一次读写资源时注入：
- api.res.list()：全部资源——uuid、文件名、类型、大小、上传/修改日期、描述、被引用数。
- api.res.info(uuid)：单条详情（含它被哪些文档引用）。
- api.res.read(uuid)：**文本**回正文（可给区间 { start, end } 局部读）；
  **图片不回数据**——它会附在你的下一步里，你直接看得见；其它二进制只回元数据。
- api.res.create({ name, ext, content })：新建一份文本资源（md/txt/json/csv…），返回 uuid。
- api.res.update(uuid, { name, description, content })：改展示名 / 描述 / 文本内容
  （二进制只能改名称与描述，内容改不了）。**描述由你写**：一句「这是什么、用在哪、谁给的」。
- api.res.delete(uuid, { force })：删除。还被文档引用着会拒绝，先 res.refs 看清楚再 force。
- api.res.refs(uuid)：谁在引用它；不传 uuid 就是一次全量扫描——列出每条资源的引用数，
  未被引用的会单独点出来（那是「可能可以清理」的候选，不等于没用）。
- 文档里引用资源写 ![说明](moji:static/uuid)：图片会内联显示，别的文件显示成可点开的卡片。
  引用存的是 uuid，**给资源改名不会让引用失效**。
- 读图是有代价的：挂上来的图会一直留在上下文里（直到被裁掉），所以先用 res.list() 挑，
  一次只看真正需要的那一两张，不要「把图都看一遍」。
- **图挂在你的下一次调用里**，不会出现在这一次 body 的后续步骤中。所以别在同一次编排里
  读完图就接着按「图里画了什么」下判断——把「看图」与「用图」分成两次 body：
  先读图，看到图之后再决定下一步怎么做。
- **内容一样不会重复存**：每条资源带一个内容指纹（res.list 里的 hash 是它的前 12 位，
  相同即同一份内容）。res.create 若撞上库里已有的内容，会直接复用那一条并告诉你，
  不会新建文件；所以不要为了「再存一份」换个名字重复建。`,
  },
  {
    key: 'exam',
    title: '试卷与考试',
    text: `试卷（exam；作用在**当前节点**上，不跟 path 走）——这份规范在你第一次读写试卷时注入：
- 两层结构：一份**试卷**可以有**很多次考试**。试卷是题目、类型、难度与时限；一次考试是「谁在什么时候考的」——
  作答、输入顺序、单题耗时、切屏记录、判分与错题讲解都挂在那一次上。同一份卷子可以反复考，
  重考不复制题目。**考试窗口由用户自己开**：你不要替他开考。
- api.exam.create({ title, kind, level, minutes, questions })：出一份试卷。
  kind 认 'quiz'（随堂小测，**不限时**）| 'test'（小考）| 'exam'（大考）；level 认 'easy' | 'medium' | 'hard' | 'extreme'；
  **minutes 是时限（分钟）**，除小测外必给，且不得低于**题目数 × 2**（代码强制，写小了这次调用不生效）。
  那只是地板——按题量与难度认真估（要写过程、要计算的题多留时间）。类型与难度该问用户就问（见「出卷」工作流）。
  题面按 Markdown 渲染：**涉及数学公式必须用 LaTeX** 写进 stem / options（行内 $…$、独立 $$…$$），
  不要用 Unicode 上下标或纯文本近似；需要图形的题在题目上加 **image 字段**（值是完整的 SVG 源码，
  <svg…</svg> 一段，带 viewBox；canvas 存不下来，图片链接也不要）。所有题目一次出完，不要分批。
- api.exam.read(attemptId?)：**任何时候都能调**，读的是这个知识点。不给 attemptId 就是最新一份试卷的最新一次考试；
  给了就读那一次。回给你的有：paper（类型/难度/时限/满分）、attempt（状态、用时、超时、切屏、作答进度）、
  questions（题目 + 他的作答 + 系统已判好的客观题），以及 **history**——历次考试，每条带 weak（那次考错的题）。
  status 有 none / unattempted（出好了还没考）/ ongoing（正在考，别判分）/ submitted（交卷待判分）/
  graded（已判分，可能还缺讲解）/ abandoned（放弃了：记 0 分，不判分也不讲解，这是用户的选择）。
  没有卷子不是错误，它就是一种答案——所以它永远不会出现在「没有生效」那份清单里。
- api.exam.grade({ attemptId?, results, summary, passed })：判分。results 里逐题给 { questionId, correct, score, comment }，
  客观题的分数以系统为准（你补 comment 就行）；passed 与 summary 必给。attemptId 省略就判「等着判分的那一次」。
- api.exam.explain({ content, attemptId? })：**错题讲解**（Markdown），写在同一次考试上，显示在只读的试卷副本页签里。
  它是判分之后的**第二步**，而且要先看 history 里反复出现的错法——「这次错在哪」和「他反复错在哪」是两句不同的话。
- api.exam.delete({ id })：删一份试卷，id 省略就是最新那份。**只有一次都没考过的能删**：
  考过的是学习记录（作答、耗时、切屏、判分、讲解），要删得由用户在试卷列表里删——那里会列清连带删掉什么。
- 阶段约束：有考试等着判分（或判完还缺讲解）时不能再出卷；判分与讲解都属于那个阶段，一起做完。`,
  },
  {
    key: 'learning-process',
    title: '学习过程（阅读 · 注意力 · 打卡 · 番茄钟）',
    text: `学习过程（reading / attention / checkin / pomodoro）——这份规范在你第一次读学习过程记录时注入：
- **有效阅读记的是事实**：窗口在前台、页签在主位、没静坐超时的那些时间才算数；读到哪一节按
  「这一节进入过视口的比例」算（reach ≥ 0.6 才算读到）。它的用途是排计划、判断「接着上次从哪讲」、
  以及给打卡出题——**不是**给你打分用的。
- api.reading.get(path?)：该节点读到哪了（有效时长、打开次数、每份文档各节的 reach 与摊到的分钟数、
  最近会话）。**动笔讲一个新节点之前先看它**：已经读过一半的，别从第一节重新讲。
- api.reading.list()：当前目标每个有记录的节点一行（未读的节、最后阅读时间、时长、文档是否读完）。
  排学习顺序、决定「今天该推哪个」时用它；api.reading.day(day?) 是某一天读了什么。
- api.attention.get(path?)：把阅读事实折成档位（focused / steady / fragmented / drifting / unknown）
  与五个维度，并给出 **focusMinutes**（按他的连续时长算的建议专注块长）与一句教学建议。
  confidence 为 low（样本还少）时档位不可当真，只读 line 里的事实。
  **这是「怎么教」的输入，不是「算不算学」的判据**——掌握度与打卡都不看它。
- 教学策略怎么跟着它变：drifting / fragmented 就先降难度、换题型、切短块（10~15 分钟一件事），
  别一上来讲长推导；focused 就可以放整段推导与难题。别把档位念给用户听，也别拿它说教。
- api.checkin.status() / api.checkin.settle(...)：打卡（一天最多 3 次机会）。**没有「直接打卡成功」的调用**：
  status 给出今天可出题的节（只来自今天真正读到的内容）、建议题数与通过线，你用 api.ask 出选择题、
  自己判分，再 settle 记结果——门槛与次数由系统复核。用户点了顶栏的打卡时，工作流「打卡」会把整套步骤给你。
- api.pomodoro.status()：番茄钟的**记录**。它是一个纯计时器：一段专注多长（10~90 分钟）、
  做几组（1~6）由用户自己设，休息固定是专注的 1/5，只有完整的专注段才记账，而且切屏照走
  （它记的是「按下了一个计时器」，不是「你真的在学」——后者是有效阅读的事）。
  **你只能读**：开始、停止、改时长都在他顶栏那颗按钮上，你没有对应的 api，回执里的 note 也写了这条。
  想建议节奏时参考 attention.get 的 focusMinutes，但不要催他「现在就开始」。`,
  },
  {
    key: 'review',
    title: '间隔复习',
    text: `间隔复习（review；节点首次变「已掌握」时系统自动建计划）——这份规范在你第一次读写复习计划时注入：
- 计划不是你建的，也没有让你建的口子：+1/+3/+7/+14/+30 五个阶段到了期没做就保持待复习（不自动顺延）。
  完成更靠后的阶段时，更早没做的阶段会自动并入——不要为「补课」重复落账。
- api.review.read(path?)：到期阶段（侧重、逾期天数）、下次到期、补充任务、合并组成员、
  可合并的候选（candidates，带结构关系）、历次记录与错误记忆（fixed: false 的才是活薄弱项）。
- api.review.record({ complete, items, missed, mistakes, fixed, mastery, note, ... })：落账。
  complete 判「交互做完了吗」——**答对答错都算完成**，不要让他重做；错法写进 mistakes
  （pattern 与 state.mistake 同一条规矩：说法稳定），这次答对了的旧薄弱项写进 fixed（标记已修复），
  mastery / note 照 state.update 的口径修正。合并组里每个成员各自 record（node 参数指名）。
- 合并复习：candidates 里有**强相关**节点（同父、前后置、常一起用）才提议——先 api.ask
  问用户（列出节点让他勾选，写一句为什么相关），同意后 api.review.merge({ nodeIds })。
  他不同意就只复习当前节点，不要问第二遍。
- api.review.extend({ focus, days? })：给具体薄弱点加一条补充复习；api.review.adjust({ action })：
  postpone（用户说最近忙，顺延几天）/ split（退出合并组）。`,
  },
  {
    key: 'workspace',
    title: '工作区',
    text: `工作区（workspace；每个节点在磁盘上的真实目录）——这份规范在你第一次读写工作区文件时注入：
- 目录是真的：users/<uid>/docs/<目标>/<节点>/workspace/（就在节点目录里），用户在系统资源管理器里
  看得见、自己也能放文件。
  路径写法与文档同构——节点路径在前、文件在后（极限/数据/实验.csv），省略 path 就是当前节点；
  「节点/workspace/文件」（极限/workspace/要点.md）这种把工作区目录写全的格式也认。
- api.workspace.list(path?)：先看有什么再动手；目录还不存在时回空清单。
- api.workspace.read(path)：读文本文件；二进制读不了，太长会截断（totalChars 是全文长度）。
- api.workspace.write({ path, content })：整份覆盖地写，父目录自动建；回执里 created / updated
  说明是新建还是覆盖——**覆盖之前想一想**，那是用户的真实文件。
- 回执里的 **rel** 是这份文件的磁盘路径（docs/…/workspace/…）：要在回复里引用工作区文件
  （ws 引用 chip 的 path）就**原样抄它**；「节点路径 + 文件段」那种写法（path 字段）只在
  workspace api 之间通用，拿去当 chip 的 path 点击时定位不到。
- 要交付「拿得走的文件」（整理好的资料、数据、代码）就写在这里，别只留在对话里。`,
  },
  {
    key: 'method',
    title: '持久化函数',
    text: `持久化函数（method，按目标归档、跨对话有效）——这份规范在你第一次读写持久化函数时注入：
- api.method.create({ name, code })：把一段**可执行的函数源码**存进这个目标的函数库。
  code 写成匿名 async 函数，**第一个参数是 api**（整套沙箱 api 都在），其余参数是调用方传的实参：

      api.method.create({ name: '统计句号', code: "((api, path) => { const d = await api.doc.read(path); return { count: (d.content.match(/。/g) ?? []).length, chars: d.chars } })" })

- 同名 create 就是**覆盖**（那是更新一个函数，不是重复建）。创建时会编译校验，
  编不过的当场被拒并给出原因。list() 只回名字与体量；delete(name) 删一个。
- api.method.call(name, ...args)：执行一个函数（注入当前编排的 api），返回它的返回值。
  在你的编排里它是「把一段逻辑打包重用」的办法；更重要的是——**超级文档里的脚本只能靠它干活**：
  超级文档的按钮写 api.method.call('统计句号', '极限')，宿主执行的就是你存的这份源码。
  所以「要在超级文档里复用的逻辑」都该落成 method，而不是只写在某次编排里。`,
  },
  {
    key: 'code',
    title: '代码块伪编译',
    text: `代码块伪编译（code）——这份规范在你第一次交付伪编译产物时注入：
- api.code.save({ key, js, note })：交付一份伪编译产物。用户点了文档里代码块上的「编译」时，
  会有一条「伪编译」工作流消息进来（带着 key、语言标记与那段代码）。你转译完调它交货，
  那一块代码下面的「运行」就会亮起来——产物存在数据目录里，重启还在。
- js 必须是**完整、自包含**、能在 Web Worker 里跑的代码（没有 DOM、没有 require/import，
  顶层可以用 await，要出结果就 console.log）；key 原样抄，代码原文不用回抄（宿主按 key 认得）。
- note 是你补的那些假设，一两句话，它会显示给用户。
- **先判有没有输出**：如果这段代码只有定义（类型、接口、函数、类、常量），没有任何会被执行的
  语句、也不会打印任何东西，那就**立刻停止、不要写 js**，改调 api.code.silent({ key, reason })
  把那一块标成无输出（之后它不再显示编译与运行）。这不是失败，是这类代码块的正常归宿。`,
  },
  {
    key: 'compact',
    title: '上下文压缩',
    text: `上下文压缩（compact）——这份规范在你第一次提交交接摘要时注入：
- api.compact({ summary, tasks })：把这段对话折成一份交接摘要。**你不是自己想压就压**——
  用户点了「压缩上下文」，或者上下文快到阈值时，会有一个工作流把整套要求给你（见工作流那一份指令）。
- 两个参数：tasks 是**还没做完的事**（逐条，写到能照着继续干：哪个节点、哪份文档、卡在哪一步），
  summary 是正文摘要（目标与背景 / 已讲清的内容 / 学习者的状态 / 约定与术语）。
- 它**不立刻生效**：摘要先记下，等本轮 loop 结束后旧消息才失活、摘要成为第一条消息。
  所以别重复调用，也别把摘要复述给用户。摘要太短会被拒（原始消息没了，摘要就是唯一的上下文）。`,
  },
  {
    key: 'subagent',
    title: '子代理',
    text: `子代理（subagent.*；把独立的活**并发地**派出去）——这份规范在你第一次派子代理时注入：
- 范式：**脚本创建 → 脚本执行 → 脚本等待**（都在一次 execute 里写完）：
  api.subagent.create({ key, name?, system, tools? }) 登记定义（system 写清角色、工作方式与
  **交付纪律**；tools 是它 execute 开放的 api 组，不给就是 web + tmp）→
  api.subagent.run({ agent, task }) 启动（**立即返回**，任务在后台跑；一次 run 多个 agent 就并发）→
  api.subagent.wait({ seconds }) 收交付。
- **task 要自包含**：子代理看不到你们的对话，要做什么、什么口径、交付什么格式全写在 task 里。
- agent 认 key（name 是显示名，碰巧同名也能对上）；**一个 key 同一时刻只跑一个任务**——要并发
  就建多个 key 再一起 run。别和 web.search 的 engines 并行混谈：那是同一次调用里并行搜多家，
  两种「并发」不是一回事。
- **wait 必带最大时长 seconds**（按任务难度主观定）：有挂起交付立即全部返回；否则监听所有在跑的，
  **任何一个先完成就立即返回它**（回执含 deliveries 与仍在跑的 running 清单）；到点没人交付返回
  timedOut。没有在跑也没有挂起时立即返回空。
- **监督回路（防钻牛角尖）**：wait 超时 → api.subagent.view(agent) 看 recent 里它最近在干什么 →
  确实在打转就 api.subagent.intervene(agent, 指令) 纠偏（指令在它当前这条消息输出完整后插入，
  绝不打断半截输出）；走得正常就再发起一轮 wait。
- 交付时没人在等就**挂起**，不会丢：下一次 wait 把积压的一起返回。execute 结束时仍有 agent 在
  后台跑是正常的——之后任何一次 execute 里都可以继续 wait 收。
- 中断与收拾：interrupt（中断，上下文保留）/ resume（从断点接着跑）/ delete（删定义与会话）。
  用户点「停止」会中断当前所有在跑的子代理。
- 什么时候派：费上下文的体力活（大量检索、通读长文档、批量核实）派出去，把你的上下文留给教学本身。
- 检索类任务的模板：create 一个 tools:["web","tmp"] 的检索代理，system 里写死止损纪律——摘要先筛、
  有明确网址直接读；同一页面/引擎/措辞绝不重试第二次；连续两步没有新信息就收手交付；结论先行、
  关键事实带来源 URL、体量跟任务匹配。web.search 引擎全挂会**自动用 baidu/bing 降级补搜**
  （不用在 task 里重申降级规矩）；回执带 searchedAt，结果里的「2 天前」这类相对时间按它折算。`,
  },
  {
    key: 'ui',
    title: '界面操作',
    text: `界面操作（ui；文档区没有打开的文档时，point / scroll / screenshot / dom 会明确失败）——这份规范在你第一次操作界面时注入（switchMain 的判断标准见系统提示词，那里是它的主场）：
- api.ui.switchMain('agent' | 'doc')：交换主栏，决定用户此刻看哪一边。**多用它**——
  它不改任何数据，代价只有一次调用，而用户被切到正确的那一栏才不会「答着答着发现文档被压在后面」。
  判断标准是「**接下来这几秒用户该看哪边**」，不是某个特定动作：
  - 交付物在文档区（写完 / 改完教学文档、超级文档、学习大纲，或改完一段正文）→ 切 'doc'，
    然后用一两句话说明看什么；**讲完一段该他读的时候也要切**，别让文档压在对话后面。
  - 需要用户动作（ask 表单、让他口答、让他点超级文档里的按钮、让他自己写一段）→ 切 'agent'，
    这一类**必须在提问或等待之前切**，否则他在看文档、看不见问题。
  - 一轮里可以切多次：写文档 → 'doc'，接着要摸底 → 'agent'，再写文档 → 又回 'doc'。
    不要只在一轮结束时切一次，也不要切完不吭声（配一句「请看文档第 3 节」）。
- api.ui.toast('一句话')：弹一条吐司提示（轻量的告知；需要用户做动作的用 ask）。
- api.ui.point(path?, { line?, regex?, flags? })：在页签里打开/切到某个节点的文档
  （path 规则与 doc.* 一致，省略 = 当前节点的教学文档）。line 定位到某一行，
  regex 选中第一处匹配的文字——「我说的就是这一段」时用它指给用户看。
- api.ui.superdoc(path?, name)：打开/切到某节点的一份超级文档页签
  （sdoc.write 写完用它展示给用户；那份文档已被删时回执会说明，别再指给用户看）。
- api.ui.scroll({ to: 'top' | 'bottom' } 或 { by: 像素 })：滚动文档区（by 负数往上）。
- api.ui.screenshot()：截取文档区，图片会附在你的下一步里（与 res.read 读图同一条通道；
  截图同时存进了资源库，res.list 看得到）。讲解里想引用它：![说明](moji:static/uuid)。
- api.ui.dom(async (root) => { … })：回调拿到文档区根节点的**门面**，可以查看渲染结果、
  点文档里的按钮：root.query(sel) / root.exists(sel) / root.count(sel) / root.text(sel, i?) /
  root.attr(sel, name, i?) / root.html(sel, i?) / root.rect(sel, i?) / root.click(sel, i?)。
  全是异步的（每个操作回到宿主执行）；适合「确认渲染成了什么样」「帮用户展开某个面板」，
  不要拿来批量轮询。`,
  },
  {
    key: 'plot-forms',
    title: '函数图像的数据形态',
    text: `函数图像的 data 各形态（\`\`\`plot 的完整数据写法）——这份规范在你第一次写函数图像时注入。data 数组每项取下列形态之一（points / parametric / polar / implicit 必须写 graphType，否则会当成区间采样而报错）：
1) 显式函数：{ "fn": "x^2" }
   可加切线：{ "fn": "x^2", "derivative": { "fn": "2*x", "x0": 1 } }
   可加割线：{ "fn": "x^2", "secants": [{ "x0": 0, "x1": 1 }] }
   可指定颜色：{ "fn": "sin(x)", "color": "#a8432f" }
2) 参数曲线（变量用 t）：{ "graphType": "polyline", "fnType": "parametric", "x": "cos(t)", "y": "sin(t)" }
3) 极坐标（变量用 theta）：{ "graphType": "polyline", "fnType": "polar", "r": "1 + cos(theta)" }
4) 散点：{ "graphType": "scatter", "fnType": "points", "points": [[1, 1], [2, 4]] }
5) 向量：{ "graphType": "polyline", "fnType": "vector", "vector": [2, 1], "offset": [0, 0] }
6) 隐函数（用 interval 采样，需同时给 graphType 与 fnType）：
   { "graphType": "interval", "fnType": "implicit", "fn": "x^2 + y^2 - 1" }

其余写法要求：
- 表达式里只能用数学函数与四则运算，不要出现浏览器对象或函数定义。
- 图像默认不可缩放（避免在文档里滚动时误触），需要交互缩放时加 "disableZoom": false。`,
  },
  {
    key: 'rich-animation',
    title: '富媒体动画写法',
    text: `富媒体动画（SVG SMIL 与内嵌 CSS 动画）——这份规范在你第一次写动画内容时注入。前提规矩不变：Markdown 能表达的一律用 Markdown；动画要克制，同一屏最多一两个，服务于讲解本身，不做装饰性干扰。
- SVG 内嵌动画（用 SMIL，适合「动起来才看得懂」的过程：波的传播、向量旋转、
  极限逼近、函数变换）。可用 <animate>、<animateTransform>、<animateMotion>、<set>，
  并为动画加上 repeatCount="indefinite" 让它循环：
  <svg viewBox="0 0 200 60"><circle r="6" fill="#a8432f">
    <animateMotion dur="3s" repeatCount="indefinite" path="M10,30 L190,30"/></circle></svg>
- 内嵌 CSS 动画（用 <style> 定义 @keyframes 做持续运动；适合脉冲、高亮、旋转）：
  <style>.moji-demo-pulse{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}</style>
  <span class="moji-demo-pulse">正在闪烁的要点</span>
- 内嵌 <style> 里的每条选择器都必须带一个本项目独有的前缀（如 .moji-demo-xxx），
  避免样式泄漏到页面其它位置；建议每个动画用不同的前缀。
- SVG 里给 fill / stroke 用具体颜色或 currentColor，深色与浅色模式下都要能看清
  （不要只用纯黑或纯白）。
- 内嵌 HTML 必须闭合良好；不确定能否渲染的写法就退回纯 Markdown。`,
  },
]

const MODULE_BY_KEY = new Map(PROMPT_MODULES.map((m) => [m.key, m]))

export function promptModuleByKey(key: string): PromptModule | null {
  return MODULE_BY_KEY.get(key) ?? null
}

/**
 * api 名 → 模块 key 的触发映射：按组前缀（doc.write → doc），顶层名（wait / ask）用名字本身。
 * 只有「规范搬进了模块」的组才在这里；doc / node / state / ask 这些每轮必用的组不触发注入。
 */
const GROUP_MODULE: Record<string, string> = {
  sdoc: 'sdoc',
  browser: 'browser',
  web: 'web',
  res: 'res',
  exam: 'exam',
  reading: 'learning-process',
  attention: 'learning-process',
  checkin: 'learning-process',
  pomodoro: 'learning-process',
  review: 'review',
  workspace: 'workspace',
  method: 'method',
  code: 'code',
  compact: 'compact',
  subagent: 'subagent',
  ui: 'ui',
}

export function promptModuleForApiName(name: string): string | null {
  const dot = name.indexOf('.')
  const group = dot < 0 ? name : name.slice(0, dot)
  return GROUP_MODULE[group] ?? null
}

/**
 * 写入内容里的标记 → 模块 key（内容触发）：模型写出 ```plot 图像或 SMIL / @keyframes
 * 动画时，对应的数据形态 / 动画写法模块就该在场。宿主在 execute 的 doc / sdoc 写入
 * 参数上嗅探（见 sandbox/execute 的 callApi）。
 */
export function promptModuleForContent(content: string): string[] {
  const out: string[] = []
  if (content.includes('```plot')) out.push('plot-forms')
  if (content.includes('<animate') || content.includes('@keyframes')) out.push('rich-animation')
  return out
}

/**
 * 从一次写入调用的参数里取出要嗅探的正文（供内容触发用，见 sandbox/execute 的 callApi）：
 * doc.write / doc.append 的第二个参数、doc.replace 的 payload.content、sdoc.write 的 html。
 * 其余调用（读、删、改节点……）不携带可嗅探的正文，回 null。
 */
export function writableContentOf(name: string, args: unknown[]): string | null {
  if (name === 'doc.write' || name === 'doc.append') return typeof args[1] === 'string' ? args[1] : null
  if (name === 'doc.replace') {
    const payload = args[1]
    const content =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>).content : undefined
    return typeof content === 'string' ? content : null
  }
  if (name === 'sdoc.write') return typeof args[2] === 'string' ? args[2] : null
  return null
}

/**
 * 去重判据：keys 里哪些模块**还没有**出现在活着的上下文里。
 *
 * 两种形态都算「已注入」：
 * - 回复里的 prompt-module 片段（mid-loop 边界注入，见 agent/types）；
 * - 轮开始时注入的独立隐藏消息（工作流触发，字段在消息上）。
 * 只统计 !retired——被压缩折掉的不再进上下文，必须允许重新注入
 * （与 needsPersonaAnnounce 的判据同一口径）。
 * 调用方传的消息列表必须与「这次请求真正会发的历史」同源（同一份 Conversation.messages）。
 */
export function missingPromptModules(messages: ConversationMessage[], keys: string[]): string[] {
  const alive = new Set<string>()
  for (const m of messages) {
    if (m.retired) continue
    if (m.promptModule) alive.add(m.promptModule)
    for (const p of m.parts) {
      if (p.type === 'prompt-module') alive.add(p.key)
    }
  }
  return [...new Set(keys)].filter((k) => !alive.has(k))
}

/**
 * 一条模块消息：隐藏 user 消息，mark 画成界面上可展开的分界条，promptModule 供去重。
 * 与 personaMessage 同一个形状家族——它进模型上下文、不显示气泡正文（展开看全文）。
 */
export function promptModuleMessage(mod: PromptModule, uuid: string, at: number): ConversationMessage {
  return {
    id: uuid,
    role: 'user',
    parts: [{ type: 'text', text: mod.text }],
    ts: at,
    hidden: true,
    mark: t('提示词模块 · {0}', mod.title),
    promptModule: mod.key,
  }
}
