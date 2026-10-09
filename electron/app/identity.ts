/**
 * 应用身份：AppUserModelID。Windows 的任务栏分组、通知、固定项都按它认「这是哪个应用」，
 * **图标也从带这个 AUMID 的快捷方式上取**（不是从窗口图标）。
 *
 * 为什么单独一份而不是把字符串写在 main.ts 里：它必须与 electron-builder.yml 的 appId
 * 逐字一致——安装器建的开始菜单快捷方式带的就是那个 appId。两边写岔了不会报任何错，
 * 只是运行中的窗口与快捷方式对不上号，Windows 退回「exe 自带的图标」，
 * 源码运行时就表现为那颗 Electron 原子。tests/appIdentity.test.ts 钉着这条一致性。
 */
export const APP_ID = 'com.moji.guiyi'

/**
 * 运行时真正用的 AUMID：**源码运行另起一个**（后缀 .dev），不冒充安装版的身份。
 *
 * 为什么非分不可（2026-10 真踩过）：
 * 源码运行的 exe 是 node_modules 里的 electron.exe。用户把开发版固定到任务栏 / 开始菜单时，
 * Windows 会写下一条快捷方式：目标 electron.exe、图标＝exe 自带的（Electron 原子），
 * 而 AUMID 抄的是当时那个窗口的——也就是安装版的身份。于是**从此安装版的任务栏图标
 * 也变成 Electron 原子**：Windows 按 AUMID 找到那条快捷方式，取它的图标，窗口自己的
 * icon 反而不算数了（实测：同一枚窗口图标，AUMID 撞上那条快捷方式时显示原子，
 * 换一个没被登记的 AUMID 就正常显示）。开发版带 .dev 之后，最坏也只是开发版自己被弄脏。
 */
export const appUserModelId = (packaged: boolean): string => (packaged ? APP_ID : APP_ID + '.dev')
