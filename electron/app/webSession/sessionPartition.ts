/**
 * 内置浏览器的分区常量：webSession 门面与各子模块共用的地基。
 */

/**
 * 内置浏览器的分区。渲染层 <webview partition> 与这里是**同一个字符串**（两处必须一致，
 * 各写一份、注释互指）：强制走独立分区，guest 永远摸不到应用自己的 Cookie。
 */
export const WEB_PARTITION = 'persist:web'
