/**
 * 这个文件负责什么：技能 api 的装配（skill.*）——技能路径、清单、读取（读动作会触发
 * 宿主把该技能注入为后续上下文消息）、写删（落盘到 skills/ 目录）与脚本执行（skill.run
 * 按扩展名挑解释器，经受控进程通道跑，最多等 30s）。
 */
import {
  getSkillScriptAbsPath,
  getSkillAbsDir,
  getSkillsAbsPath,
  getSkillPathsInfo,
  saveSkillToDisk,
  deleteSkillFromDisk,
} from '../../skill/fs'
import { getLoadedSkills, getActiveSkills } from '../../skill/registry'
import type { SkillDef } from '../../skill/types'
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import { getNativeProcess } from './native'
import type { SandboxCall, SandboxOptions } from '../types'

/** 技能域：skill.paths/list/read/write/delete/run */
export function installSkill(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  wrapApi(api, 'skill.paths', async (args) => {
    const id = args.length ? asText(args[0]) : undefined
    return await getSkillPathsInfo(id)
  }, log)

  wrapApi(api, 'skill.list', async () => {
    const skills = getActiveSkills()
    const root = await getSkillsAbsPath()
    return {
      ok: true,
      root,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        dir: `${root}\\${s.id}`,
        description: s.description,
        whenToUse: s.whenToUse,
        category: s.category,
        tags: s.tags,
        scripts: s.scripts ?? [],
        references: s.references ?? [],
      })),
    }
  }, log)

  wrapApi(api, 'skill.read', async (args) => {
    const id = asText(args[0])
    if (!id) return { ok: false, error: '缺少技能 id 参数' }
    const skills = getLoadedSkills()
    const target = skills.find((s) => s.id === id)
    if (!target) {
      return {
        ok: false,
        error: `未找到技能 "${id}"。当前已启用的技能: ${skills.filter((s) => s.enabled).map((s) => s.id).join(', ')}`,
      }
    }
    // 动态触发宿主注入该技能作为后续上下文消息
    opts.onPromptModule?.(`skill:${target.id}`)
    const paths = await getSkillPathsInfo(target.id)
    return {
      ok: true,
      id: target.id,
      name: target.name,
      description: target.description,
      whenToUse: target.whenToUse,
      instructions: target.instructions,
      scripts: target.scripts ?? [],
      references: target.references ?? [],
      dir: paths.dir,
      scriptsDir: paths.scriptsDir,
      referencesDir: paths.referencesDir,
      skillMd: paths.skillMd,
    }
  }, log)

  wrapApi(api, 'skill.write', async (args) => {
    const def = asRecord(args[0])
    const id = asText(def.id)
    if (!id) return { ok: false, error: '缺少技能 id 属性' }
    const skill: SkillDef = {
      id,
      name: asText(def.name) || id,
      description: asText(def.description) || '',
      whenToUse: asText(def.whenToUse) || undefined,
      category: (asText(def.category) as SkillDef['category']) || 'general',
      tags: Array.isArray(def.tags) ? def.tags.map(asText).filter(Boolean) : [],
      instructions: asText(def.instructions) || '',
      enabled: def.enabled !== false,
    }
    const ok = await saveSkillToDisk(skill)
    if (!ok) return { ok: false, error: `写入技能 "${id}" 失败` }
    const paths = await getSkillPathsInfo(id)
    return { id, ...paths }
  }, log)

  wrapApi(api, 'skill.delete', async (args) => {
    const id = asText(args[0])
    if (!id) return { ok: false, error: '缺少技能 id 参数' }
    const ok = await deleteSkillFromDisk(id)
    return { ok, id }
  }, log)

  wrapApi(api, 'skill.run', async (args) => {
    const skillId = asText(args[0])
    const scriptName = asText(args[1])
    const scriptArgs = args[2]

    if (!skillId) return { ok: false, error: '缺少技能 id 参数' }
    if (!scriptName) return { ok: false, error: '缺少脚本名称参数' }

    const np = getNativeProcess()
    if (!np) {
      return {
        ok: true,
        output: `[mock] 执行技能脚本: ${scriptName} (参数: ${JSON.stringify(scriptArgs)})`,
        exitCode: 0,
      }
    }

    const scriptPath = await getSkillScriptAbsPath(skillId, scriptName)
    if (!scriptPath) {
      return { ok: false, error: `技能脚本路径无效或越界: skills/${skillId}/scripts/${scriptName}` }
    }

    const scriptDir = await getSkillAbsDir(skillId)

    let command = 'node'
    let cmdArgs: string[] = [scriptPath]
    if (scriptName.endsWith('.py')) {
      command = 'python'
      cmdArgs = [scriptPath]
    } else if (scriptName.endsWith('.sh')) {
      command = 'bash'
      cmdArgs = [scriptPath]
    } else if (scriptName.endsWith('.bat') || scriptName.endsWith('.cmd')) {
      command = 'cmd'
      cmdArgs = ['/c', scriptPath]
    } else if (scriptName.endsWith('.ps1')) {
      command = 'powershell'
      cmdArgs = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]
    }

    const envPayload = scriptArgs !== undefined ? JSON.stringify(scriptArgs) : ''
    const createRes = await np.create({
      command,
      args: cmdArgs,
      cwd: scriptDir || undefined,
      env: envPayload ? { SKILL_ARGS: envPayload } : undefined,
    })

    if (!createRes.ok) {
      return { ok: false, error: `创建脚本执行进程失败: ${createRes.error || '未知错误'}` }
    }
    const procId = createRes.process_id
    if (!procId) {
      return { ok: false, error: '创建脚本执行进程失败: 未返回 process_id' }
    }

    const startRes = await np.start(procId)
    if (!startRes.ok) {
      await np.delete(procId)
      return { ok: false, error: `启动脚本执行进程失败: ${startRes.error || '未知错误'}` }
    }

    // 等待脚本完成 (最多 30s)
    const startTime = Date.now()
    const maxWaitMs = 30000
    let exitCode = 0
    let exited = false

    while (Date.now() - startTime < maxWaitMs) {
      const st = await np.status(procId)
      if (st.ok && st.status) {
        if (st.status.exited || !st.status.running) {
          exited = true
          exitCode = st.status.exitCode ?? 0
          break
        }
      }
      await new Promise((r) => setTimeout(r, 150))
    }

    if (!exited) {
      await np.stop(procId, { force: true })
      await np.delete(procId)
      return { ok: false, error: `技能脚本执行超时 (${maxWaitMs / 1000}s)` }
    }

    const out = await np.output(procId)
    await np.delete(procId)

    const stdout = out.ok ? out.stdout || '' : ''
    const stderr = out.ok ? out.stderr || '' : ''
    const totalOut = stdout + (stderr ? (stdout ? '\n[stderr]\n' : '') + stderr : '')

    return {
      ok: exitCode === 0,
      output: totalOut || (exitCode === 0 ? '（脚本执行成功，无输出）' : '（脚本退出非零，无输出）'),
      exitCode,
      ...(exitCode !== 0 ? { error: `脚本退出异常，退出码: ${exitCode}` } : {}),
    }
  }, log)
}
