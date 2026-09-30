/**
 * 学习场景的两处提示词：
 * 1. buildTeacherSystem —— 教学 Agent 的系统提示词。**只描述目标，不含当前节点**：
 *    上下文是目标级的，此刻在哪个节点由每条消息带着走（见 useAgent 的 currentNodeBlock）。
 * 2. generateShortAnnotation —— 「了解」那种一两句话的就地释义。
 *
 * 节点的标题与描述不再由这里代劳：新建节点时不再先发一次「生成描述」的模型请求，
 * 而是把这件事写进 Agent 的隐藏指令（见 learn/workflows 的「开讲」内置工作流）。
 * 用户点一下就立刻建出节点，不必先盯着空文档等一次模型往返。
 *
 * **画像不进系统提示词**（2026-09 改）：用户改一次资料，这段前缀就整段作废，而多数轮次
 * 根本用不到画像里的任何一项。现在改成导师主动取——api.userInfo.get()（见下面
 * EXECUTE_GUIDE 的「学习者画像」一节），提示词只与学习目标相关，前缀才稳得住。
 * 另一处用到画像的是 generateShortAnnotation（「了解」那种一次性释义）：那次请求没有工具、
 * 没法自己取，画像只能由调用方递进来——它目前没有调用方，留着是给那条路用的。
 *
 * 这个文件负责什么：learn 这一层与「AI 生成」有关的两个入口（对外 barrel）——实现按职责放在
 * learn/ai/ 下，这里只把原来的两个导出原样转出去，调用方（learn/useAgent、tests/persona）零改动。
 * - ai/executeGuide.ts  execute 工具的用法说明（提示词里最长的一节）
 * - ai/guides.ts        其余几段写作指南（富内容、目标大纲、两种链接语法、学习状态）
 * - ai/teacherSystem.ts 教学 Agent 的系统提示词
 * - ai/annotation.ts    「了解」那种一两句话的就地释义
 */

export { generateShortAnnotation } from './ai/annotation'
export { buildTeacherSystem } from './ai/teacherSystem'
