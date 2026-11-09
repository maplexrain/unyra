import type { AiqaChatMessage, AiqaChatSession } from '../../learn/types'

export type { AiqaChatMessage, AiqaChatSession }

export interface ParsedAiqaBlock {
  id: string
  system: string
  question: string
}

export interface AiqaBlockHost {
  getActiveNodeId: () => string | null
  getNodeAiqaSession: (nodeId: string, blockId: string) => AiqaChatSession | null
  saveNodeAiqaSession: (nodeId: string, blockId: string, session: AiqaChatSession | null) => void
}
