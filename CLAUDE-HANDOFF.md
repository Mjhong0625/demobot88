# V4 UI 合并交接（以本文件为准）

## 用户最新决定
- 登录页：单卡片，标题「Telegram Bot 后台登入」，账号、密码、登入按钮。
- 删除登录页宣传区、工作台口号及普通页面长介绍。素材清理、错误、权限等必要说明保留。
- 左上角使用当前机器人头像和 API 品牌名；MJH & Co 仅左下角署名。
- 无需独立客户 Logo 配置，旧 brand-config.js 已弃用。

## 合并文件
public/index.html、public/mjh-ui.css、public/mjh-ui.js。
app.js、app.css、bot.js、store.js 原样保留。

## 唯一后台调整
admin.js 的 GET /api/bot-profile/avatar 中 need("bot") 改为 need("content")。
让已登录的普通管理员也能读取同一品牌机器人的头像；仍须登录。
POST / DELETE 原权限不变。未增加公开接口，也未修改发送或活动逻辑。

## 头像显示
登入后从已有头像接口取图，回到窗口时刷新；资料页头像变更也会触发刷新。
无头像或请求失败回退品牌首字。通过 BotFather 外部更换后可重新聚焦窗口或刷新页面。

## 验证与部署
已检查 JavaScript 语法、必要 DOM ID，以及未修改文件的逐字节一致性。
当前环境无浏览器，未完成视觉及真实 Telegram 验收；未部署。
请验证：两种角色登录、头像显示、更换/移除头像、手机版登录及导航。
本包包括此前 V4 UI 优化，无需叠加旧包。README-UI 中早期独立 Logo 配置说明已被本说明取代。
