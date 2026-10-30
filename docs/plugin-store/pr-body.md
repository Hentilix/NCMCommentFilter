新增 NCMCommentFilter：按当前网易云账号的用户黑名单过滤专辑、单曲评论及评论中的被回复内容，过滤后不留空白占位。

- 源码：https://github.com/Hentilix/NCMCommentFilter
- 作者：Hentilix
- 插件 ID：`ncm-comment-filter`
- 版本：`0.2.4`
- BetterNCM：`>=1.3.1`
- 网易云音乐：`>=3.1.41 <=3.1.42`，支持 3.x；已保留具体构建及资源版本检查。
- 预览图：`preview.jpg`，640 × 636，约 48 KB。
- 设置页提供可通过外部浏览器打开的源代码仓库和 Issues 链接。
- `.betterncm-ignore` 排除开发文件；同步内容仅为 `manifest.json`、`main.js` 和 `preview.jpg`。
- 纯 JavaScript 插件，无原生组件，不需要编译；本地打包脚本直接打包上述文件。

验证：6 项核心测试及 6 项浏览器回归测试通过；设置页链接、键盘操作、窄窗口和明暗背景检查通过；本地插件包内容与源码一致。
