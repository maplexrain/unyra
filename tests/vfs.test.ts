/**
 * 响应式 VFS 与声明式文件实体测试套件。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  FILE_ENTITIES,
  ReactiveVfsBus,
  generateDataManifestPrompt,
  matchEntity,
  normalizeRelativePath,
  quickHash,
  resolveEntityPath,
} from '../src/vfs'

describe('VFS 声明式实体注册与路由匹配', () => {
  it('注册表实体定义自洽且非空', () => {
    expect(FILE_ENTITIES.length).toBeGreaterThan(0)
    for (const e of FILE_ENTITIES) {
      expect(e.id).toBeTruthy()
      expect(e.pattern).toBeTruthy()
    }
  })

  it('规范化相对路径：去除反斜杠与前导斜杠', () => {
    expect(normalizeRelativePath('docs\\math\\linear.md')).toBe('docs/math/linear.md')
    expect(normalizeRelativePath('/docs/math/linear.md/')).toBe('docs/math/linear.md')
    expect(normalizeRelativePath('///user//profile.json')).toBe('user/profile.json')
  })

  it('匹配教学文档正文 (node-doc)', () => {
    const match = matchEntity('docs/高等数学/极限/极限.md')
    expect(match).not.toBeNull()
    expect(match?.entity.id).toBe('node-doc')
    expect(match?.entity.category).toBe('document')
    expect(match?.entity.format).toBe('markdown')
    expect(match?.params.path).toBe('高等数学/极限')
    expect(match?.params.title).toBe('极限')
  })

  it('匹配个人笔记文档 (node-note)', () => {
    const match = matchEntity('docs/高等数学/微积分/导数.notes/错题本.md')
    expect(match).not.toBeNull()
    expect(match?.entity.id).toBe('node-note')
    expect(match?.entity.category).toBe('document')
    expect(match?.params.path).toBe('高等数学/微积分')
    expect(match?.params.title).toBe('导数')
    expect(match?.params.name).toBe('错题本')
  })

  it('匹配节点元数据与状态 (node-meta)', () => {
    const match = matchEntity('docs/微积分/极限/极限.meta.json')
    expect(match).not.toBeNull()
    expect(match?.entity.id).toBe('node-meta')
    expect(match?.entity.category).toBe('data')
    expect(match?.entity.format).toBe('json')
    expect(match?.params.title).toBe('极限')
  })

  it('匹配结构化大纲 (node-outline)', () => {
    const match = matchEntity('docs/线性代数/矩阵/outline.json')
    expect(match).not.toBeNull()
    expect(match?.entity.id).toBe('node-outline')
    expect(match?.entity.category).toBe('data')
    expect(match?.entity.itemShape).toContain('key')
    expect(match?.params.path).toBe('线性代数/矩阵')
  })

  it('匹配长期记忆与用户画像 (mind-memory & user-profile)', () => {
    const mMind = matchEntity('mind/exam-preference.json')
    expect(mMind?.entity.id).toBe('mind-memory')
    expect(mMind?.params.key).toBe('exam-preference')

    const mUser = matchEntity('user/profile.json')
    expect(mUser?.entity.id).toBe('user-profile')
    expect(mUser?.entity.category).toBe('data')
  })

  it('反向路径解析 (resolveEntityPath)', () => {
    const path = resolveEntityPath('node-outline', { path: '计算机网络/传输层' })
    expect(path).toBe('docs/计算机网络/传输层/outline.json')

    const notePath = resolveEntityPath('node-note', {
      path: '物理/力学',
      title: '牛顿定律',
      name: '错题摘录',
    })
    expect(notePath).toBe('docs/物理/力学/牛顿定律.notes/错题摘录.md')
  })

  it('自动派生给 Agent 的 Data Manifest 契约提示词完整有效', () => {
    const manifest = generateDataManifestPrompt()
    expect(manifest).toContain('数据资产契约与文件存储规范')
    expect(manifest).toContain('node-doc')
    expect(manifest).toContain('node-meta')
    expect(manifest).toContain('node-outline')
    expect(manifest).toContain('JSON.parse')
    expect(manifest).toContain('反序列化数据结构')
  })
})

describe('VFS 响应式总线与防回环过滤 (ReactiveVfsBus)', () => {
  let bus: ReactiveVfsBus

  beforeEach(() => {
    bus = new ReactiveVfsBus()
  })

  it('quickHash 输出确定性哈希', () => {
    const h1 = quickHash('hello world')
    const h2 = quickHash('hello world')
    const h3 = quickHash('different text')
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
  })

  it('自发写入自动被判定为 Echo 回声并被拦截', async () => {
    const filePath = 'docs/高数/outline.json'
    const content = JSON.stringify({ intro: '导论', children: [] })

    // 尚未写入时不是 echo
    expect(bus.isEcho(filePath, content)).toBe(false)

    // 执行写入
    await bus.write(filePath, content, { source: 'ui' })

    // 刚刚写入同一内容时，判定为自发 echo
    expect(bus.isEcho(filePath, content)).toBe(true)

    // 如果外部改动了内容（hash 变了），不是 echo，必须放行
    const modifiedContent = JSON.stringify({ intro: '由外部VSCode改动的导论', children: [] })
    expect(bus.isEcho(filePath, modifiedContent)).toBe(false)
  })

  it('实体级与精确路径级订阅收到写入变更通知', async () => {
    const filePath = 'docs/高数/outline.json'
    const payload = { intro: '极限入门', children: [{ key: '1', title: '定义', summary: '描述' }] }

    let entityFired = false
    let pathFired = false
    let receivedData: unknown = null

    // 订阅实体
    const unsubEntity = bus.subscribeEntity('node-outline', (ev) => {
      entityFired = true
      receivedData = ev.data
    })

    // 订阅路径
    const unsubPath = bus.subscribePath(filePath, (ev) => {
      pathFired = true
      expect(ev.relativePath).toBe('docs/高数/outline.json')
    })

    await bus.write(filePath, payload, { source: 'vfs' })

    expect(entityFired).toBe(true)
    expect(pathFired).toBe(true)
    expect(receivedData).toEqual(payload)

    // 取消订阅后再写，不再触发
    unsubEntity()
    unsubPath()
    entityFired = false
    pathFired = false

    await bus.write(filePath, { intro: '新导论', children: [] }, { source: 'vfs' })
    expect(entityFired).toBe(false)
    expect(pathFired).toBe(false)
  })

  it('外部通知变更 (notifyExternalChange) 自动同步缓存并派发事件', () => {
    const filePath = 'user/profile.json'
    const rawContent = JSON.stringify({ nickname: '张三', masteredSkills: ['TS'] })

    let fired = false
    bus.subscribeEntity('user-profile', (ev) => {
      fired = true
      expect(ev.source).toBe('watcher')
      expect((ev.data as { nickname: string })?.nickname).toBe('张三')
    })

    bus.notifyExternalChange({
      path: filePath,
      content: rawContent,
      source: 'watcher',
    })

    expect(fired).toBe(true)
    expect(bus.getCached<{ nickname: string }>(filePath)?.nickname).toBe('张三')
  })

  it('文件删除事件正确清理缓存并通知订阅者', () => {
    const filePath = 'docs/物理/temp.json'
    bus.notifyExternalChange({
      path: filePath,
      action: 'delete',
      source: 'agent',
    })

    expect(bus.getCached(filePath)).toBeUndefined()
  })
})
