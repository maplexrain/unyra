/**
 * 导师声部（tutor）的系统提示词 = **共同前缀（SHARED_AGENT_PREFIX，P0）+ 共用排版与视觉规范
 * + 固定组 API 速查 + 非固定组 API 速查 + 导师专属区（P1）**。
 *
 * 顺序纪律（用户定稿）：越不可变越靠前——P0 在最前（七兄弟总纲 / 团队协作 / execute 机制 /
 * 先查再用 / 应用数据守门 / 沙箱纪律 / 通用纪律 / compact 规程）；紧接着是**内容声部共用排版
 * 规范**（导师 / 出卷 / 设计逐字节一致）、**固定组 API**（六位执行声部逐字节一致的执行基座）
 * 与**非固定组 API**（导师职责面），然后才进入身份定位 / 分工 / 专用语法 / 工作流 / 纪律。
 * 会话内会变的信息（人格 / 画像 / 技能）不进系统提示词。
 *
 * 文案与分段由 promptSections 统一装配（voiceCopy + typographyGuide + apiPromptSections），
 * 这里只做拼接——设置页预览与运行期发出的提示词是同一份，不再各写一遍。
 */
import { getAgentPromptSections, joinPromptSections } from './promptSections'

/**
 * 导师声部的系统提示词。**完全固定**：同样的代码永远产出同样的字节。
 */
export function buildTeacherSystem(opts: {
  /** 学习者额外追加的自定义系统提示词（启用时追加在末尾） */
  extraSystemPrompt?: string
} = {}): string {
  return joinPromptSections(getAgentPromptSections('tutor', opts))
}
