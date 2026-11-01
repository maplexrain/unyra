/**
 * 应用数据路径闸门的单元用例：files.* 在哪里放行、在哪里被拒。
 *
 * 它的错误形态是「模型用 files.write 改 meta.json，store 不回灌」——
 * 这道闸把应用数据挡在 files 通道之外，并在报错里直接指出该用哪一组 api。
 */
import { describe, expect, it } from 'vitest'

import { classifyDataPath, filesAccessError } from '../src/agent/sandbox/dataPaths'

describe('路径分类', () => {
  it('教学文档 / 笔记 / 大纲 / meta / 试卷 / 超级文档都归应用数据，并指出对应 api 组', () => {
    expect(classifyDataPath('docs/微积分/极限/极限.md')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('docs/微积分/极限/极限.notes/错题本.md')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('docs/微积分/极限/极限.outline.json')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('docs/微积分/极限/极限.meta.json')).toMatchObject({ kind: 'app-data' })
    expect(classifyDataPath('docs/微积分/极限/exams/ex_1.json')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('docs/微积分/极限/superdocs/夹逼.html')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('docs/微积分/tmp.json')).toMatchObject({ kind: 'app-data', api: 'tmp' })
    expect(classifyDataPath('docs/微积分/workflow.json')).toMatchObject({ kind: 'app-data', api: 'wf' })
    expect(classifyDataPath('docs/微积分/method.json')).toMatchObject({ kind: 'app-data', api: 'method' })
    expect(classifyDataPath('docs/微积分/reading.json')).toMatchObject({ kind: 'app-data' })
  })

  it('workspace / static / skills 是 files 的自留地', () => {
    expect(classifyDataPath('docs/微积分/极限/workspace/main.py')).toMatchObject({ kind: 'workspace' })
    expect(classifyDataPath('docs/微积分/极限/workspace')).toMatchObject({ kind: 'workspace' })
    expect(classifyDataPath('docs/微积分/static/a1b2.png')).toMatchObject({ kind: 'static' })
    expect(classifyDataPath('skills/pdf/scripts/extract.py')).toMatchObject({ kind: 'skills' })
  })

  it('用户配置与界面状态是应用数据，且多数没有 api 出口', () => {
    expect(classifyDataPath('user.yaml')).toMatchObject({ kind: 'app-data', api: 'userInfo' })
    expect(classifyDataPath('setting.yaml')).toMatchObject({ kind: 'app-data' })
    expect(classifyDataPath('state.json')).toMatchObject({ kind: 'app-data' })
    expect(classifyDataPath('docs/微积分/chat.json')).toMatchObject({ kind: 'app-data' })
  })

  it('反斜杠、users/ 前缀与 ./ 都归一', () => {
    expect(classifyDataPath('docs\\微积分\\极限\\极限.md')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('users/u1/docs/微积分/极限/极限.md')).toMatchObject({ kind: 'app-data', api: 'node' })
    expect(classifyDataPath('./docs/微积分/极限/极限.md')).toMatchObject({ kind: 'app-data', api: 'node' })
  })

  it('数据根之外是外部路径（放行白名单管它）', () => {
    expect(classifyDataPath('D:/datasets/train.csv')).toMatchObject({ kind: 'external' })
    expect(classifyDataPath('/home/user/notes.txt')).toMatchObject({ kind: 'external' })
  })
})

describe('files.* 准入', () => {
  it('应用数据被拒，报错里直接给出该用的 api 组与 __help 入口', () => {
    const denied = filesAccessError('docs/微积分/极限/极限.meta.json', 'write')
    expect(denied).not.toBeNull()
    expect(denied!.error).toContain('__help')
    expect(filesAccessError('docs/微积分/极限/极限.md', 'read')!.error).toContain('api.node.*')
    expect(filesAccessError('setting.yaml', 'read')!.error).toContain('由应用宿主管理')
  })

  it('workspace / static / skills / 外部路径放行', () => {
    expect(filesAccessError('docs/微积分/极限/workspace/main.py', 'write')).toBeNull()
    expect(filesAccessError('docs/微积分/static/a1b2.png', 'read')).toBeNull()
    expect(filesAccessError('skills/pdf/SKILL.md', 'read')).toBeNull()
    expect(filesAccessError('D:/datasets/train.csv', 'read')).toBeNull()
  })
})
