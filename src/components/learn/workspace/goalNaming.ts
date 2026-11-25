/**
 * 新建学习目标的默认名：用户不再输入标题，编号在现有「新目标 [n]」里递增。
 * 兼容旧格式（圆括号 / 全角括号），取现有最大编号 +1。
 */

export function nextDefaultGoalTitle(goals: readonly { title?: string }[]): string {
  let max = 0
  for (const goal of goals) {
    const m = /^新目标\s*[\[(（]\s*(\d+)\s*[\])）]$/.exec(goal.title ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `新目标 [${max + 1}]`
}
