# DemoBet88 Demo Bot 部署指南

这是给客户看的**功能展示 Demo**，不是正式上线系统。数据全部记录在你自己的 Google Sheet，不对接任何真实游戏平台/会员系统。

---

## 这个 Demo 展示什么

**用户端**（客户可以自己拿手机点开体验）：
- 🆔 绑定游戏ID（模拟绑定，输入任何文字即可）
- 📅 每日签到（真实记录连续天数、发积分）
- 💎 查询积分
- 🎰 幸运抽奖（模拟开奖动画）
- ❓ FAQ 常见问题（注册/充值/提现教学）

**内部工作群端**：
- 📋 每天 09:00 自动发送「今日发文与任务提醒」（示范内容，正式版会读真实排程表）
- 📊 手动指令模拟「昨日发文数据简报」
- 也可以随时手动触发测试，不用等到早上9点

---

## 部署步骤（跟之前 Josephy 那个 bot 完全一样的流程）

### 第一步：申请 Bot Token
跟 `@BotFather` 走 `/newbot`，拿到 Token。

### 第二步：建立 Google Sheet + 服务账号
1. 建一个新的 Google Sheet
2. 到 [console.cloud.google.com](https://console.cloud.google.com/) 建立服务账号，下载 JSON 金钥
3. 把服务账号的 email 加进 Google Sheet 的共享权限（编辑者）
4. 拿到 Sheet ID（网址 `/d/` 和 `/edit` 之间那段）

### 第三步：部署到 Railway
1. 把这个文件夹上传到一个新的 GitHub repo（**Private**）
2. Railway → New Project → Deploy from GitHub repo
3. 填入 Variables：

   | 变量名 | 填入内容 |
   |---|---|
   | `BOT_TOKEN` | 第一步的 Token |
   | `GOOGLE_SHEET_ID` | 第二步的 Sheet ID |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | 服务账号 email |
   | `GOOGLE_PRIVATE_KEY` | 服务账号私钥（整段贴上） |
   | `BRAND_NAME` | 想展示的品牌名，例如 `DemoBet88` |
   | `INTERNAL_GROUP_ID` | 内部工作群 Chat ID（见下方） |

⚠️ **如果保存 Variables 后 log 显示读不到值，直接换一个新的变量名重新加**（这是 Railway 平台本身的已知问题，遇到不用深究原因，换名字最快）。

### 第四步：拿内部工作群 Chat ID
1. 把 Bot 加进你的内部工作群
2. 群里发送 `/start`（bot 目前没有专门的 `/chatid` 指令，可以暂时用 [getUpdates API](https://core.telegram.org/bots/api#getupdates) 查，或跟我说我可以另外加一个 `/chatid` 指令）

---

## 怎么现场展示给客户看

1. 打开 Telegram，找到你的 demo bot，发送 `/start`
2. 带客户走一遍：绑定 → 签到 → 查积分 → 抽奖 → FAQ
3. 切到内部工作群，手动发送指令 `/demo_daily_reminder` 和 `/demo_daily_report`，让客户看到「团队协作端」长什么样
4. 强调：这只是功能展示，正式合作后会依照客户真实平台的账号系统、积分规则、奖励机制去客制化开发

---

## 重要提醒

- 这个 demo 目前**不做风控异常标记**功能（没有真实交易数据，做了也没有意义，用口头说明即可）
- 会员绑定、积分兑换都是**模拟数据**，不是真的对接游戏平台
- 如果客户确认要签约，正式开发时需要客户提供：真实平台的 API 文档、串接权限、积分/奖励规则细节
