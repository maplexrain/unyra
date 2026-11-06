// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { BROWSER_RUNTIME_INIT_SCRIPT } from '../src/learn/web/browserRuntimeScript'

describe('browserRuntimeScript：页面内运行时深度穿透与动作仿真', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete (window as any).__agentRuntimeReady
    delete (window as any).__agentNodeMap
    delete (window as any).__findAgentNode
    delete (window as any).__agentIndex
    delete (window as any).__agentClick
    delete (window as any).__agentFill
    delete (window as any).__agentType
    delete (window as any).__agentInspect
    delete (window as any).__agentText
    delete (window as any).__agentPress
    delete (window as any).__agentScroll
    delete (window as any).__agentQuery
    delete (window as any).__agentWaitFor
    delete (window as any).__agentEval
    delete (window as any).__captureTokens
    delete (window as any).__agentPrepareElementCapture
    delete (window as any).__agentGetCaptureSlice
    delete (window as any).__agentCleanupElementCapture
    delete (window as any).__agentElementToImage
    eval(BROWSER_RUNTIME_INIT_SCRIPT)
  })

  it('完美支持 Shadow DOM 自定义组件嵌套、解决 Illegal invocation 并统一 isEditable 判定', async () => {
    // 构造模拟 B 站评论区结构：
    // <bili-comment-box> (shadow host)
    //   #shadow-root
    //     <button id="sort-latest">最新</button>
    //     <bili-comment-rich-textarea> (nested shadow host)
    //       #shadow-root
    //         <div class="editor" contenteditable="true" placeholder="评论千万条，等你发一条"></div>
    //     <button class="brt-btn">发布</button>

    const commentBox = document.createElement('bili-comment-box')
    document.body.appendChild(commentBox)
    const boxShadow = commentBox.attachShadow({ mode: 'open' })

    const sortButton = document.createElement('button')
    sortButton.id = 'sort-latest'
    sortButton.textContent = '最新'
    boxShadow.appendChild(sortButton)

    const richTextarea = document.createElement('bili-comment-rich-textarea')
    boxShadow.appendChild(richTextarea)
    const textareaShadow = richTextarea.attachShadow({ mode: 'open' })

    const innerEditor = document.createElement('div')
    innerEditor.className = 'editor'
    innerEditor.setAttribute('contenteditable', 'true')
    innerEditor.setAttribute('placeholder', '评论千万条，等你发一条')
    textareaShadow.appendChild(innerEditor)

    const sendBtn = document.createElement('button')
    sendBtn.className = 'brt-btn'
    sendBtn.textContent = '发布'
    boxShadow.appendChild(sendBtn)

    // 1. 生成索引：验证 Shadow 内部可交互元素全部被分配编号（包括内部的发布按钮与最新按钮）
    const indexResult = (window as any).__agentIndex()
    expect(indexResult.text).toContain('bili-comment-rich-textarea[editable]')
    expect(indexResult.text).toContain('评论千万条，等你发一条')
    expect(indexResult.text).toContain('button.brt-btn "发布"')

    const textareaId = Number(richTextarea.getAttribute('data-agent-id'))
    const sendBtnId = Number(sendBtn.getAttribute('data-agent-id'))
    expect(textareaId).toBeGreaterThan(0)
    expect(sendBtnId).toBeGreaterThan(0)

    // 2. 验证 inspect 的 isEditable 与 index 完全一致，并返回 resolvedTag: 'div' 与 text
    const inspectResult = (window as any).__agentInspect(textareaId)
    expect(inspectResult.ok).toBe(true)
    expect(inspectResult.tag).toBe('bili-comment-rich-textarea')
    expect(inspectResult.resolvedTag).toBe('div')
    expect(inspectResult.isEditable).toBe(true)
    expect(inspectResult.placeholder).toBe('评论千万条，等你发一条')

    // 3. 验证 fill：命中 shadow host 自定义元素时，绝不抛出 Illegal invocation，而是下钻到真实 contenteditable 并输入
    const fillResult = (window as any).__agentFill(textareaId, '这是测试评论内容')
    expect(fillResult.ok).toBe(true)
    expect(fillResult.tag).toBe('bili-comment-rich-textarea')
    expect(fillResult.resolvedTag).toBe('div')
    expect(fillResult.resolvedType).toBe('contenteditable')
    expect(fillResult.wrote).toBe('这是测试评论内容'.length)
    expect(innerEditor.innerText || innerEditor.textContent).toContain('这是测试评论内容')

    // 4. 验证 fill 命中外层包裹容器 bili-comment-box 时也能自动下钻输入
    const boxId = Number(commentBox.getAttribute('data-agent-id'))
    expect(boxId).toBeGreaterThan(0)
    const fillBoxResult = (window as any).__agentFill(boxId, '第二条评论', { clear: false })
    expect(fillBoxResult.ok).toBe(true)
    expect(fillBoxResult.resolvedTag).toBe('div')

    // 5. 验证 type：逐字符输入仿真与 IME
    const typeResult = await (window as any).__agentType(textareaId, '肖申克的救赎')
    expect(typeResult.ok).toBe(true)
    expect(typeResult.typedChars).toBe(6)
    expect(typeResult.resolvedTag).toBe('div')

    // 6. 验证 CSS 选择器跨 Shadow DOM 穿透查找 (Deep QuerySelector 及空格后代穿透)
    const foundDirect = (window as any).__findAgentNode('bili-comment-rich-textarea')
    expect(foundDirect).toBe(richTextarea)

    const foundInner = (window as any).__findAgentNode('[contenteditable="true"]')
    expect(foundInner).toBe(innerEditor)

    const foundCombinator = (window as any).__findAgentNode('bili-comment-box >>> button#sort-latest')
    expect(foundCombinator).toBe(sortButton)

    const foundSpaceDescendant = (window as any).__findAgentNode('bili-comment-box .brt-btn')
    expect(foundSpaceDescendant).toBe(sendBtn)

    // 7. 验证 click 穿透 Shadow DOM 并派发 composed: true
    let buttonClicked = false
    let clickComposed = false
    sendBtn.addEventListener('click', (ev) => {
      buttonClicked = true
      clickComposed = ev.composed
    })

    const clickResult = (window as any).__agentClick(sendBtnId)
    expect(clickResult.ok).toBe(true)
    expect(buttonClicked).toBe(true)
    expect(clickComposed).toBe(true)
  })

  it('列表模式折叠保护：绝不折叠基础 DIV 布局容器，a 链接带 href 属性', async () => {
    // 构造模拟 B 站页面左侧布局容器：div.left-container 内有 8 个主要布局 div
    const leftContainer = document.createElement('div')
    leftContainer.className = 'left-container'
    document.body.appendChild(leftContainer)

    for (let i = 1; i <= 8; i++) {
      const section = document.createElement('div')
      section.className = `section-${i}`
      const link = document.createElement('a')
      link.href = `https://bilibili.com/bangumi/play/ep${i}`
      link.textContent = `第 ${i} 集 剧集入口`
      section.appendChild(link)
      leftContainer.appendChild(section)
    }

    const indexRes = (window as any).__agentIndex()
    // 必须保留布局容器，不能整区折叠成 [列表: 共8项 div]
    expect(indexRes.text).not.toContain('共8项 div')
    // a 链接必须带有 [href] 标识
    expect(indexRes.text).toContain('a[href="/bangumi/play/ep1"]')
    expect(indexRes.text).toContain('第 1 集 剧集入口')
  })

  it('query 全域多选检索：跨 Shadow 穿透枚举所有候选并自动分配 id', () => {
    const box = document.createElement('div')
    box.id = 'comment-area'
    document.body.appendChild(box)
    const shadow = box.attachShadow({ mode: 'open' })

    const btn1 = document.createElement('button')
    btn1.className = 'reply-btn send-btn'
    btn1.textContent = '点赞'
    shadow.appendChild(btn1)

    const btn2 = document.createElement('button')
    btn2.className = 'send-btn'
    btn2.textContent = '发送'
    shadow.appendChild(btn2)

    const queryRes = (window as any).__agentQuery('.send-btn')
    expect(queryRes.ok).toBe(true)
    expect(queryRes.count).toBe(2)
    expect(queryRes.matches[0].text).toContain('点赞')
    expect(queryRes.matches[1].text).toContain('发送')
    expect(queryRes.matches[0].id).toBeGreaterThan(0)
    expect(queryRes.matches[1].id).toBeGreaterThan(0)
  })

  it('inspect 支持 nth 索引与 text/visible 字段', () => {
    const a1 = document.createElement('a')
    a1.className = 'ep-link'
    a1.href = '/ep1'
    a1.textContent = '第一集'
    document.body.appendChild(a1)

    const a2 = document.createElement('a')
    a2.className = 'ep-link'
    a2.href = '/ep2'
    a2.textContent = '第二集'
    document.body.appendChild(a2)

    const inspectFirst = (window as any).__agentInspect('a.ep-link', { nth: 0 })
    expect(inspectFirst.ok).toBe(true)
    expect(inspectFirst.matchCount).toBe(2)
    expect(inspectFirst.text).toContain('第一集')
    expect(inspectFirst.href).toBe('/ep1')

    const inspectSecond = (window as any).__agentInspect('a.ep-link', { nth: 1 })
    expect(inspectSecond.ok).toBe(true)
    expect(inspectSecond.text).toContain('第二集')
    expect(inspectSecond.href).toBe('/ep2')
  })

  it('waitFor 智能等待节点与文本', async () => {
    setTimeout(() => {
      const asyncBtn = document.createElement('button')
      asyncBtn.id = 'async-loaded'
      asyncBtn.textContent = '异步按钮'
      document.body.appendChild(asyncBtn)
    }, 100)

    const waitRes = await (window as any).__agentWaitFor('#async-loaded', { timeoutMs: 1000 })
    expect(waitRes.ok).toBe(true)
    expect(waitRes.tag).toBe('button')
    expect(waitRes.elapsedMs).toBeGreaterThan(50)
  })

  it('eval 在页面环境中执行代码并返回 JSON', async () => {
    document.title = '测试标题'
    const evalRes = await (window as any).__agentEval('return document.title + " - 已执行"')
    expect(evalRes.ok).toBe(true)
    expect(evalRes.result).toBe('测试标题 - 已执行')
  })

  it('原生 input / textarea 正常受控输入与 setter 调用', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = 'search-bar'
    document.body.appendChild(input)

    let inputEventCount = 0
    let changeEventCount = 0
    input.addEventListener('input', () => { inputEventCount++ })
    input.addEventListener('change', () => { changeEventCount++ })

    const fillResult = (window as any).__agentFill('input#search-bar', '肖申克的救赎', { pressEnter: false })
    expect(fillResult.ok).toBe(true)
    expect(fillResult.resolvedType).toBe('input')
    expect(input.value).toBe('肖申克的救赎')
    expect(inputEventCount).toBeGreaterThanOrEqual(1)
    expect(changeEventCount).toBeGreaterThanOrEqual(1)
  })

  it('错误返回健全且区分选择器未匹配与节点脱离 DOM', async () => {
    const selectorFail = (window as any).__agentInspect('.not-found-class')
    expect(selectorFail.ok).toBe(false)
    expect(selectorFail.error).toContain('选择器未匹配到任何节点')

    const idFail = (window as any).__agentInspect(88888)
    expect(idFail.ok).toBe(false)
    expect(idFail.error).toContain('未找到节点编号 [88888]')
  })

  it('DOM 元素转图片：消除浮动遮罩、解除长文章限高折叠，并在清理后恢复 DOM', async () => {
    // 构造页面结构：带有吸顶导航、遮罩弹窗、以及限高折叠的文章
    const fixedHeader = document.createElement('header')
    fixedHeader.id = 'sticky-header'
    fixedHeader.style.position = 'fixed'
    fixedHeader.style.top = '0'
    document.body.appendChild(fixedHeader)

    const modalDialog = document.createElement('div')
    modalDialog.id = 'login-modal'
    modalDialog.style.position = 'fixed'
    modalDialog.style.top = '100px'
    document.body.appendChild(modalDialog)

    const article = document.createElement('article')
    article.id = 'main-article'
    article.style.maxHeight = '300px'
    article.style.overflow = 'hidden'
    article.innerHTML = '<p>第一段</p><p>第二段</p><div class="collapsed" style="max-height: 100px;">折叠内容</div>'
    document.body.appendChild(article)

    // 1. 准备元素截图并开启防遮挡与全长展开
    const prep = (window as any).__agentPrepareElementCapture('#main-article', { isolate: true, full: true })
    expect(prep.ok).toBe(true)
    expect(prep.tag).toBe('article')
    expect(prep.token).toBeDefined()

    // 2. 验证防遮挡：不在祖先链路上的 fixed 元素已被临时隐藏
    expect(fixedHeader.style.visibility).toBe('hidden')
    expect(modalDialog.style.visibility).toBe('hidden')

    // 3. 验证长内容展开：max-height 已被解除为 none
    expect(article.style.maxHeight).toBe('none')
    const innerFold = article.querySelector('.collapsed') as HTMLElement
    expect(innerFold.style.maxHeight).toBe('none')

    // 4. 获取切片
    const slice0 = (window as any).__agentGetCaptureSlice(prep.token, 0)
    expect(slice0.ok).toBe(true)
    expect(slice0.rect.width).toBeGreaterThan(0)
    expect(slice0.rect.height).toBeGreaterThan(0)

    // 5. 执行清理：验证所有样式 100% 恢复
    const cleanup = (window as any).__agentCleanupElementCapture(prep.token)
    expect(cleanup.ok).toBe(true)
    expect(fixedHeader.style.visibility).toBe('')
    expect(modalDialog.style.visibility).toBe('')
    expect(article.style.maxHeight).toBe('300px')
    expect(innerFold.style.maxHeight).toBe('100px')
  })

  it('DOM 元素转图片：原生 canvas 元素直接提取无损图片数据', async () => {
    const canvas = document.createElement('canvas')
    canvas.id = 'game-canvas'
    canvas.width = 400
    canvas.height = 300
    document.body.appendChild(canvas)

    const prep = (window as any).__agentPrepareElementCapture('#game-canvas')
    expect(prep.ok).toBe(true)
    expect(prep.tag).toBe('canvas')
    expect(prep.directDataUrl).toContain('data:image/png')
    expect(prep.slices).toBe(1)
  })

  it('DOM 元素转 Markdown：支持图片懒加载提升、公式代码图启发式与完整 diagnostics 计数', async () => {
    const article = document.createElement('article')
    article.id = 'test-article'

    // 1. 标题与段落
    const h1 = document.createElement('h1')
    h1.textContent = '文章标题'
    const p1 = document.createElement('p')
    p1.textContent = '这是一段正文，其中调用了方法 '

    // 2. 行内代码被渲染成图片
    const codeImg = document.createElement('img')
    codeImg.setAttribute('alt', 'start()')
    codeImg.setAttribute('src', 'https://example.com/mathjax/tex?formula=start()')
    p1.appendChild(codeImg)

    const spanText = document.createElement('span')
    spanText.textContent = ' 完成初始化。'
    p1.appendChild(spanText)

    // 3. 懒加载图片（data-src）
    const lazyImg = document.createElement('img')
    lazyImg.setAttribute('data-src', 'https://example.com/lazy_picture.png')
    lazyImg.setAttribute('alt', '架构图')

    // 4. 代码块
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = 'console.log("hello");'
    pre.appendChild(code)

    article.appendChild(h1)
    article.appendChild(p1)
    article.appendChild(lazyImg)
    article.appendChild(pre)
    document.body.appendChild(article)

    const res = (window as any).__agentToMarkdown('#test-article')
    expect(res.ok).toBe(true)
    // 行内代码图转换为 `start()`
    expect(res.markdown).toContain('`start()`')
    // 懒加载图片转换为 ![架构图](https://example.com/lazy_picture.png)
    expect(res.markdown).toContain('![架构图](https://example.com/lazy_picture.png)')
    expect(lazyImg.src).toContain('https://example.com/lazy_picture.png')
    expect(lazyImg.loading).toBe('eager')

    // diagnostics 准确统计各项
    expect(res.diagnostics).toBeDefined()
    expect(res.diagnostics.headings).toBe(1)
    expect(res.diagnostics.paragraphs).toBe(1)
    expect(res.diagnostics.images).toBe(1) // 1 张架构图（公式代码图不计入正文实图）
    expect(res.diagnostics.codeBlocks).toBe(1)
  })

  it('__agentScroll：支持即时同步滚动与准确 atBottom 判定', async () => {
    const scrollRes = (window as any).__agentScroll({ by: 500 })
    expect(scrollRes.ok).toBe(true)
    expect(typeof scrollRes.scrollY).toBe('number')
    expect(typeof scrollRes.atBottom).toBe('boolean')
  })
})
