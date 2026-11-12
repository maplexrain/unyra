import { ipcRenderer } from 'electron'
import type {
  TtsModelStatus,
  TtsDownloadResult,
  TtsModelProgress,
  TtsSynthesizeRequest,
  TtsSynthesizeResult,
} from '../../shared/ipc'

export const ttsPreload = {
  modelStatus: (): Promise<TtsModelStatus> => ipcRenderer.invoke('tts:modelStatus'),
  downloadModel: (): Promise<TtsDownloadResult> => ipcRenderer.invoke('tts:downloadModel'),
  cancelDownload: (): Promise<boolean> => ipcRenderer.invoke('tts:cancelDownload'),
  removeModel: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('tts:removeModel'),
  revealModel: (): Promise<boolean> => ipcRenderer.invoke('tts:revealModel'),
  synthesize: (req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> =>
    ipcRenderer.invoke('tts:synthesize', req),
  onModelProgress: (cb: (p: TtsModelProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: TtsModelProgress) => cb(p)
    ipcRenderer.on('tts:modelProgress', listener)
    return () => ipcRenderer.removeListener('tts:modelProgress', listener)
  },
}
