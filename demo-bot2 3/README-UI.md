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
3. app.js 渲染的内容会用到这些 class：`btn ghost danger sm card stat grid4 two seg tabs item chip(draft/scheduled/sent/failed) mask modal(l/r) tg(hd/bd) bub kb media mi row rowctl bcard hint empty toast(err) top lead`，以及 `app.css` 里的 `x-` 系列。可以重新设计它们的外观，但不要改名。
4. 页面清单（hash 路由）：`#overview #schedule #media #bot #staff #log`。其中 `#bot #staff #log` 只有超级管理员看得到，管理员只有前三个。导航由 app.js 按权限生成，不用在 HTML 里写死。

## 想新增页面或功能怎么办
先告诉 Claude，由 Claude 在 `admin.js` 加接口、在 `app.js` 加交互，GPT 再美化。
