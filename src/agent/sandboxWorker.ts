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
  // 节点：列 / 看 / 路径 / 建 / 改 / 注解 / 删 / 移（一次编排可以同时操作多个节点）
  'node.list',
  'node.read',
  'node.paths',
  'node.create',
  'node.title',
  'node.rename',
  'node.update',
  'node.annotate',
  'node.delete',
  // 迁移节点到另一个节点之下（改父线；见 graph/nodes 的 moveNode）
  'node.move',
  // 目标级持久化函数：创建 / 列出 / 删除 / 执行
  'method.list',
  'method.create',
  'method.delete',
  'method.call',
  // 工作流触发与列表（登记管理统一收敛为 files.*）
  'wf.list',
  'wf.get',
  'wf.invoke',
  // 代码块伪编译：交付转译好的 JS（key 由代码块的菜单给，见 lib/codeArtifacts）
  'code.save',
  // 同上：判定「这段代码没有输出」，当场停止编译并标记那一块
  'code.silent',
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
  // 页签日志与直发请求（采集在主进程 CDP，缓冲/折叠见 shared/webLogs；tabId 必给）
  'browser.logs',
  'browser.logDetail',
  'browser.fetch',
  'browser.record',
  // 区域文本与滚动（SPA 上「按区域取文本」和「无限滚动」的两块拼图；tabId 必给）
  'browser.text',
  'browser.scroll',
  // 等条件成立（selector/text/urlIncludes/networkIdle/load）——「wait 再取还是空」循环的替代品
  'browser.waitFor',
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
  // 引用 chip：生成与交付前自查（手拼的 path 定位不到，见 learn/ops/chip）
  'chip.build',
  'chip.check',
  // 人机协作与界面：ask 会阻塞到用户提交，wait 是合法的「慢」（超时按空闲算）
  'wait',
  'ask',
  'tiktok',
  'ui.toast',
  'ui.point',
  'ui.scroll',
  'ui.screenshot',
  'ui.superdoc',
  // ui.dom 特殊：回调无法穿过 Worker 边界，Worker 侧特判成「建会话 + 逐个操作」
  'ui.dom',
  // 基础系统文件操作：真实路径读写与管理 (files.*)
  'files.read',
  'files.write',
  'files.edit',
  'files.list',
  'files.stat',
  'files.mkdir',
  'files.copy',
  'files.move',
  'files.delete',
  // 基础系统进程任务：生命周期绑定与增量输出 (process.*)
  'process.create',
  'process.start',
  'process.status',
  'process.output',
  'process.stop',
  'process.list',
  'process.get',
  'process.delete',
  // 自描述能力索引
  'help',
]

export const SANDBOX_API_NAMES = API_NAMES

/** 可直接交给 new Blob([...]) 的完整脚本 */
export const SANDBOX_SOURCE = raw.replace('__API_NAMES__', JSON.stringify(API_NAMES))
