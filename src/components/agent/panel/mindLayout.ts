/**
 * 思维页右侧状态面板的显示判据。
 *
 * 页宽按 AgentSlot 量到的整块智能体页面宽度算：宽到 1400 才分左右两栏，
 * 否则右侧面板会把消息列压得比原来还窄，直接隐藏让它独占。
 */
export const MIND_INSPECTOR_MIN_WIDTH = 1400

export function mindInspectorVisible(mode: 'chat' | 'mind', pageWidth: number): boolean {
  return mode === 'mind' && pageWidth >= MIND_INSPECTOR_MIN_WIDTH
}
