/** 空库的形状：新用户（或清空之后）打开时看到的那一份，见 emptyLearnStore。 */

import type { LearnStore } from '../types'
import { emptyDocs } from '../groups'
import { emptyPomodoro } from '../pomodoro'

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
    activeGoalId: null,
    activeNodeId: null,
    activeConversationId: null,
    // 文档区从一个空组开始（见 learn/groups 的 emptyDocs）
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
    favorites: [],
    // 阅读与打卡按目标分开存（见 learn/reading 的 ReadingBook）：空库就是空账本
    reading: { byGoal: {} },
    checkin: { byGoal: {} },
    pomodoro: emptyPomodoro(),
  }
}
