# 前端分工说明（给 GPT 和 Claude）

| 文件 | 负责人 | 内容 |
|---|---|---|
| `public/index.html` | GPT | 页面外壳：登入页、侧栏、顶栏、页脚的 HTML 与基础样式 |
| `public/mjh-ui.css` | GPT | 视觉样式 |
| `public/mjh-ui.js` | GPT | 纯展示增强（抽屉导航、面包屑、无障碍），不碰接口 |
| `public/app.css` | GPT 可美化 | app.js 新增元素的功能性样式（class 以 `x-` 开头），保持 class 名称不变即可改外观 |
| `public/app.js` | **Claude** | 所有交互逻辑与接口调用、页面内容渲染。GPT 请勿修改 |
| `bot.js` `admin.js` `store.js` | **Claude** | 后端 |

## GPT 美化时必须保留的东西
1. `index.html` 里这些 id 不能改名或删除（app.js 靠它们工作）：`login` `lf` `un` `pw` `lerr` `showPassword` `app` `nav` `main` `modalRoot` `logout` `botst` `wsN` `wsL` `breadcrumb` `workspaceDate` `mobileOpen` `initialLoading`，以及侧栏里的 `.foot`（app.js 会往里插入账号与「修改密码」）。
2. 登入页必须有「账号」`#un` 和「密码」`#pw` 两个输入框。账号留空等同于 `owner`。
3. app.js 渲染的内容会用到这些 class：`btn ghost danger sm card stat grid4 two seg tabs item chip(draft/scheduled/sent/failed) mask modal(l/r) tg(hd/bd) bub kb media mi row rowctl bcard hint empty toast(err) top lead`，以及 `app.css` 里的 `x-` 系列（含机器人资料页的 `x-prof x-av x-pv x-crow` 等）。可以重新设计它们的外观，但不要改名。
4. 页面清单（hash 路由）：`#overview #schedule #media #bot #staff #log`。其中 `#bot #staff #log` 只有超级管理员看得到，管理员只有前三个。导航由 app.js 按权限生成，不用在 HTML 里写死。

## 想新增页面或功能怎么办
先告诉 Claude，由 Claude 在 `admin.js` 加接口、在 `app.js` 加交互，GPT 再美化。

## V4 UI 完成版（2026-10-17）

本次变更仅限 public/index.html、public/mjh-ui.css、public/mjh-ui.js。
保留 public/app.js、public/app.css、admin.js、bot.js、store.js 原始字节。

- 延续黑色侧栏、米白内容区、荧光绿主操作；提高辅助文字对比。
- 统一员工权限卡片、机器人资料预览、发布位置、素材及发文编辑器。
- 手机端按钮和输入框尺寸优化；表格横向滚动，预览自适应排列。
- 移除数据卡片固定上升箭头，避免未计算增长率却暗示增长。
- 弹窗添加对话框语义、焦点限制与关闭后的焦点恢复。
- 保留权限生成导航、品牌名称、所有接口及发送逻辑。
- app.css 在 mjh-ui.css 前加载，确保新增页面获得统一视觉覆盖。

部署：将本包中的 public/index.html、public/mjh-ui.css、public/mjh-ui.js
覆盖到同一 V4 项目；其余项目文件保持原样。启动方式沿用 SETUP.md。
无需重新配置环境变量或迁移数据库。更新后刷新页面，必要时强制刷新缓存。

验证：JS 语法检查通过；必要 DOM ID 完整且唯一；受保护代码逐字节一致。
当前环境没有可用浏览器，尚未完成真实浏览器视觉与交互验收。
上线前请在桌面和手机检查登录、员工权限、弹窗、素材上传与公告预览；
使用测试群验证发送及排程。本次未连接 Telegram、未发布到正式域名。

## 客户品牌优先版
- 侧栏顶部展示客户 Logo 与接口提供的品牌名称。MJH & Co 仅在侧栏左下方署名。
- 登录页与浏览器标题以客户品牌为主。
- 新增 public/brand-config.js：设置 name 与 logoUrl，例如 /brand-logo.png，并将图片放入 public/。
- 不填 Logo 或图片加载失败时显示品牌首字。未提供真实 Logo，本包不含虚构客户 Logo。
- 本次没有新增后台上传 Logo 接口；后续可由 Claude 将品牌配置接入后台设置。
- 更新需覆盖 index.html、mjh-ui.css、mjh-ui.js，并新增 brand-config.js。

## V6 新增元素（GPT 改黑白风格时请保留结构，只调样式）
- 发文窗口：`#bArea`（按钮编辑区，`.x-brow`、`.x-rm`）、预览里的 `#pvB`（`.x-pvbtns`）。
- 帖子数据弹窗（点已发送的帖子打开）：`.modal.x-stats`、`.x-sg` / `.x-sc`（四个数字卡片）、`.x-bt`（按钮表）、`.x-bars` / `.x-bl`（24 小时柱状）。
- 总览第二排：群人数卡片（`.x-mn` 人数）、最佳发布时间卡片，沿用 `.two` / `.card` / `.item`。
- 机器人设置新增「每周报告」页签：`.x-pre` 预览框。
- 访客只读模式：`body.x-ro`、`.x-guest-note`。
这些功能样式都在 `app.css`，换色请改 `mjh-ui.css` 里的颜色变量。
