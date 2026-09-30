/**
 * 发布构建：类型检查 → 渲染层 → 主进程（发布模式）→ 打进安装包 →（可选）发布到 GitHub。
 *
 * 为什么不直接写成 npm run build + electron-builder：主进程要带 MOJI_RELEASE=1
 * 才会压缩并丢掉 sourcemap，而各平台设环境变量的 npm 脚本写法不同（Windows 是 set，
 * 类 Unix 是前缀赋值），用一个 Node 脚本统一，顺带把步骤名打清楚。
 *
 * 产物在 release/ 下，三样都要传上去才算一次完整的发布：
 *   Unyra-<版本>-Setup.exe          安装包
 *   Unyra-<版本>-Setup.exe.blockmap 增量下载用（缺了它只是每次全量下，不会出错）
 *   latest.yml                      更新元数据：版本号 + 安装包 sha512
 * 每次构建出来的是同一份包，不含任何按买家定制的内容——要卖就把这份原样发出去。
 *
 * 用法：
 *   npm run release:win      只构建，不上传
 *   npm run release:publish  构建完上传到公开的发布仓库（用已登录的 gh，不需要 GH_TOKEN）
 *
 * **上传为什么不用 electron-builder 的 --publish**：实测它会在「创建 release」那一步
 * 吃 422 already_exists 中断（即使 release 并不存在），而且一旦中断，latest.yml
 * 压根不会被生成——最后线上只剩一个安装包，客户端报「缺少更新所需的文件」。
 * 踩过两次之后改成：构建始终用 --publish never（这一步会正常写出 latest.yml），
 * 上传交给 gh。gh 本来就要用来写 Release 正文与做发布后自检，少一个活动部件。
 *
 * electron-builder.yml 里的 publish 配置仍然要留着——它是用来生成安装包内那份
 * app-update.yml 的（客户端按它知道去哪里取更新）。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const publish = process.argv.includes('--publish')

function run(label, argv, env = {}) {
  console.log('[release] ' + label)
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) {
    console.error('[release] ' + label + ' 失败（退出码 ' + r.status + '）')
    process.exit(r.status ?? 1)
  }
}

/** 跑一条 gh 子命令；返回是否成功与输出（失败时不直接退出，交给调用方决定怎么办） */
function gh(args) {
  const r = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf-8' })
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim()
  return { ok: r.status === 0, out }
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' })
  return r.status === 0 ? (r.stdout ?? '').trim() : ''
}

const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version
const builder = parseYaml(readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf-8'))
const pub = builder.publish?.[0] ?? {}
const slug = pub.owner + '/' + pub.repo
const tag = 'v' + version
const exeName = 'Unyra-' + version + '-Setup.exe'

/**
 * 本地先对一遍：latest.yml 里登记的版本号 / 文件名 / sha512 / 体积必须与刚构建出来的
 * 安装包一致。不一致就停在这里——传上去之后客户端才会发现校验不过，那时候已经晚了。
 */
function checkLocalArtifacts() {
  const ymlPath = path.join(ROOT, 'release', 'latest.yml')
  const exePath = path.join(ROOT, 'release', exeName)
  for (const p of [ymlPath, exePath, exePath + '.blockmap']) {
    if (!existsSync(p)) {
      console.error('[release] 少了一个产物：' + path.relative(ROOT, p))
      process.exit(1)
    }
  }
  const meta = parseYaml(readFileSync(ymlPath, 'utf-8'))
  const buf = readFileSync(exePath)
  const sha = createHash('sha512').update(buf).digest('base64')
  const info = meta.files?.[0] ?? {}
  const bad =
    meta.version !== version || meta.path !== exeName || meta.sha512 !== sha || info.size !== buf.length
  if (bad) {
    console.error('[release] latest.yml 与刚构建出来的安装包对不上，已中止（传上去客户端会校验失败）：')
    console.error('          latest.yml: version=' + meta.version + ' path=' + meta.path + ' size=' + info.size)
    console.error('          实际安装包: ' + exeName + ' size=' + buf.length + ' sha512=' + sha)
    process.exit(1)
  }
  return [exePath, exePath + '.blockmap', ymlPath]
}

if (publish) {
  // 发布前的三道闸。它们拦的都是「传上去才发现不对」的情况
  if (version === '0.0.0') {
    console.error('[release] package.json 的 version 还是占位值 0.0.0，先定一个真版本号再发。')
    process.exit(1)
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=no'])
  if (dirty) {
    console.error('[release] 工作区还有未提交的改动，先提交（发布出去的东西必须对得上某个 commit）：')
    console.error(dirty)
    process.exit(1)
  }
  const auth = gh(['auth', 'status'])
  if (!auth.ok) {
    console.error('[release] gh 没登录，先跑一次 gh auth login。')
    process.exit(1)
  }
  console.log('[release] 即将发布 v' + version + ' 到 ' + slug + '（会创建 GitHub Release 并上传三样产物）')
}

run('类型检查（tsc -b）', [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-b'])
run('渲染层构建（vite build）', [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build'])
run('主进程构建（压缩、不带 sourcemap）', [path.join(ROOT, 'scripts/build-electron.mjs')], { MOJI_RELEASE: '1' })
// 始终 --publish never：上传交给 gh（理由见文件头）。这一步会正常写出 latest.yml
run('打包安装包（electron-builder · NSIS）', [
  path.join(ROOT, 'node_modules/electron-builder/cli.js'),
  '--win',
  'nsis',
  '--publish',
  'never',
])

console.log('')
if (!publish) {
  console.log('[release] 完成：release/' + exeName + '（含 .blockmap 与 latest.yml）')
  console.log('[release] 要发布就跑 npm run release:publish。')
  process.exit(0)
}

const files = checkLocalArtifacts()
const title = '归一 Unyra ' + tag
/*
 * 正文按版本号找：release-notes/v0.1.1.md。
 * 为什么带版本号而不是一个固定的 release-notes.md：固定名字的文件在下一版会被
 * 原样再用一次——把上一版的说明当成这一版的发出去，而且不报错。
 * 找不到就用 GitHub 按 PR 自动生成的那份，不会静默套用旧文案。
 */
const notesFile = path.join(ROOT, 'release-notes', tag + '.md')
const notesArgs = existsSync(notesFile) ? ['--notes-file', notesFile] : ['--generate-notes']

console.log('[release] 创建 GitHub Release ' + tag)
let created = gh([
  'release', 'create', tag,
  '-R', slug,
  '--target', 'main',
  '--title', title,
  '--latest',
  ...notesArgs,
  ...files,
])
if (!created.ok && /already exists|already_exists/i.test(created.out)) {
  // 上一次可能只传了一半（线上真发生过）：补文件 + 改标题，不重复建 release
  console.log('[release] 这个 tag 的 Release 已经在了，改成补传文件并更新标题')
  const up = gh(['release', 'upload', tag, '-R', slug, '--clobber', ...files])
  if (!up.ok) {
    console.error('[release] 补传失败：' + up.out)
    process.exit(1)
  }
  created = gh(['release', 'edit', tag, '-R', slug, '--title', title, '--latest', ...notesArgs])
}
if (!created.ok) {
  console.error('[release] 创建/更新 Release 失败：' + created.out)
  process.exit(1)
}

// 最后一步不是走过场：发出去的东西与本地对不上时，退出码非零（见 verify-release.mjs）
run('发布后自检（线上 vs 本地）', [path.join(ROOT, 'scripts/verify-release.mjs')])

console.log('')
console.log('[release] 完成：https://github.com/' + slug + '/releases/tag/' + tag)
if (existsSync(notesFile)) {
  console.log('[release] 正文取自 release-notes/' + tag + '.md。')
} else {
  console.log('[release] 正文是 GitHub 按 PR 自动生成的；想自己写就放一份 release-notes/' + tag + '.md 再发，')
  console.log('          或者发完用 gh release edit ' + tag + ' -R ' + slug + ' --notes-file <文件> 改。')
}
