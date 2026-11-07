# AGENTS.md — 仓库级 Agent 纪律

面向一切在本仓库干活的 agent（与人类贡献者）。改动代码前先读完这一页。

## 文件体积红线（CI 强制）

本仓库的历史教训：agent 倾向于把新逻辑持续堆进同一个已经很臃肿的文件。以下规矩由 `scripts/checkFileSize.mjs` + CI 的「文件体积门禁」步骤机器执行，不是建议：

- `src/` `electron/` `shared/` 下的 `.ts`/`.tsx`/`.css`，单文件硬上限 **1000 行**；接近 **700 行** 就该考虑拆分。
- 已超限的存量文件登记在 `scripts/fileSizeBaseline.json`（ratchet 台账）：**只许减、不许增**。往这些文件追加逻辑会直接挂 CI。
- 默认动作是**新逻辑开新文件/新模块**，不是往既有文件追加。改动大文件前先判断：本次逻辑属于哪个域、有没有现成的相邻子模块可落（如 `src/components/learn/workspace/` 的既有拆分边界）；没有就建一个。
- 门禁挂掉时，正确响应是**拆文件**，不是改台账。台账重生成（`npm run size:baseline`）是显式动作，diff 里看得见：仅在「确实必须增长/收紧」时使用，并在 PR 描述写明理由。禁止用重生成台账吞掉告警。
- 阈值调整在 `scripts/checkFileSize.mjs` 顶部（`HARD_LIMIT` / `SOFT_LIMIT`），动它需要说明理由。
