/**
 * 应用身份的对账（见 electron/app/identity）。
 *
 * 钉的是「写岔了不会报错、只是图标悄悄变回 Electron 原子」的那几处：
 * 运行时用的 AUMID 必须与安装器写在快捷方式上的 appId 逐字一致；
 * 源码运行则必须另起一个身份，不能冒充安装版（踩过的坑见那份文件的注释）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { APP_ID, appUserModelId } from '../electron/app/identity'

const root = path.resolve(__dirname, '..')
const readYaml = (rel: string) => parseYaml(readFileSync(path.join(root, rel), 'utf-8')) as Record<string, unknown>

describe('应用身份', () => {
  it('打包版用的 AUMID 与 electron-builder.yml 的 appId 逐字一致', () => {
    expect(readYaml('electron-builder.yml').appId).toBe(APP_ID)
  })

  it('源码运行另起一个身份，不冒充安装版', () => {
    expect(appUserModelId(true)).toBe(APP_ID)
    expect(appUserModelId(false)).not.toBe(APP_ID)
    expect(appUserModelId(false)).toBe(APP_ID + '.dev')
  })

  it('授权签发器是另一个应用：它的 appId 不能与本应用相同', () => {
    const licgen = path.join(root, 'electron-builder.licgen.yml')
    if (!existsSync(licgen)) return
    expect(readYaml('electron-builder.licgen.yml').appId).not.toBe(APP_ID)
  })
})
