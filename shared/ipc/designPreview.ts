/** 设计预览内置 HTTP 服务的状态（主进程 → 渲染层）。 */
export interface DesignPreviewStatus {
  running: boolean
  port: number
  url: string
  fileCount: number
  error?: string
}
