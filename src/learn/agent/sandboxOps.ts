/**
 * 这个文件负责「学习 store 上的沙箱能力」及它需要的类型：一轮对话冲着谁跑（AgentRunTarget）、
 * 界面侧注入的能力（AgentUiDeps）、整套沙箱 api 的装配（learnSandboxOps），
 * 以及表单答案当场落进画像的 applyAskToProfile。
 *
 * 从 learn/useAgent 拆出（见 docs/refactor-plan.md 3.8）。
 */

import type { AskAnswers, AskFormPayload, UiPointRequest, UiScrollRequest } from '../../agent/tools'
import { createAgentOps, type AgentOps } from '../agentOps'
import type { LearnStore } from '../types'
import { loadImageByRel } from '../static'
import { readUserText, removeUserPath, userPath, writeUserText } from '../../lib/storage'
import { native } from '../../lib/native'
import { fetchForAgent, readForAgent } from '../webDocs'
import { tmpEntriesOf, withTmpEntries } from '../../lib/tmpStore'
import { activeProfile, activeUser, updateUser } from '../../user/store'
import { patchFromAnswers } from '../../user/fields'

export interface AgentRunTarget {
  /** 上下文归属的目标：一个目标一份对话，目标下所有节点共用 */
  goalId: string
  /** 这一轮冲着哪个节点来：它是沙箱里的「当前节点」，也是考试工具作用的对象 */
  nodeId: string
  conversationId: string
}

/**
 * 界面侧的能力（ui.* 与截图）：由学习工作区注入（openTab、两栏交换、文档区 DOM
 * 都在那儿）。不注入就没有 ui 这一组——沙箱里调了会得到「沙箱里没有这个 api」。
 */
export interface AgentUiDeps {
  switchMain?: (main: 'agent' | 'doc') => void
  /** 打开/切换到某个节点的文档并定位（path 已由工具层解析好） */
  point?: (req: UiPointRequest) => Promise<{ located: boolean }> | { located: boolean }
  scroll?: (req: UiScrollRequest) => void
  /** 截下文档区：返回 PNG data URL，转存进资源库由这里统一做 */
  captureDoc?: () => Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }>
  /** ui.dom 的根（文档区元素）；没有打开的文档时返回 null */
  domRoot?: () => Element | null
  /** 吐司（ui.toast）；界面没给就回落到对话栏自己的提示通道 */
  toast?: (message: string) => void
  /** 打开/切到某节点的一份超级文档页签（ui.superdoc）；opened 说明那份还在不在 */
  openSuper?: (req: { nodeId: string; name: string }) => Promise<{ opened: boolean }> | { opened: boolean }
}

/**
 * 组装「学习 store 上的全部沙箱能力」（createAgentOps + 磁盘 + 临时变量视图）。
 *
 * 抽出来是因为它有**两个调用方**：一轮对话（runTurn → createExecuteTool）与
 * 超级文档的桥（LearnWorkspace → buildStandaloneApi 建常驻 api，执行 method 函数）。
 * 两边必须看到同一套能力，分两处装配迟早会对不齐。
 *
 * 关键性质：返回的对象不持有任何 store 快照——每个 api 都现取 deps.getLatest()，
 * 所以常驻 api 建一次就够了（见 agent/tools 的 buildStandaloneApi）。
 */
export function learnSandboxOps(deps: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  /** 沙箱里的「当前节点」：path 省略时的落点 */
  nodeId: () => string | null
  /** 会话与 path 的基准目标 */
  goalId: () => string
}): AgentOps {
  return createAgentOps({
    getLatest: deps.getLatest,
    set: deps.set,
    nodeId: deps.nodeId,
    goalId: deps.goalId,
    /**
     * 资源库的磁盘能力。图片走 loadImageByRel：与聊天气泡共用同一份缓存，
     * 同一张图既挂在消息里、又被文档引用时只读一次盘。
     */
    resourceIo: {
      // 资源路径是「相对当前用户」的（docs/{目标}/static/…）：
      // 这里必须用 *User* 那一组，否则文件会落到 {root}/docs 下、与清单分家
      readText: readUserText,
      writeText: writeUserText,
      readImage: loadImageByRel,
      remove: removeUserPath,
    },
    /**
     * 工作区目录的磁盘能力（users/<uid>/workspace/…，见 learn/workspace）：路径是
     * 「相对当前用户」的，uid 前缀在这里补一次（与资源库同一条纪律）。直接走
     * native 的 storage:list/read/write——错误原样透传，模型要靠它把路径改对。
     */
    workspaceIo: {
      list: (rel) => {
        const p = userPath(rel)
        return p ? native().storage.list(p) : Promise.resolve({ ok: false as const, error: '当前没有登录用户' })
      },
      read: (rel) => {
        const p = userPath(rel)
        return p ? native().storage.read(p) : Promise.resolve({ ok: false as const, error: '当前没有登录用户' })
      },
      write: (rel, content) => {
        const p = userPath(rel)
        return p ? native().storage.write(p, content) : Promise.resolve({ ok: false as const, error: '当前没有登录用户' })
      },
    },
    /**
     * 学习者画像的读写：落在 user/store（当前用户那份 user.yaml，见 user/fields）。
     *
     * 为什么就地取、不叫调用方传：learnSandboxOps 有两个调用方（一轮对话、超级文档的
     * 桥），画像必须是同一份——多传一层就多一处「忘记传于是 agent 读不到画像」的机会。
     */
    userInfo: {
      read: () => activeProfile(),
      update: async (patch) => {
        const uid = activeUser()?.id
        // updateUser 回的是整条 User；这一层只要画像（沙箱里也只认画像）
        const next = uid ? await updateUser(uid, patch) : null
        return next?.profile ?? null
      },
    },
    /**
     * 读网页：抓取走主进程（渲染层的 fetch 受同源策略约束），正文提取在渲染层，
     * 落盘在当前用户的 users/<uid>/web/ 下（见 learn/webDocs）。
     */
    web: { fetch: fetchForAgent, read: readForAgent },
    // 临时变量按「此刻的当前节点」存取：agent 轮次里是这一轮的节点，超级文档桥里是界面当前节点
    tmp: () => {
      const nid = deps.nodeId() ?? ''
      return {
        nodeId: nid,
        entries: tmpEntriesOf(deps.getLatest(), nid),
        onChange: (next) => deps.set(withTmpEntries(deps.getLatest(), nid, next)),
      }
    },
  })
}

/**
 * 用户提交表单之后：把「标了 userInfo 的那些题」的答案直接写进画像。
 *
 * 为什么放在这一步、而不是让导师自己 update：这是这份答案唯一一次既是最新的、
 * 又还没经过模型转述的时刻。让导师拿到答案再写一遍，等于同一件事说两遍，而且
 * 转述会走样（「本科」写成「大学本科学历」、「大三」写成「本科在读三年级」）。
 *
 * 写不进去都不算什么大事：没有当前用户、或写盘失败——回执里说清楚，导师自己决定
 * 要不要用 api.userInfo.update 补一次。取消表单（cancelled）时一个字都不写。
 */
export async function applyAskToProfile(form: AskFormPayload, value: unknown): Promise<unknown> {
  const v = value as { cancelled?: boolean; answers?: AskAnswers } | null
  if (!v || v.cancelled || !Array.isArray(v.answers)) return value
  const mapped = patchFromAnswers(form.questions, v.answers)
  if (!mapped.applied.length && !mapped.skipped.length) return value

  const uid = activeUser()?.id
  const saved = uid && mapped.applied.length ? !!(await updateUser(uid, mapped.patch)) : false
  const savedText = mapped.applied.map((a) => a.label + '（' + a.value + '）').join('、')
  return {
    ...v,
    ...(mapped.applied.length ? { profileSaved: saved ? mapped.applied.map((a) => a.label + '=' + a.value) : [] } : {}),
    ...(mapped.skipped.length ? { profileSkipped: mapped.skipped.map((s) => s.label + '：' + s.reason) } : {}),
    note:
      (mapped.applied.length
        ? saved
          ? '其中 ' + savedText + ' 已经**直接写进学习者画像**了，不需要你再 api.userInfo.update。'
          : '标了 userInfo 的答案没能存进画像（没有当前用户，或写盘失败），需要的话用 api.userInfo.update 再写一次：' + savedText + '。'
        : '') +
      (mapped.skipped.length
        ? '没写进画像的：' + mapped.skipped.map((s) => s.label + '（' + s.reason + '）').join('；') + '。'
        : ''),
  }
}
