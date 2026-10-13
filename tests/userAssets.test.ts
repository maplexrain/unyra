/**
 * 用户静态资源（assets/）与头像字段的纪律。
 *
 * 这一组守的是同一件事：**画像字段里不能有字节**。
 * 从前 `avatar` 只认 `data:image/...`，于是一段 256KB 的 base64 直接把 user.yaml 撑成了
 * 一份大文件；现在它只认 URL，并且长度卡在 255。这里把两道闸都钉住——
 * 尤其是「换着法子塞 base64」那几条，它们是这次改动的由头。
 */
import { describe, expect, it } from 'vitest'
import {
  ASSETS_DIR,
  assetFileOf,
  assetRelOf,
  assetUrl,
  isAssetFile,
  isAssetUrl,
} from '../src/user/assets'
import { normalizeAvatar } from '../src/user/profile'
import { AVATAR_MAX_URL } from '../src/user/types'

/** 造一个很像真的头像 data URL（一小段假的 base64，但形状完整） */
const FAKE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('用户静态资源目录 (assets)', () => {
  it('目录名就是需求要的 assets', () => {
    expect(ASSETS_DIR).toBe('assets')
  })

  it('文件名与 URL 之间来回换算', () => {
    expect(assetUrl('avatar-1730000000000.png')).toBe('asset:avatar-1730000000000.png')
    expect(assetUrl('assets/avatar-1.jpg')).toBe('asset:avatar-1.jpg')
    expect(assetFileOf('asset:avatar-1.jpg')).toBe('avatar-1.jpg')
    expect(assetRelOf('asset:avatar-1.jpg')).toBe('assets/avatar-1.jpg')
  })

  it('只认图片扩展名（与主进程的写入白名单同一组）', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']) {
      expect(isAssetFile(`avatar-1.${ext}`)).toBe(true)
    }
    // 别的二进制不许走这条路：头像通道曾经就是靠扩展名白名单挡住「往头像路径写一个 exe」
    expect(isAssetFile('avatar-1.exe')).toBe(false)
    expect(isAssetFile('avatar-1.sh')).toBe(false)
    expect(isAssetFile('avatar-1')).toBe(false)
  })

  it('名字里不许有路径成分——它来自可手改的 user.yaml，路径穿越在这里就该断了', () => {
    expect(isAssetFile('../secret.png')).toBe(false)
    expect(isAssetFile('a/b.png')).toBe(false)
    expect(isAssetFile('a\\b.png')).toBe(false)
    expect(isAssetFile('..png')).toBe(false)
    expect(assetRelOf('asset:../secret.png')).toBeNull()
    expect(assetRelOf('asset:sub/secret.png')).toBeNull()
    // 前缀不对、或压根不是这个协议
    expect(isAssetUrl('https://example.com/a.png')).toBe(false)
    expect(isAssetUrl('avatar-1.png')).toBe(false)
    expect(isAssetUrl('asset:')).toBe(false)
  })
})

describe('头像字段 (normalizeAvatar)', () => {
  it('接受内置资源地址', () => {
    expect(normalizeAvatar('asset:avatar-1730000000000.png')).toBe('asset:avatar-1730000000000.png')
    expect(normalizeAvatar('  asset:avatar-1.webp  ')).toBe('asset:avatar-1.webp')
  })

  it('接受 http / https 外链', () => {
    expect(normalizeAvatar('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(normalizeAvatar('http://example.com/a.png')).toBe('http://example.com/a.png')
  })

  it('拒绝 base64 / 任何 data URI——这次改动的由头', () => {
    expect(normalizeAvatar(FAKE_DATA_URL)).toBe('')
    // 大写、带参数、别种 mime：只要前缀是 data: 就一律不放行，
    // 「换个写法混进来」正是需求里点名的「其他手段」
    expect(normalizeAvatar('DATA:image/png;base64,AAAA')).toBe('')
    expect(normalizeAvatar('data:image/svg+xml;charset=utf-8,<svg/>')).toBe('')
    expect(normalizeAvatar('data:text/html;base64,AAAA')).toBe('')
  })

  it('长度卡在 255：就算形态绕过去了，体积也放不下一张图', () => {
    expect(AVATAR_MAX_URL).toBe(255)
    // 一条**形状合法**但超长的外链：长度这一道闸单独管用
    const long = 'https://example.com/' + 'a'.repeat(400) + '.png'
    expect(long.length).toBeGreaterThan(AVATAR_MAX_URL)
    expect(normalizeAvatar(long)).toBe('')
    // 刚好卡在上限之内的放行
    const fit = 'https://example.com/' + 'a'.repeat(AVATAR_MAX_URL - 'https://example.com/'.length - 4) + '.png'
    expect(fit.length).toBe(AVATAR_MAX_URL)
    expect(normalizeAvatar(fit)).toBe(fit)
  })

  it('拒绝其余协议与写不通的值', () => {
    // 这些是「看着像地址」的东西：javascript: 是脚本、file: 能读盘、相对地址没有基准
    expect(normalizeAvatar('javascript:alert(1)')).toBe('')
    expect(normalizeAvatar('file:///C:/secret.png')).toBe('')
    expect(normalizeAvatar('//example.com/a.png')).toBe('')
    expect(normalizeAvatar('example.com/a.png')).toBe('')
    expect(normalizeAvatar('asset:../secret.png')).toBe('')
    expect(normalizeAvatar('')).toBe('')
    expect(normalizeAvatar('   ')).toBe('')
    expect(normalizeAvatar(undefined)).toBe('')
    expect(normalizeAvatar(123)).toBe('')
  })
})
