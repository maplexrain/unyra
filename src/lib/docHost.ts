/**
 * 「这块代码归谁管」：代码块菜单与超级导师之间的那一根线。
 *
 * 编译**不是**菜单自己发一次模型请求，而是请超级导师跑一条工作流（见 learn/workflows 的
 * 「伪编译」）：指令以一条 user 消息进对话，导师自己读文档、自己做、自己在对话里说明结果，
 * 产物用 api.code.save 交回宿主。菜单这一侧因此只回答两件事：**这里能不能编译**、
 * **替我发一次请求**。
 *
 * 为什么用模块级注册表而不是一路 props 传下去：菜单是渲染期命令式挂进 DOM 的
 * （见 lib/codeBlockMenu），它不在组件树里；而「谁能跑工作流」只有学习区那一层知道
 * （要用 useAgent 的 runWorkflow）——props 传不到那儿。这与 lib/quoteFocus 的
 * setQuoteFocusHandler 是同一种做法。
 *
 * 谁注册：LearnWorkspace。学习区一卸载就注销，于是「没有超级导师在场」的地方
 * （AI 对话里的代码块、试卷副本、超级文档 iframe）自然拿不到 host——
 * 菜单据此把「编译」按住不点，而不是点了没反应。
 */
export interface CodeCompileRequest {
  /** 「语言 + 代码内容」的指纹（见 lib/codeArtifacts 的 beginCompile） */
  key: string
  code: string
  languageId: string | null
}

export interface CodeHost {
  /**
   * 请导师编译这段代码。**没有返回值**：请求发出去之后就是对话那一侧的事了，
   * 产物经 api.code.save 异步回到产物表（菜单订阅它，见 lib/codeArtifacts）。
   * 发不出去的情形（没配 Key、没有当前节点…）由宿主自己 toast 给用户——
   * 提示语属于界面那一层，菜单不该再抄一份。
   */
  compile: (req: CodeCompileRequest) => void
}

let host: CodeHost | null = null
const listeners = new Set<() => void>()

/**
 * 登记 / 注销宿主，并叫醒订阅者。
 *
 * 为什么要通知：菜单挂载的时机**早于**学习区注册宿主（子组件的 layout effect 先跑），
 * 若只看挂载那一刻的 codeHost()，启动后打开的第一份文档里那颗「编译」会永远是灰的——
 * 之后没有任何事件会去重画它。订阅一下，两边谁先到都不影响最终状态。
 */
export function setCodeHost(next: CodeHost | null): void {
  if (host === next) return
  host = next
  for (const cb of listeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[coderun] 编译宿主订阅者出错', err)
    }
  }
}

export const codeHost = (): CodeHost | null => host

export function subscribeCodeHost(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
