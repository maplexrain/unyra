/**
 * 沙箱脚本的来源。
 *
 * 真正的运行时代码放在 sandboxRuntime.js（纯 JavaScript），这里只做一件小事：
 * 注入 api 的名字清单，然后交给 tools 塞进 Blob 交给 Worker。
 *
 * 为什么不让运行时代码躺在模板字符串里：浏览器按 JS 解析那段字符串，
 * 一旦混进 TypeScript 语法（哪怕只是 let x: unknown），Worker 会一启动就抛
 * SyntaxError，而且报错位置指向别处。单独放 .js 后，构建器会检查它的语法。
 */
import raw from './sandboxRuntime.js?raw'

/** 沙箱里可用的 api；顺序无所谓，Worker 会按点号拆成 api.<组>.<方法> */
const API_NAMES = [
  // 文档：全部按 path 寻址（path 省略 = 当前节点的教学文档）
  'doc.read',
  'doc.readRange',
  'doc.find',
  'doc.write',
  'doc.replace',
  'doc.append',
  // 注解：在正文上划一条词条注解（挂在节点上，一个词一条；见 learn/agentOps 的 annotate）
  'doc.annotate',
  // 节点：列 / 看 / 建 / 改 / 删 / 移（一次编排可以同时操作多个节点）
  'node.list',
  'node.read',
  'node.create',
  'node.title',
  'node.rename',
  'node.update',
  'node.delete',
  // 迁移节点到另一个节点之下（改父线；见 graph/nodes 的 moveNode）
  'node.move',
  // 目标大纲：结构化的计划（导语 + 一层子目标），页签里打开是交互页面（见 learn/outline）
  'outline.read',
  'outline.write',
  // 描述：实际上是 node.update 的便捷写法，保留旧名免得模型改不过来
  'description.read',
  'description.update',
  'exam.create',
  'exam.read',
  'exam.grade',
  // 错题讲解：判分之后的第二步，落在同一次考试上
  'exam.explain',
  'exam.delete',
  // 学习状态：自评 / 掌握度 / 错误记忆 / 检验记录（见 learn/learning）
  'state.read',
  'state.update',
  'state.mistake',
  'state.forget',
  'state.check',
  'tmp.set',
  'tmp.get',
  'tmp.has',
  'tmp.del',
  'tmp.list',
  'tmp.clear',
  // 资源库：本目标 static/ 下的文件（见 learn/static）
  'res.list',
  'res.info',
  'res.read',
  'res.create',
  'res.update',
  'res.delete',
  'res.refs',
  // 长期记忆：跨对话有效，但**不会**自动进上下文（见 learn/mind）
  'mind.list',
  'mind.read',
  'mind.write',
  'mind.delete',
  'mind.clear',
  // 目标级持久化函数：method.call 会把当前编排的 api 注入给那份持久化的源码（见 learn/methods）
  'method.create',
  'method.list',
  'method.call',
  'method.delete',
  // 超级文档：绑定节点的可交互 HTML（见 learn/superdocs）
  'sdoc.list',
  'sdoc.read',
  'sdoc.write',
  'sdoc.delete',
  // 工作流登记表：管理（看/登记/删）；触发永远由用户在界面上点，没有 wf.run（见 learn/workflows）
  'wf.list',
  'wf.create',
  'wf.remove',
  // 代码块伪编译：交付转译好的 JS（key 由代码块的菜单给，见 lib/codeArtifacts）
  'code.save',
  // 同上：判定「这段代码没有输出」，当场停止编译并标记那一块
  'code.silent',
  // 学习者画像：**不在系统提示词里**，要用得自己 get（见 user/fields 与 learn/agentOps）
  'userInfo.get',
  'userInfo.update',
  // 学习过程：有效阅读的事实、注意力评级、打卡、番茄钟（见 learn/reading 等）
  // 打卡没有「直接成功」的口子：status 给资格与题源，settle 记结果且系统复核门槛；
  // 番茄钟只有一个只读的 status——开始、停止、改时长都是用户按顶栏那颗按钮
  'reading.get',
  'reading.list',
  'reading.day',
  'attention.get',
  'checkin.status',
  'checkin.settle',
  // 间隔复习：计划系统建，导师只读计划 / 落账 / 经用户同意后调整（见 learn/review）
  'review.read',
  'review.record',
  'review.merge',
  'review.extend',
  'review.adjust',
  // 工作区目录：节点目录下的真实系统子目录（docs/<目标>/<节点>/workspace/…），只收文本（见 learn/workspace）
  'workspace.list',
  'workspace.read',
  'workspace.write',
  'pomodoro.status',
  // 读网页：抓取在主进程、正文提取在渲染层、落盘在当前用户目录（见 learn/webDocs）
  'web.webFetch',
  'web.read',
  // 多引擎搜索（抓取走同一条主进程通道，解析在渲染层，见 learn/webSearch）
  'web.search',
  // 内置浏览器：网页页签的打开 / 管理 / 快照与阅读 / 受控 DOM 操作 / 截图（见 learn/web/browserOps）
  'browser.open',
  'browser.tabs',
  'browser.activate',
  'browser.close',
  'browser.snapshot',
  'browser.point',
  'browser.dom',
  'browser.read',
  'browser.capture',
  // 子代理管理（导师专用）：并发派出、后台跑、wait 收交付。子代理的 apiAllow 白名单
  // 里永远没有这一组——不递归在通道口硬挡（实现见 agent/subagent/manager）
  'subagent.create',
  'subagent.run',
  'subagent.resume',
  'subagent.intervene',
  'subagent.interrupt',
  'subagent.view',
  'subagent.delete',
  'subagent.wait',
  // 上下文压缩：agent 自己写交接摘要（见 learn/compact）
  'compact',
  // 人机协作与界面：ask 会阻塞到用户提交，wait 是合法的「慢」（超时按空闲算）
  'wait',
  'ask',
  'iwanna',
  'tiktok',
  'ui.switchMain',
  'ui.toast',
  'ui.point',
  'ui.scroll',
  'ui.screenshot',
  'ui.superdoc',
  // ui.dom 特殊：回调无法穿过 Worker 边界，Worker 侧特判成「建会话 + 逐个操作」
  'ui.dom',
]

export const SANDBOX_API_NAMES = API_NAMES

/** 可直接交给 new Blob([...]) 的完整脚本 */
export const SANDBOX_SOURCE = raw.replace('__API_NAMES__', JSON.stringify(API_NAMES))
