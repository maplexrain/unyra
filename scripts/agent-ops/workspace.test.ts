/**
 * 探针分组：工作区目录（learn/workspace + workspace.* api）。
 *
 * 钉住的是「模型照着提示词调用时拿到的到底是什么」：
 * - write / read / list 的闭环：created 与 updated 的区分、落点就是节点的真实工作区目录、
 *   list 的目录在前与 dir/file 标注；
 * - 路径写法：从目标根写起（第一段是根标题）、#id、「当前」，以及节点段与文件段的边界；
 * - 错误与边界：读不到指向 list、读目录 / 写目录被拦、越界段说人话、二进制不猜内容、
 *   超长截断；没有 path 也没有当前节点时给出路。
 *
 * 共享 fixture（ok / baseStore / harness / 假工作区磁盘）见 ./harness。
 */
import { baseStore, childId, harness, ok } from './harness'

export async function workspaceTests(): Promise<void> {
  /* ---------- 1. write / read / list 的闭环 ---------- */
  {
    const h = harness(baseStore(), childId)
    const empty = await h.run('((api)=>{ return await api.workspace.list() })')
    ok(
      empty.ok && empty.content.includes('"entries":[]') && empty.content.includes('还没有文件'),
      '空目录给空清单 + 一句提示',
      empty.content.slice(0, 220),
    )

    const w = await h.run("((api)=>{ return await api.workspace.write({ path: '数据/实验.csv', content: 'a,b\\n1,2' }) })")
    ok(
      w.ok && w.content.includes('"created":true') && w.content.includes('微积分/极限/数据/实验.csv'),
      'write 建文件：回执带 created 与落点（节点路径 + 文件名）',
      w.content.slice(0, 260),
    )
    ok(
      [...h.ws.keys()].join() === 'docs/微积分/极限/workspace/数据/实验.csv',
      '文件真的落在节点目录的 workspace/ 下（docs/<目标>/<节点>/workspace/）',
      [...h.ws.keys()],
    )

    const r = await h.run("((api)=>{ const x = await api.workspace.read('数据/实验.csv'); return { head: x.content } })")
    ok(r.ok && r.content.includes('a,b') && r.content.includes('1,2'), 'read 逐字读回', r.content.slice(0, 200))

    const w2 = await h.run("((api)=>{ return await api.workspace.write({ path: '数据/实验.csv', content: 'a,b\\n3,4' }) })")
    ok(
      w2.ok && w2.content.includes('"updated":true') && w2.content.includes('整份覆盖'),
      '再写同一份：updated + 覆盖提醒',
      w2.content.slice(0, 260),
    )
  }

  /* ---------- 2. 路径写法：根标题起笔 / #id / 当前 ---------- */
  {
    const h = harness(baseStore(), childId)
    await h.run("((api)=>{ return await api.workspace.write({ path: '数据/实验.csv', content: 'x' }) })")
    const viaRoot = await h.run("((api)=>{ return await api.workspace.read('微积分/极限/数据/实验.csv') })")
    ok(viaRoot.ok && viaRoot.content.includes('"chars"'), '从目标根写起的路径也走到（第一段是根标题时吃掉）', viaRoot.content.slice(0, 200))
    const viaId = await h.run("((api)=>{ return await api.workspace.read('#n2/数据/实验.csv') })")
    ok(viaId.ok && viaId.content.includes('"chars"'), '#id 写法', viaId.content.slice(0, 200))
    const viaCur = await h.run("((api)=>{ return await api.workspace.read('当前/数据/实验.csv') })")
    ok(viaCur.ok && viaCur.content.includes('"chars"'), '「当前」别名', viaCur.content.slice(0, 200))
  }

  /* ---------- 3. list 的形状：目录在前、子目录可继续列 ---------- */
  {
    const h = harness(baseStore(), childId)
    await h.run("((api)=>{ return await api.workspace.write({ path: '数据/实验.csv', content: 'x' }) })")
    await h.run("((api)=>{ return await api.workspace.write({ path: '要点.md', content: '# 要点' }) })")
    const l = await h.run("((api)=>{ const x = await api.workspace.list(); return { names: x.entries.map((e) => e.name + ':' + e.kind) } })")
    ok(
      l.ok && l.content.includes('数据:dir') && l.content.includes('要点.md:file'),
      'list 目录在前、kind 标注 dir/file',
      l.content.slice(0, 240),
    )
    const sub = await h.run("((api)=>{ const x = await api.workspace.list('数据'); return { names: x.entries.map((e) => e.name) } })")
    ok(sub.ok && sub.content.includes('实验.csv'), 'list 可以钻进子目录（节点路径 + 子目录）', sub.content.slice(0, 240))
  }

  /* ---------- 4. 错误与边界 ---------- */
  {
    const h = harness(baseStore(), childId)
    await h.run("((api)=>{ return await api.workspace.write({ path: '数据/实验.csv', content: 'x' }) })")

    const miss = await h.run("((api)=>{ return await api.workspace.read('数据/没有.csv') })")
    ok(
      !miss.ok && miss.content.includes('没有这个文件') && miss.content.includes('workspace.list'),
      '读不到给可读原因并指向 list',
      miss.content.slice(0, 220),
    )
    const dirRead = await h.run("((api)=>{ return await api.workspace.read('数据') })")
    ok(!dirRead.ok && dirRead.content.includes('是目录'), '读一个真实目录：说准它是目录而不是「没有文件」', dirRead.content.slice(0, 200))
    const dirWrite = await h.run("((api)=>{ return await api.workspace.write({ path: '极限', content: 'x' }) })")
    ok(!dirWrite.ok && dirWrite.content.includes('文件名'), '写到目录上被拦（节点路径本身是目录）', dirWrite.content.slice(0, 220))
    const traversal = await h.run("((api)=>{ return await api.workspace.write({ path: '数据/../../x.txt', content: 'x' }) })")
    ok(!traversal.ok && traversal.content.includes('路径段不合法'), '越界段被挡且说人话', traversal.content.slice(0, 200))
  }

  /* ---------- 5. 二进制不猜、超长截断 ---------- */
  {
    const h = harness(baseStore(), childId)
    await h.run("((api)=>{ return await api.workspace.write({ path: 'blob.bin', content: 'a\\0b' }) })")
    const bin = await h.run("((api)=>{ return await api.workspace.read('blob.bin') })")
    ok(!bin.ok && bin.content.includes('读不出文本'), '含空字节的文件按二进制拒读', bin.content.slice(0, 200))

    await h.run("((api)=>{ return await api.workspace.write({ path: 'big.txt', content: 'x'.repeat(45000) }) })")
    const big = await h.run("((api)=>{ const x = await api.workspace.read('big.txt'); return { t: x.truncated, total: x.totalChars, len: x.content.length } })")
    ok(
      big.ok && big.content.includes('"t":true') && big.content.includes('"total":45000') && big.content.includes('"len":40000'),
      '超长截断：truncated + totalChars + 给出的长度',
      big.content.slice(0, 220),
    )
  }

  /* ---------- 6. 没有 path 也没有当前节点 ---------- */
  {
    const h = harness(baseStore(), '')
    const nocur = await h.run('((api)=>{ return await api.workspace.list() })')
    ok(
      !nocur.ok && nocur.content.includes('没有指定路径'),
      '没有 path 也没有当前节点：说清楚下一步怎么办',
      nocur.content.slice(0, 220),
    )
  }
}
