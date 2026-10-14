/**
 * 注册 mcp:* 的主进程 IPC 通道（stdio 传输的本地 MCP 会话，见 ./stdio）。
 *
 * 三个频道：
 * - `mcp:discover` —— 起（或复用）会话，回工具清单；
 * - `mcp:call`     —— 调用一个工具，回服务端的 content/isError；
 * - `mcp:stop`     —— 停掉某个服务（或全部）的会话：设置里禁用 / 删除服务时来一发，
 *                     不留下已经没人会用的子进程（配置改了不用调它——指纹变了自然重起）。
 *
 * 与 base/storage 这些模块同一套约定：handler 只做转发，逻辑在 stdio.ts；
 * 「当前用户 / 工作目录 / 应用版本」这些 electron 侧的上下文在这里注入。
 */
import { app, ipcMain } from 'electron'
import { currentRoot } from '../storage'
import { cleanupAllMcpSessions, mcpStdioCall, mcpStdioDiscover, stopMcpSessions } from './stdio'
import type { McpStdioCtx } from './stdio'
import type { McpStdioServerPayload, StorageOk } from '../../shared/ipc'

/** 一次调用所需的上下文：cwd 用数据根目录（相对参数如 ./workspace 有明确落点） */
function ctx(): McpStdioCtx {
  return { cwd: currentRoot(), clientVersion: app.getVersion() }
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:discover', (_e, server: unknown) =>
    mcpStdioDiscover(server as McpStdioServerPayload, ctx()),
  )
  ipcMain.handle('mcp:call', (_e, server: unknown, tool: unknown, args: unknown) =>
    mcpStdioCall(server as McpStdioServerPayload, String(tool ?? ''), args, ctx()),
  )
  ipcMain.handle('mcp:stop', (_e, serverId: unknown): StorageOk => {
    stopMcpSessions(typeof serverId === 'string' && serverId ? serverId : undefined)
    return { ok: true }
  })
}

export { cleanupAllMcpSessions }
