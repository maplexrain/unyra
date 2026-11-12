import { ipcRenderer } from 'electron'
import type {
  TtsModelStatus,
  TtsDownloadResult,
  TtsModelProgress,
  TtsSynthesizeRequest,
  TtsSynthesizeResult,
} from '../../shared/ipc'

export const ttsPreload = {
  modelStatus: (modelId?: string): Promise<TtsModelStatus> => ipcRenderer.invoke('tts:modelStatus', modelId),
  downloadModel: (modelId?: string): Promise<TtsDownloadResult> => ipcRenderer.invoke('tts:downloadModel', modelId),
  cancelDownload: (): Promise<boolean> => ipcRenderer.invoke('tts:cancelDownload'),
  removeModel: (modelId?: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('tts:removeModel', modelId),
  revealModel: (modelId?: string): Promise<boolean> => ipcRenderer.invoke('tts:revealModel', modelId),
  synthesize: (req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> =>
    ipcRenderer.invoke('tts:synthesize', req),
  onModelProgress: (cb: (p: TtsModelProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: TtsModelProgress) => cb(p)
    ipcRenderer.on('tts:modelProgress', listener)
    return () => ipcRenderer.removeListener('tts:modelProgress', listener)
  },
}
