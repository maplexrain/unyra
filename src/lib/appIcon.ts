/**
 * 应用图标的运行时换色：把 logo.svg 染成当前主题的强调色，经主进程设为
 * 窗口（任务栏 / Alt-Tab）与托盘图标。
 *
 * 分工是这样的：主进程没有 DOM、nativeImage 也解不了 SVG，所以**染色画在渲染层**——
 * SVG 原文由主进程从 dist（开发时 public）读回来，替换印章红为当前强调色，
 * 画进 canvas 导出 PNG data URL 交回去。data: URL 不污染画布，toDataURL 不会被拒。
 * 设计源仍只有 public/logo.svg 一份（npm run icons 也从它生成安装包图标）。
 *
 * 尽力而为：任何一步失败（SVG 读不到、画布不可用、主进程不可用）都静默放弃，
 * 任务栏停留在默认的印章红——图标颜色是锦上添花，不值得为它打断任何人。
 * 同一颜色的染色结果按 color 缓存，主题来回切换不重画。
 */
import { isElectron, native } from './native'

let logoSource: Promise<string> | null = null
const tinted = new Map<string, Promise<string>>()

/**
 * 染色画布的边长。
 *
 * 64 而不是 256：这张图只喂给任务栏（16/32px）与托盘（16px，见主进程的 resize），
 * 多出来的像素一个都用不上。导出 PNG 的代价随面积走，256² 是 64² 的 16 倍——
 * 而这一段是**启动路径**上的同步工作（画在渲染层、经主进程 setIcon），
 * 实测从 256 降到 64 后这一步从 ~76 ms 掉到 ~10 ms。
 */
const ICON_PX = 64

function tintedIcon(color: string): Promise<string> {
  const hit = tinted.get(color)
  if (hit) return hit
  const job = (async () => {
    const raw = (logoSource ??= native().window.logoSource())
    const source = (await raw).replace(/#A23A24/gi, color)
    const image = new Image()
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source)
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ICON_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 不可用')
    /*
     * 目标矩形必须给全。logo.svg 的固有尺寸是 256×256，只写 (0, 0) 时浏览器按
     * **固有尺寸**往画布上画，64×64 的画布只留下左上角那一块——托盘上于是顶着
     * 一小片残图（任务栏同理）。给全四个参数就与 SVG 自己多大无关了：画布多大
     * 就铺多大，以后改 ICON_PX 也不会再错。
     */
    ctx.drawImage(image, 0, 0, ICON_PX, ICON_PX)
    return canvas.toDataURL('image/png')
  })()
  // 失败的染色不缓存：可能是启动太早（SVG 还读不到），下次再试
  job.catch(() => tinted.delete(color))
  tinted.set(color, job)
  return job
}

/** 把当前强调色应用到窗口与托盘图标；非 Electron 环境（单测等）直接跳过 */
export async function syncAppIcon(color: string): Promise<void> {
  if (!isElectron()) return
  try {
    await native().window.setAppIcon(await tintedIcon(color))
  } catch {
    // 尽力而为（见上）
  }
}
