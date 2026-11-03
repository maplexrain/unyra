/**
 * 「赞助者名单」页签打开器。
 * 供顶栏赞助按钮、设置页等处在应用内直接打开致谢名单页签。
 */

let opener: (() => void) | null = null

export function setSponsorsOpener(fn: (() => void) | null): void {
  opener = fn
}

/** 打开赞助者名单页签（若未挂载则静默） */
export function openSponsorsTab(): void {
  opener?.()
}
