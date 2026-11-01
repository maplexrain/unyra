/** 空库的形状：新用户（或清空之后）打开时看到的那一份，见 emptyLearnStore。 */

import type { LearnStore } from '../types'
import { emptyDocs } from '../groups'
import { emptySchedule } from '../schedule'

export function emptyLearnStore(): LearnStore {
  return {
    version: 2,
    nodes: [],
    edges: [],
    goals: [],
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    // 记忆库：长期跨目标、工作按目标（见 learn/memory）；空库就是两边都空
    memory: { long: [], work: {} },
    activeGoalId: null,
    activeNodeId: null,
    activeConversationId: null,
    // 文档区从一个空组开始（见 learn/groups 的 emptyDocs）
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
    favorites: [],
    favGroups: [],
    // 日程：空清单 + 默认铃声（见 learn/schedule）
    schedule: emptySchedule(),
  }
}
