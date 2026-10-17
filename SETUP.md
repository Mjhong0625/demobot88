# DemoBet88 Demo Bot + 管理后台 部署指南

一个服务同时跑两样东西：**Telegram Bot** 和 **管理后台网页**。后台里改的菜单按钮、欢迎页、FAQ、活动、公告排程、素材，bot 立即同步，不需要重新部署。

## 后台功能
| 页面 | 功能 |
|---|---|
| 工作总览 | 新增用户、绑定Giftcode、签到人数、互动人数（bot 实际记录），7/30 天趋势图，待办提醒 |
| 发文排程 | 写文案、选素材、选时间，草稿/确认排程，到点自动发送，含 Telegram 预览与「发送测试」 |
| 素材库 | 上传图片/视频，自动转成 Telegram file_id，发送时不用再下载 |
| 机器人设置 | 菜单按钮（增删、排序、改文字、内置功能/文字页/外部链接）、欢迎页、FAQ、限时活动 |
| 操作记录 | 后台每次修改的记录 |

## 部署步骤
1. **GitHub**：新建 Private repo，上传 `bot.js`、`admin.js`、`store.js`、`package.json`、`public/index.html`、`.gitignore`、`.env.example`（注意 `public` 文件夹要一起传）。
2. **Railway**：New Project → Deploy from GitHub repo。
3. **Variables**（用 Raw Editor 一次贴）：
   ```
   BOT_TOKEN=你的Token
   ADMIN_PASSWORD=你自己设的密码
   STORAGE_CHAT_ID=（先留空，见下一步）
   DATA_DIR=/data
   ```
4. **挂 Volume**：Railway 服务 → Settings → Volumes → Mount path 填 `/data`。没挂的话后台设置在重新部署后会重置，只适合临时演示。
5. **取得 STORAGE_CHAT_ID**：部署成功后，私聊 bot 发 `/chatid`，把回覆的 Chat ID 填进 `STORAGE_CHAT_ID`，让服务重启。
6. **开启后台网址**：服务 → Settings → Networking → Generate Domain（或绑自己的域名，例如 `desk.mjhco.com`，在域名 DNS 加 CNAME 指向 Railway 给的地址）。用 `ADMIN_PASSWORD` 登入。

⚠️ Railway 若出现变量读不到值，直接换一个新的变量名重新加。启动 log 会印出 `[环境变量检查]`，显示「（未设置）」就是没读到。

## 怎么发布一则排程公告
1. 后台「素材库」上传图片或视频
2. 「发文排程」→ 新建公告 → 填标题、发布位置（群组/频道 ID 或 @用户名，bot 必须是该群组/频道管理员）、正文、选素材、选时间
3. 保存方式选「确认排程」→ 保存。到点 bot 自动发出，状态变成「已发送」
4. 想先看效果：点「发送测试到我的聊天」

## 现场展示建议
1. 手机打开 bot 走一遍用户端（签到、抽奖、邀请、活动）
2. 打开后台，在「机器人设置」改一个按钮文字或 FAQ，保存
3. 回手机再点，立刻看到变化（这是最有说服力的一幕）
4. 后台新建一则公告排在 1 分钟后，现场看它自动发出
5. bot 里点「内部功能展示 → 今日发文」，读到的就是后台刚排的公告

## 注意事项
- 会员资料（积分、签到、推荐）仍在记忆体，重启会清空；后台配置与素材记录存在 `DATA_DIR`
- 只有 1 个管理员密码，没有多账号与权限分级；正式多客户版需另行开发
- file_id 只对当前这个 bot 有效，换 bot 要重新上传素材
- 图片上限 10MB，视频上限 50MB（Telegram Bot API 限制）
- 邀请链接会真实归因：好友通过 `?start=ref_xxx` 首次进入即算一笔，推荐人收到通知
- 本 demo 不接真实平台 API，不做风控异常标记
