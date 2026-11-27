// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mockPaths = vi.hoisted(() => ({
  root: '',
  session: '',
}))

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
  ipcMain: { handle: vi.fn() },
}))
vi.mock('../electron/storage/settings', () => ({
  currentRoot: () => mockPaths.root,
  sessionPath: () => mockPaths.session,
}))

import { getDesignPreviewStatus, startDesignPreview, stopDesignPreview } from '../electron/designPreview/server'

let tmp = ''

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unyra-design-preview-'))
  mockPaths.root = tmp
  mockPaths.session = path.join(tmp, 'session.json')
  fs.writeFileSync(mockPaths.session, JSON.stringify({ userId: 'u1' }))
  const dir = path.join(tmp, 'users', 'u1', 'doc-design')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'doc-component--server-card.tsx'),
    `export default {
  kind: 'doc-component',
  id: 'server-card',
  tag: 'ServerCard',
  name: '服务预览卡',
  description: '内置服务预览',
  slots: [{ name: 'title', description: '标题' }],
  component: ({ slots = {} }) => <article className="server-card"><h2>{slots.title}</h2></article>,
}`,
  )
  fs.writeFileSync(
    path.join(dir, 'doc-component--article.tsx'),
    `export default {
  kind: 'doc-component',
  id: 'article-card',
  tag: 'ArticleCard',
  name: '文章卡',
  description: '纯 JSX 组件',
  slots: [{ name: 'title', description: '标题' }],
  component: ({ slots = {} }) => <article className="article-card"><h2>{slots.title}</h2></article>,
}`,
  )
})

afterAll(async () => {
  await stopDesignPreview()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('设计预览内置 HTTP 服务', () => {
  it('启动后提供文件清单、选择页面与 TSX 渲染', async () => {
    const status = await startDesignPreview()
    expect(status.running).toBe(true)
    expect(status.port).toBeGreaterThan(0)
    expect(status.url).toContain('127.0.0.1')
    expect(status.fileCount).toBe(2)

    const listRes = await fetch(`${status.url}api/files`)
    const list = (await listRes.json()) as { files: Array<{ file: string; kind: string }> }
    expect(list.files).toHaveLength(2)
    expect(list.files.map((item) => item.file)).toEqual(
      expect.arrayContaining(['doc-component--article.tsx', 'doc-component--server-card.tsx']),
    )
    expect(list.files.every((item) => item.kind === 'doc-component')).toBe(true)

    const page = await (await fetch(status.url)).text()
    expect(page).toContain('设计预览')
    expect(page).toContain('doc-component--server-card.tsx')

    const preview = await (await fetch(`${status.url}preview/doc-component--server-card.tsx`)).text()
    expect(preview).toContain('server-card')
    expect(preview).toContain('组件预览')

    const article = await (await fetch(`${status.url}preview/doc-component--article.tsx`)).text()
    expect(article).toContain('article-card')
    expect(article).toContain('组件预览')

    const css = await fetch(`${status.url}app.css`)
    expect(css.status).toBe(200)

    const refreshed = await getDesignPreviewStatus()
    expect(refreshed.fileCount).toBe(2)
  })

  it('拒绝目录穿越和未注册文件名', async () => {
    const status = await getDesignPreviewStatus()
    const bad = await fetch(`${status.url}preview/${encodeURIComponent('../session.json')}`)
    expect(bad.status).toBe(404)
    const badName = await fetch(`${status.url}preview/xxx.tsx`)
    expect(badName.status).toBe(404)
  })
})
