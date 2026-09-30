/**
 * 自动更新的回归探针：在 Node 里直接跑，不需要 Electron、不需要真的联网。
 *
 * 更新这一层错了，症状**不在出错的地方**：买家那边只会看到「一直说已是最新」，
 * 而没有任何日志能说明为什么。所以这里钉的是几件「错了也不会当场报错」的事：
 *
 * 1. **发布配置的一致性**：安装包真的去哪个仓库取（electron-builder.yml）、
 *    界面上的「发布页」指向哪（update-core 的 RELEASE_REPO）、以及产物文件名——
 *    三处写岔了都不报错，只是更新永远不来。releaseType 尤其阴：默认是 draft，
 *    而草稿不在 releases/latest 里，等于发布了个寂寞。
 * 2. **失败归类**：用户看到的是一句话，追查靠的是归类。归错了（把「仓库里没发布」
 *    说成「网络不通」）会把人引到完全错误的方向上去。
 * 3. **检查时机**：什么时候该去问更新源（启动那次、5 分钟一次的轮询、手动那一下）。
 *    这条错了的表现是「关掉了自动更新还在偷偷联网」，或者「挂着跑一天也等不到新版本」，
 *    两种都不会报错。
 * 4. **构建产物自检**：latest.yml 里的版本号、文件名、sha512 与实际那个 exe
 *    必须对得上。这是更新链路上最容易错、也最贵的一环——真发布之后才发现，
 *    所有客户端都会卡在下载上。release/ 不存在时这一节跳过。
 *
 * 跑法：node scripts/run-update-test.mjs（见 package.json 的 test:update）
 * 这一份要读仓库里的配置文件与产物，因此必须在仓库根目录跑（runner 会自己 chdir）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  FIRST_CHECK_DELAY_MS,
  POLL_INTERVAL_MS,
  RELEASE_REPO,
  failDetailOf,
  failReasonOf,
  notesText,
  releasePageUrl,
  shouldCheck,
  type UpdatePhase,
} from '../electron/update-core'

let pass = 0
const fails: string[] = []
let skipped = 0
function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) pass++
  else fails.push(label + (extra === undefined ? '' : ' | ' + JSON.stringify(extra)))
}
function skip(label: string) {
  skipped++
  console.log('  （跳过）' + label)
}

// 由 run-update-test.mjs chdir 到仓库根目录，因此这里用 cwd 而不是 import.meta.url
// （测试被打成 data: URL 再 import，import.meta.url 指向那串 data:，解析不出路径）
const ROOT = process.cwd()
const readYaml = (rel: string) => parseYaml(readFileSync(path.join(ROOT, rel), 'utf-8'))

/* ---------- 1. 发布配置的一致性 ---------- */

console.log('1. 发布配置')

interface PublishEntry {
  provider?: string
  owner?: string
  repo?: string
  releaseType?: string
}
const builder = readYaml('electron-builder.yml') as {
  publish?: PublishEntry[]
  win?: { artifactName?: string }
  nsis?: Record<string, unknown>
}

const pub = builder.publish?.[0]
ok(!!pub, 'electron-builder.yml 配了 publish（没有它，安装包里不会有 app-update.yml）')
ok(pub?.provider === 'github', 'publish provider 是 github', pub?.provider)
ok(
  pub?.owner === 'maplexrain' && pub?.repo === 'unyra',
  'publish 指向开源发布仓库 maplexrain/unyra',
  pub?.owner + '/' + pub?.repo,
)
// 只有 'release' 会出现在 releases/latest 与 releases.atom 里；draft 等于没发布
ok(pub?.releaseType === 'release', 'releaseType 是 release（draft 检查更新看不到）', pub?.releaseType)
ok(
  (pub?.owner ?? '') + '/' + (pub?.repo ?? '') === RELEASE_REPO,
  'publish 的仓库与 update-core 的 RELEASE_REPO 是同一个',
  RELEASE_REPO,
)

const artifact = builder.win?.artifactName ?? ''
ok(artifact.includes('${version}'), '产物文件名里带版本号', artifact)
ok(/^[\x20-\x7e]+$/.test(artifact), '产物文件名是纯 ASCII（中文名容易在下载链路上变乱码）', artifact)
// GitHub provider 会把文件名里的空格换成 -，两边对不上就会 404。这里要求本来就没有空格
ok(!/\s/.test(artifact), '产物文件名里没有空格', artifact)

// 更新不能动用户数据：数据目录里有教学文档与全部用户文件
ok(
  builder.nsis?.deleteAppDataOnUninstall === false,
  '卸载不删用户数据（升级/卸载都不该碰教学文档）',
  builder.nsis?.deleteAppDataOnUninstall,
)

/* ---------- 2. 更新说明的整理 ---------- */

console.log('2. 更新说明')

ok(notesText('<p>新增了学习树</p>') === '<p>新增了学习树</p>', 'HTML 原样保留（消毒是渲染层的事）')
ok(notesText('  \n ') === undefined, '只有空白 → 没有说明')
ok(notesText(undefined) === undefined, 'null/undefined → 没有说明')
ok(notesText('No content.') === 'No content.', '这层不管 GitHub 的占位串（electron-updater 已经处理过）')
ok(
  notesText([
    { version: '1.0.2', note: '修了 A' },
    { version: '1.0.1', note: '修了 B' },
  ]) === '修了 A\n修了 B',
  '数组形状（跨版本变更日志）拼成一段',
)
ok(notesText([{ version: '1.0.0', note: '' }, { version: '0.9.0' }]) === undefined, '数组里全是空 → 没有说明')
ok(notesText(42) === undefined, '不是字符串也不是数组 → 没有说明')

/* ---------- 3. 发布页地址 ---------- */

console.log('3. 发布页地址')

ok(
  releasePageUrl({ version: '1.0.2' }) === 'https://github.com/' + RELEASE_REPO + '/releases/tag/v1.0.2',
  '没有 tag 时按约定拼 v + version',
)
ok(
  releasePageUrl({ version: '1.0.2', tag: 'v1.0.2-beta.1' }).endsWith('/tag/v1.0.2-beta.1'),
  'feed 里给了 tag 就用它（GitHub 上的 tag 未必正好是 v + version）',
)
ok(releasePageUrl({ version: '1.0.2', tag: '  ' }).endsWith('/tag/v1.0.2'), '空白 tag 当作没给')
ok(
  releasePageUrl({ version: '1.0.2', tag: 'v1/../evil' }).includes('v1%2F..%2Fevil'),
  'tag 会被转义，拼不出别的路径',
)

/* ---------- 4. 失败归类 ---------- */

console.log('4. 失败归类')

const coded = (code: string) => Object.assign(new Error('boom'), { code })
ok(failReasonOf(coded('ERR_UPDATER_LATEST_VERSION_NOT_FOUND')) === 'no-release', '找不到 latest → 没发布过')
ok(failReasonOf(coded('ERR_UPDATER_NO_PUBLISHED_VERSIONS')) === 'no-release', '没有已发布版本 → 没发布过')
// 这条是实测出来的：仓库建好但一个版本都没发过时，那个库抛的是**没有 code** 的裸 Error，
// 而「作者第一次发布之前」每次启动都会撞上它，必须归到「没发布过」而不是「认不出来」
ok(
  failReasonOf(new Error('No published versions on GitHub')) === 'no-release',
  'atom feed 里一条 entry 都没有（仓库刚建好）→ 没发布过',
)
ok(failReasonOf(coded('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND')) === 'not-found', '发行版里缺 latest.yml')
ok(failReasonOf(coded('ERR_UPDATER_ASSET_NOT_FOUND')) === 'not-found', '发行版里缺安装包')
ok(failReasonOf(coded('ERR_CHECKSUM_MISMATCH')) === 'checksum', 'sha512 对不上')
ok(failReasonOf(coded('ERR_UPDATER_INVALID_SIGNATURE')) === 'checksum', '签名校验没过')
ok(failReasonOf(coded('ETIMEDOUT')) === 'network', '超时算网络问题')
ok(failReasonOf(coded('ENOTFOUND')) === 'network', 'DNS 解析不出来算网络问题')
ok(failReasonOf(coded('ECONNRESET')) === 'network', '连接被重置算网络问题')
ok(failReasonOf(coded('ERR_UPDATER_INVALID_RELEASE_FEED')) === 'network', 'feed 读不出来算网络问题')
ok(failReasonOf(coded('ENOSPC')) === 'download', '磁盘满算下载失败')
ok(failReasonOf(Object.assign(new Error('403'), { statusCode: 403 })) === 'not-found', 'HTTP 403 → 拿不到')
ok(failReasonOf(Object.assign(new Error('500'), { statusCode: 500 })) === 'http', 'HTTP 5xx → 服务器错')
ok(failReasonOf(new Error('???')) === 'unknown', '认不出来 → unknown')
ok(failReasonOf(null) === 'unknown', 'null 也不该炸')
ok(failReasonOf('boom') === 'unknown', '字符串也不该炸')
ok(failDetailOf(new Error('boom')) === 'boom', '详情取 Error.message')
ok(failDetailOf('boom') === 'boom', '详情取字符串本身')
ok(failDetailOf({ a: 1 }) === '{"a":1}', '详情把对象序列化')

/* ---------- 5. 什么时候该去问更新源 ---------- */

console.log('5. 检查时机')

ok(POLL_INTERVAL_MS === 5 * 60 * 1000, '轮询间隔是 5 分钟', POLL_INTERVAL_MS)
ok(FIRST_CHECK_DELAY_MS >= 1000, '启动后那一次不跟首屏抢时间', FIRST_CHECK_DELAY_MS)

// 自动（启动时那次 + 轮询）：关了开关就连请求都不发——「不打扰」必须包括这一点
ok(shouldCheck('idle', 'auto', true) === true, '开着自动更新：空闲时会去查')
ok(shouldCheck('idle', 'auto', false) === false, '关掉自动更新：轮询与启动检查都不查')
ok(shouldCheck('disabled', 'auto', true) === false, '开发运行 / 非 Windows 不查')
ok(shouldCheck('error', 'auto', true) === true, '上次出错之后，下一次轮询会自己再试')

// 手动：用户明确点的那一下，任何时候都该真的去问
ok(shouldCheck('idle', 'manual', false) === true, '关掉自动更新后，手动检查仍然可用')
ok(shouldCheck('error', 'manual', false) === true, '出错之后可以手动重试')
ok(shouldCheck('disabled', 'manual', true) === false, '这个构建压根不参与，手动也不查')

// 正在忙或已经下好了：不重复问，否则界面上会像是出了问题
for (const phase of ['checking', 'downloading', 'installing', 'ready'] as const) {
  ok(shouldCheck(phase, 'auto', true) === false, phase + ' 期间轮询不重复检查')
  ok(shouldCheck(phase, 'manual', true) === false, phase + ' 期间手动也不重复检查')
}
// 停在「查到了但没下」时可以再查：说不定这期间又发了更新的版本
ok(shouldCheck('available', 'auto', true) === true, '停在「可下载」时仍然会查')
const phases: UpdatePhase[] = ['disabled', 'idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'error']
ok(phases.length === 8, '相位就是这八档（渲染层与 preload 各镜像了一份，改动要同步）')

/* ---------- 6. 构建产物自检 ---------- */

console.log('6. 构建产物（release/）')

const releaseDir = path.join(ROOT, 'release')
const pkgVersion = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version: string })
  .version

if (!existsSync(path.join(releaseDir, 'latest.yml'))) {
  skip('release/latest.yml 不存在（先跑一次 npm run release:win）')
} else {
  const meta = parseYaml(readFileSync(path.join(releaseDir, 'latest.yml'), 'utf-8')) as {
    version?: string
    path?: string
    sha512?: string
    files?: { url?: string; sha512?: string; size?: number }[]
  }
  ok(meta.version === pkgVersion, 'latest.yml 的版本号 = package.json 的版本号', {
    latest: meta.version,
    pkg: pkgVersion,
  })
  const file = path.join(releaseDir, meta.path ?? '')
  ok(!!meta.path && existsSync(file), 'latest.yml 指向的安装包在 release/ 里', meta.path)
  if (meta.path && existsSync(file)) {
    const hash = createHash('sha512').update(readFileSync(file)).digest('base64')
    ok(hash === meta.sha512, 'latest.yml 的 sha512 与实际安装包一致')
    ok(meta.files?.[0]?.sha512 === meta.sha512, 'files[] 与顶层的 sha512 一致')
    ok(meta.files?.[0]?.size === statSync(file).size, 'latest.yml 登记的体积与实际一致')
    ok(!/[^\x20-\x7e]/.test(meta.path), '安装包文件名是纯 ASCII', meta.path)
    // 增量下载要用它；缺了不会出错，只是每次全量下
    ok(existsSync(file + '.blockmap'), '有 .blockmap（增量下载用；缺了只是每次全量）')
  }

  const appUpdate = path.join(releaseDir, 'win-unpacked/resources/app-update.yml')
  if (!existsSync(appUpdate)) {
    skip('release/win-unpacked/resources/app-update.yml 不存在（打包版才会生成）')
  } else {
    const cfg = parseYaml(readFileSync(appUpdate, 'utf-8')) as {
      provider?: string
      owner?: string
      repo?: string
      updaterCacheDirName?: string
    }
    // 这一份是**装到用户机器上之后**真正生效的配置：它指错地方，更新就永远不会来
    ok(cfg.provider === 'github', 'app-update.yml 的 provider 是 github', cfg.provider)
    ok(
      (cfg.owner ?? '') + '/' + (cfg.repo ?? '') === RELEASE_REPO,
      'app-update.yml 指向公开的发布仓库（打包版按它取更新）',
      cfg.owner + '/' + cfg.repo,
    )
    ok(!!cfg.updaterCacheDirName, 'app-update.yml 里有 updaterCacheDirName', cfg.updaterCacheDirName)
  }
}

/* ---------- 汇总 ---------- */

console.log('')
if (fails.length) {
  console.error('FAIL ' + fails.length + ' 项：')
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('ALL OK · ' + pass + ' 项断言通过' + (skipped ? '，跳过 ' + skipped + ' 项' : ''))
