# 贡献指南

谢谢你愿意看这份文件。归一是个人项目，但它认真接受每一个 contribution——报一个够清楚的
bug、修一个错字、补一段文档，都算。

## 开始之前

- 有想法先开一个 [Issue](https://github.com/maplexrain/unyra/issues) 说一声，或者去 QQ
  交流群（851412626）聊：大改动在没人知道的情况下做完，很容易与作者的计划撞车，
  白辛苦一场对谁都不好。
- 报 bug 请带上版本号（「设置 → 关于」里能查到）、复现步骤与预期/实际行为。

## 本地跑起来

```bash
npm install
node node_modules/electron/install.js   # Electron 44 起二进制不再随 npm install 下载
npm run dev                             # Vite + Electron，渲染层 HMR，主进程改动自动重建重启
```

> 国内网络卡在 GitHub 时：`$env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"`（PowerShell）。

## 提交改动

1. 从 `main` 切分支，命名跟随现有风格：`feat/xxx`、`fix/xxx`、`docs/xxx`。
2. 提交信息用约定式前缀加中文描述，例如 `feat(exam): 试卷行加「考试」徽标`、
   `fix(ui): 拖动页签不再误触分屏`。前缀取 feat / fix / docs / refactor / chore，
   scope 尽量给一个。
3. **提交前必须全绿**（这是仓库里唯一的硬性规矩）：

   ```bash
   npm run test        # vitest 单测 + agent 探针 + 更新链路测试，一次跑完
   npm run lint
   ```

   改了 UI 的话，最好自己在应用里把相关界面过一遍再提交。

   这套同时是合并的门禁：CI 会在每个 PR 上原样跑一遍（见 `.github/workflows/ci.yml`），
   红了就修，别绕。

## 代码习惯

- 注释用中文，解释「为什么」而不是「做了什么」；每个文件的头部注释先说清
  「这个文件负责什么」——这是仓库一贯的写法，新文件请照做。
- 不轻易引入新依赖：这个仓库对依赖很克制，多数轮子是自己写的（Markdown 渲染、
  插件系统、快捷键都是）。真需要，先在 Issue 里说明理由。
- 改动尽量小而聚焦：一个 PR 解决一件事，不顺手重构别的。

## 文档

凡是用户看得见的行为变化，请顺手更新 `docs/` 下对应的文档——这个仓库的文档不是事后
补的摆设，它就是开发方式的一部分。
