/**
 * 注册 base.files.* 与 base.process.* 的主进程 IPC 通道。
 */
import { BrowserWindow, ipcMain } from 'electron'
import {
  baseFileCopy,
  baseFileDelete,
  baseFileEdit,
  baseFileList,
  baseFileMkdir,
  baseFileMove,
  baseFileRead,
  baseFileStat,
  baseFileWrite,
} from './files'
import {
  baseProcessCreate,
  baseProcessDelete,
  baseProcessGet,
  baseProcessList,
  baseProcessOutput,
  baseProcessStart,
  baseProcessStatus,
  baseProcessStop,
  cleanupAllProcesses,
} from './process'
import { syncAllowedDirs } from './permissions'
import type { BaseProcessCreateOpts } from '../../shared/ipc'

function broadcastFileChanged(filePath: string, action: 'write' | 'edit' | 'delete', content?: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('base:files:changed', { path: filePath, action, content })
    }
  }
}

export function registerBaseIpc(): void {
  // 权限白名单同步
  ipcMain.handle('base:permissions:sync', (_e, dirs: unknown) => {
    syncAllowedDirs(Array.isArray(dirs) ? dirs.map(String) : [])
    return { ok: true }
  })

  // base.files.* 通道
  ipcMain.handle('base:files:read', (_e, p: unknown, opts: unknown) =>
    baseFileRead(p, opts as { encoding?: 'utf8' | 'base64' | 'binary'; maxBytes?: number }),
  )
  ipcMain.handle('base:files:write', async (_e, p: unknown, content: unknown, opts: unknown) => {
    const res = await baseFileWrite(p, content, opts as { encoding?: 'utf8' | 'base64'; overwrite?: boolean })
    if (res.ok) {
      broadcastFileChanged(String(p ?? ''), 'write', typeof content === 'string' ? content : undefined)
    }
    return res
  })
  ipcMain.handle('base:files:edit', async (_e, p: unknown, opts: unknown) => {
    const res = await baseFileEdit(p, opts as { replace?: { target: string; replacement: string; all?: boolean }; content?: string; start?: number; end?: number })
    if (res.ok) {
      broadcastFileChanged(String(p ?? ''), 'edit')
    }
    return res
  })
  ipcMain.handle('base:files:list', (_e, p: unknown) => baseFileList(p))
  ipcMain.handle('base:files:stat', (_e, p: unknown) => baseFileStat(p))
  ipcMain.handle('base:files:mkdir', (_e, p: unknown) => baseFileMkdir(p))
  ipcMain.handle('base:files:copy', (_e, from: unknown, to: unknown, opts: unknown) =>
    baseFileCopy(from, to, opts as { overwrite?: boolean }),
  )
  ipcMain.handle('base:files:move', (_e, from: unknown, to: unknown) => baseFileMove(from, to))
  ipcMain.handle('base:files:delete', async (_e, p: unknown) => {
    const res = await baseFileDelete(p)
    if (res.ok) {
      broadcastFileChanged(String(p ?? ''), 'delete')
    }
    return res
  })

  // base.process.* 通道
  ipcMain.handle('base:process:create', (_e, opts: unknown) =>
    baseProcessCreate(opts as BaseProcessCreateOpts),
  )
  ipcMain.handle('base:process:start', (_e, id: unknown) => baseProcessStart(String(id ?? '')))
  ipcMain.handle('base:process:status', (_e, id: unknown) => baseProcessStatus(String(id ?? '')))
  ipcMain.handle('base:process:output', (_e, id: unknown, opts: unknown) =>
    baseProcessOutput(String(id ?? ''), opts as { offset?: number; reset?: boolean }),
  )
  ipcMain.handle('base:process:stop', (_e, id: unknown, opts: unknown) =>
    baseProcessStop(String(id ?? ''), opts as { timeoutMs?: number; force?: boolean }),
  )
  ipcMain.handle('base:process:list', () => baseProcessList())
  ipcMain.handle('base:process:get', (_e, id: unknown) => baseProcessGet(String(id ?? '')))
  ipcMain.handle('base:process:delete', (_e, id: unknown) => baseProcessDelete(String(id ?? '')))
}

export { cleanupAllProcesses }
