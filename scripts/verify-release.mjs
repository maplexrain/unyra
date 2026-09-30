/**
 * 发布后自检：把**已经发出去的那份 release** 与本地产物对一遍。
 *
 * 为什么需要它：发布这一步错了不会当场报错，只会让所有买家那边**悄悄坏掉**。
 * 真实踩到过一次——上传中途失败，release 建出来了、exe 也传上去了，但 latest.yml
 * 是上一版构建留下的：版本号一样、文件名一样，唯独 sha512 对不上。
 * 客户端装的时候才发现「下载回来的包校验不过」，而作者这边看不出任何异常。
 *
 * 所以这里把三件事对齐（都不需要重新下载那一百多兆）：
 *   1. release 真的存在、是**正式发布**（不是草稿/预发布），而且是 Latest；
 *   2. 三样产物齐全：安装包、.blockmap、latest.yml；
 *   3. latest.yml 里写的版本号 / 文件名 / sha512 / 体积，与**传上去的那个安装包**
 *      以及**本地刚构建出来的那个**三者一致。
 *
 * 用法：npm run release:verify        （版本取 package.json，仓库取 electron-builder.yml）
 * 私有仓库或想避免限流时先设 GH_TOKEN。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
process.chdir(ROOT)

let pass = 0
const fails = []
const ok = (cond, label, extra) => {
  if (cond) pass++
  else fails.push(label + (extra === undefined ? '' : ' | ' + JSON.stringify(extra)))
}

const version = JSON.parse(readFileSync('package.json', 'utf-8')).version
const builder = parseYaml(readFileSync('electron-builder.yml', 'utf-8'))
const pub = builder.publish?.[0] ?? {}
const slug = pub.owner + '/' + pub.repo
const tag = 'v' + version
console.log('核对 ' + slug + ' 的 ' + tag + '（本地版本 ' + version + '）')

const headers = { accept: 'application/vnd.github+json' }
if (process.env.GH_TOKEN) headers.authorization = 'Bearer ' + process.env.GH_TOKEN

async function api(pathname) {
  const res = await fetch('https://api.github.com/repos/' + slug + pathname, { headers })
  if (!res.ok) throw new Error('GitHub API ' + res.status + ' ' + pathname + '：' + (await res.text()).slice(0, 200))
  return res.json()
}

/* ---------- 1. release 本身 ---------- */

let release
try {
  release = await api('/releases/tags/' + encodeURIComponent(tag))
} catch (err) {
  console.error('FAIL 找不到这个 tag 的 release：' + tag)
  console.error(String(err.message ?? err))
  process.exit(1)
}

ok(release.draft === false, 'release 不是草稿（草稿客户端看不到，而且不报错）')
ok(release.prerelease === false, 'release 不是预发布')
ok(typeof release.body === 'string' && release.body.trim().length > 0, '写了 Release 正文（客户端悬停时显示的就是它）')

const latest = await api('/releases/latest')
ok(latest.tag_name === tag, '它就是 Latest（否则客户端取到的是另一个版本）', latest.tag_name)

/* ---------- 2. 三样产物齐全 ---------- */

const assets = new Map((release.assets ?? []).map((a) => [a.name, a]))
const ymlName = 'latest.yml'
if (!assets.has(ymlName)) {
  console.error('FAIL 发布里没有 ' + ymlName + ' —— 客户端会直接报「缺少更新所需的文件」')
  console.error('     已上传的资产：' + [...assets.keys()].join(', '))
  process.exit(1)
}

/* ---------- 3. latest.yml 与两边的安装包对齐 ---------- */

const ymlUrl = assets.get(ymlName).browser_download_url
const remoteYml = await (await fetch(ymlUrl, { headers: { accept: 'application/octet-stream' } })).text()
const meta = parseYaml(remoteYml)

ok(meta.version === version, 'latest.yml 的版本号 = package.json 的版本号', { yml: meta.version, pkg: version })

const fileName = meta.path
// 体积在 files[] 里，顶层只有 version / path / sha512 / releaseDate（踩过一次：读顶层 size 永远是 undefined）
const fileInfo = meta.files?.[0] ?? {}
ok(!!fileName, 'latest.yml 里写了安装包文件名', fileName)
ok(fileInfo.url === fileName, 'files[].url 与 path 一致', { url: fileInfo.url, path: fileName })
const remoteExe = assets.get(fileName)
ok(!!remoteExe, '那台安装包确实在发布里', [...assets.keys()])

const localExe = path.join(ROOT, 'release', fileName)
if (!existsSync(localExe)) {
  console.log('（跳过本地比对）release/' + fileName + ' 不在，先跑一次 npm run release:win')
} else {
  const buf = readFileSync(localExe)
  const sha = createHash('sha512').update(buf).digest('base64')
  ok(sha === meta.sha512, 'latest.yml 的 sha512 与本地那个安装包一致（对不上 = 客户端下载后校验失败）')
  ok(fileInfo.sha512 === meta.sha512, 'files[] 与顶层的 sha512 一致')
  ok(buf.length === fileInfo.size, 'latest.yml 的体积与本地那个安装包一致', { yml: fileInfo.size, local: buf.length })
  if (remoteExe) {
    ok(remoteExe.size === fileInfo.size, 'latest.yml 的体积与**传上去的**那个安装包一致（这一条错了就是「下载下来的包校验不过」）', {
      yml: fileInfo.size,
      remote: remoteExe.size,
    })
  }
}

ok(assets.has(fileName + '.blockmap'), '有 .blockmap（增量下载用；缺了只是每次全量下）')

/* ---------- 汇总 ---------- */

console.log('')
if (fails.length) {
  console.error('FAIL ' + fails.length + ' 项：')
  for (const f of fails) console.error('  - ' + f)
  console.error('')
  console.error('修法：把缺的资产补上去（gh release upload ' + tag + ' -R ' + slug + ' <file> --clobber），')
  console.error('或者改完代码重跑一次 npm run release:publish。')
  process.exit(1)
}
console.log('ALL OK · ' + pass + ' 项通过 · https://github.com/' + slug + '/releases/tag/' + tag)
