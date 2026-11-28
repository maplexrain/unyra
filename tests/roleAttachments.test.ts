/**
 * role chat.send 的 URL 图片附件：字符串形态、无扩展名 URL 也能走完下载→转存。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LearnStore } from '../src/learn/types'

vi.mock('../src/learn/agent/transfer', () => ({
  transferPendingImages: vi.fn(async () => ({
    images: [{ id: 'i1', rel: 'free/static/i1.jpg', name: 'cat', mime: 'image/jpeg', bytes: 1 }],
  })),
  transferFreePendingImages: vi.fn(async () => ({
    images: [{ id: 'i1', rel: 'free/static/i1.jpg', name: 'cat', mime: 'image/jpeg', bytes: 1 }],
  })),
}))

import { resolveChatAttachments } from '../src/learn/roleWork/attachments'

const io = {
  getLatest: () => ({}) as LearnStore,
  set: () => {},
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('role chat.send URL 图片附件', () => {
  it('字符串 URL（含无扩展名 CDN）下载并按图片返回', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image-bytes'], { type: 'image/jpeg' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    if (typeof (globalThis as { File?: unknown }).File === 'undefined') {
      class FileStub extends Blob {
        name: string
        constructor(parts: BlobPart[], name: string, opts?: FilePropertyBag) {
          super(parts, opts)
          this.name = name
        }
      }
      vi.stubGlobal('File', FileStub)
    }

    const result = await resolveChatAttachments(['https://cdn.example.com/assets/cat'], io)
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/assets/cat')
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.images).toHaveLength(1)
      expect(result.images?.[0]?.mime).toBe('image/jpeg')
    }
  })

  it('moji:static/<uuid> 按资源清单落回真实路径，不再写裸 uuid', async () => {
    const store = {
      version: 2,
      goals: [{ id: 'g1', rootNodeId: 'n1', question: '高数', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          title: '高数',
          key: '高数',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'ai',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [],
      resources: {
        g1: [
          {
            uuid: 'img-1',
            name: '人民网截图',
            ext: 'webp',
            type: 'binary',
            description: '',
            createdAt: 1,
            updatedAt: 1,
            bytes: 639694,
            hash: '',
          },
        ],
      },
    } as unknown as LearnStore
    const result = await resolveChatAttachments(
      [{ image: 'moji:static/img-1' }],
      { getLatest: () => store, set: () => {}, goalId: 'g1' },
    )
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.images?.[0]).toMatchObject({
        id: 'img-1',
        rel: 'docs/高数/static/img-1.webp',
        name: '人民网截图',
        mime: 'image/webp',
        bytes: 639694,
      })
    }
  })

  it('moji:static 引用找不到资源时显式报错，不落永远读不到的空引用', async () => {
    const result = await resolveChatAttachments([{ image: 'moji:static/missing' }], io)
    expect(result).toEqual({ error: expect.stringContaining('不在资源库里') })
  })
})
