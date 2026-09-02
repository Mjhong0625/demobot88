// DemoBet88 展示用 Telegram Bot
// 目的：给潜在客户看一个「能实际操作」的demo，展示常见菠菜平台Telegram bot生态
//   1. 用户端：会员绑定、每日签到、积分、模拟抽奖、FAQ客服、活动通知
//   2. 内部工作群端：每日发文提醒、部门任务通知、简易数据简报（昨日发文数据）
//
// ⚠️ 这是Demo，数据全部记录在Google Sheet，不对接任何真实游戏平台/会员系统后台。
//    正式签约后，会员绑定、积分兑换等需要串接客户真实平台API才能上线真实数据。
//
// 需要的环境变量：
//   BOT_TOKEN
//   GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY
//   BRAND_NAME                - Demo品牌名称，默认 DemoBet88
//   INTERNAL_GROUP_ID         - 内部工作群 Chat ID（工作提醒/数据简报发去这里）
//   ADMIN_CHAT_ID             - 管理员私人ID（选填，测试通知用）

require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");
const cron = require("node-cron");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("缺少 BOT_TOKEN，请在环境变量中设置");
  process.exit(1);
}

const BRAND_NAME = process.env.BRAND_NAME || "DemoBet88";
const bot = new Telegraf(BOT_TOKEN);

// ---------------- Google Sheet 连接 ----------------
let doc = null;
let membersSheet = null; // 会员绑定 + 积分
let checkinSheet = null; // 签到记录
let logSheet = null; // Bot Log
let postLogSheet = null; // 模拟的「每日发文记录」，用来产生数据简报

async function getOrCreateSheet(title, headerValues) {
  let sh = doc.sheetsByTitle[title];
  if (!sh) sh = await doc.addSheet({ title, headerValues });
  return sh;
}

async function initSheet() {
  if (!process.env.GOOGLE_SHEET_ID) {
    console.warn("未设置 GOOGLE_SHEET_ID，数据功能将不会记录到表格");
    return;
  }
  const jwt = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();

  membersSheet = await getOrCreateSheet("Members", ["用户ID", "用户名", "游戏ID(模拟绑定)", "会员等级", "累积积分", "绑定时间"]);
  checkinSheet = await getOrCreateSheet("Checkin Log", ["用户ID", "用户名", "签到日期", "连续签到天数"]);
  logSheet = await getOrCreateSheet("Bot Log", ["时间", "用户ID", "用户名", "动作", "备注"]);
  postLogSheet = await getOrCreateSheet("Post Log (Demo)", ["日期", "部门", "内容标题", "状态"]);

  console.log("Google Sheet 连接成功:", doc.title);
}

async function logEvent(ctx, action, note = "") {
  try {
    if (!logSheet) return;
    const user = ctx.from;
    await logSheet.addRow({
      时间: new Date().toISOString(),
      用户ID: user.id,
      用户名: user.username ? "@" + user.username : `${user.first_name || ""}`.trim(),
      动作: action,
      备注: note,
    });
  } catch (err) {
    console.error("写入 Bot Log 失败:", err.message);
  }
}

function todayDateStrKL() {
  const now = new Date();
  const kl = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return `${kl.getFullYear()}-${String(kl.getMonth() + 1).padStart(2, "0")}-${String(kl.getDate()).padStart(2, "0")}`;
}

// ==================================================================
// 用户端功能
// ==================================================================

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🆔 绑定游戏ID", "bind_id")],
    [Markup.button.callback("📅 每日签到", "checkin")],
    [Markup.button.callback("💎 我的积分", "my_points")],
    [Markup.button.callback("🎰 幸运抽奖", "lucky_draw")],
    [Markup.button.callback("❓ 常见问题", "faq_menu")],
  ]);
}

function backButton() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅️ 返回主菜单", "back_menu")]]);
}

bot.start(async (ctx) => {
  await logEvent(ctx, "/start");
  await ctx.reply(
    `👋 欢迎体验 ${BRAND_NAME} 会员小助手 Demo！\n\n` +
      `这是一个功能展示版本，数据仅供体验，正式上线会串接真实平台后台。\n\n` +
      `请点击下方按钮开始体验：`,
    mainMenu()
  );
});

// ---- 会员绑定（模拟） ----
bot.action("bind_id", async (ctx) => {
  await ctx.answerCbQuery();
  await logEvent(ctx, "点击绑定游戏ID");
  await ctx.editMessageText(
    "🆔 会员绑定\n\n请直接在对话框输入你的游戏ID（Demo模拟，输入任何文字即可完成绑定）：",
    backButton()
  );
  ctx.session_awaiting_bind = true; // 简易状态标记（demo 用，正式版建议用更稳健的 session 机制）
  pendingBind.add(ctx.from.id);
});

const pendingBind = new Set();

bot.on("text", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  // 处理「绑定游戏ID」的下一句输入
  if (pendingBind.has(ctx.from.id)) {
    pendingBind.delete(ctx.from.id);
    const gameId = ctx.message.text.trim();
    try {
      if (membersSheet) {
        const rows = await membersSheet.getRows();
        const existing = rows.find((r) => String(r.get("用户ID")) === String(ctx.from.id));
        const uname = ctx.from.username ? "@" + ctx.from.username : `${ctx.from.first_name || ""}`.trim();
        if (existing) {
          existing.set("游戏ID(模拟绑定)", gameId);
          existing.set("绑定时间", new Date().toISOString());
          await existing.save();
        } else {
          await membersSheet.addRow({
            用户ID: ctx.from.id,
            用户名: uname,
            "游戏ID(模拟绑定)": gameId,
            会员等级: "Bronze",
            累积积分: 0,
            绑定时间: new Date().toISOString(),
          });
        }
      }
      await logEvent(ctx, "绑定游戏ID", gameId);
      await ctx.reply(`✅ 绑定成功！游戏ID：${gameId}\n（Demo模拟绑定，正式版会即时验证真实平台账号）`, mainMenu());
    } catch (err) {
      console.error("绑定失败:", err.message);
      await ctx.reply("绑定失败，请稍后再试 🙏", mainMenu());
    }
    return;
  }

  // 一般文字：弹出菜单
  await logEvent(ctx, "文字讯息", ctx.message.text.slice(0, 50));
  await ctx.reply("请点击下方按钮选择服务 👇", mainMenu());
});

// ---- 每日签到 ----
bot.action("checkin", async (ctx) => {
  await ctx.answerCbQuery();
  const today = todayDateStrKL();
  try {
    if (!checkinSheet) {
      await ctx.editMessageText("签到功能暂时无法使用，请稍后再试。", backButton());
      return;
    }
    const rows = await checkinSheet.getRows();
    const todayRow = rows.find(
      (r) => String(r.get("用户ID")) === String(ctx.from.id) && r.get("签到日期") === today
    );
    if (todayRow) {
      await ctx.editMessageText(`📅 你今天已经签到过啦！明天再来 ✅`, backButton());
      return;
    }

    // 计算连续签到天数（简易版：找最近一笔记录，若是昨天则 +1，否则重置为 1）
    const userRows = rows.filter((r) => String(r.get("用户ID")) === String(ctx.from.id));
    const lastRow = userRows[userRows.length - 1];
    let streak = 1;
    if (lastRow) {
      const lastDate = new Date(lastRow.get("签到日期"));
      const diffDays = Math.round((new Date(today) - lastDate) / 86400000);
      if (diffDays === 1) streak = parseInt(lastRow.get("连续签到天数") || "0", 10) + 1;
    }

    const uname = ctx.from.username ? "@" + ctx.from.username : `${ctx.from.first_name || ""}`.trim();
    await checkinSheet.addRow({ 用户ID: ctx.from.id, 用户名: uname, 签到日期: today, 连续签到天数: streak });
    await addPoints(ctx.from, 10);
    await logEvent(ctx, "每日签到", `连续${streak}天`);

    await ctx.editMessageText(
      `✅ 签到成功！\n🔥 连续签到 ${streak} 天\n💎 获得 10 积分`,
      backButton()
    );
  } catch (err) {
    console.error("签到失败:", err.message);
    await ctx.editMessageText("签到失败，请稍后再试 🙏", backButton());
  }
});

async function addPoints(user, points) {
  if (!membersSheet) return;
  const rows = await membersSheet.getRows();
  const existing = rows.find((r) => String(r.get("用户ID")) === String(user.id));
  if (existing) {
    const current = parseInt(existing.get("累积积分") || "0", 10);
    existing.set("累积积分", current + points);
    await existing.save();
  } else {
    const uname = user.username ? "@" + user.username : `${user.first_name || ""}`.trim();
    await membersSheet.addRow({ 用户ID: user.id, 用户名: uname, 会员等级: "Bronze", 累积积分: points });
  }
}

// ---- 我的积分 ----
bot.action("my_points", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    if (!membersSheet) {
      await ctx.editMessageText("暂时无法查询积分，请稍后再试。", backButton());
      return;
    }
    const rows = await membersSheet.getRows();
    const existing = rows.find((r) => String(r.get("用户ID")) === String(ctx.from.id));
    if (!existing) {
      await ctx.editMessageText("你还没有积分记录，先去签到或绑定游戏ID吧！", backButton());
      return;
    }
    await ctx.editMessageText(
      `💎 我的积分\n\n会员等级：${existing.get("会员等级") || "Bronze"}\n累积积分：${existing.get("累积积分") || 0}`,
      backButton()
    );
  } catch (err) {
    console.error("查询积分失败:", err.message);
    await ctx.editMessageText("查询失败，请稍后再试 🙏", backButton());
  }
});

// ---- 幸运抽奖（模拟动画）----
bot.action("lucky_draw", async (ctx) => {
  await ctx.answerCbQuery();
  await logEvent(ctx, "点击幸运抽奖");
  const spinMsg = await ctx.reply("🎰 抽奖中，请稍候...");
  const prizes = ["RM10 彩金", "RM8 彩金", "谢谢参与，再接再厉", "RM18 彩金", "免费抽奖券 x1"];
  const result = prizes[Math.floor(Math.random() * prizes.length)];

  setTimeout(async () => {
    try {
      await ctx.telegram.editMessageText(
        spinMsg.chat.id,
        spinMsg.message_id,
        undefined,
        `🎉 抽奖结果：${result}\n\n（Demo模拟抽奖，正式版会串接真实彩金/奖励发放系统）`
      );
      await logEvent(ctx, "抽奖结果", result);
    } catch (err) {
      console.error("更新抽奖结果失败:", err.message);
    }
  }, 1500);
});

// ---- FAQ ----
const FAQ = {
  register: { title: "📝 如何注册", text: "1️⃣ 点击官网注册\n2️⃣ 填写基本资料\n3️⃣ OTP验证完成注册" },
  deposit: { title: "💰 如何充值", text: "1️⃣ 选择充值方式\n2️⃣ 输入金额\n3️⃣ 完成付款" },
  withdraw: { title: "🏧 如何提现", text: "1️⃣ 进入提现页面\n2️⃣ 填写金额与账户\n3️⃣ 等待审核放款" },
};

bot.action("faq_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "❓ 常见问题",
    Markup.inlineKeyboard([
      [Markup.button.callback("📝 如何注册", "faq_register")],
      [Markup.button.callback("💰 如何充值", "faq_deposit")],
      [Markup.button.callback("🏧 如何提现", "faq_withdraw")],
      [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
    ])
  );
});

["register", "deposit", "withdraw"].forEach((key) => {
  bot.action(`faq_${key}`, async (ctx) => {
    await ctx.answerCbQuery();
    await logEvent(ctx, "点击FAQ", FAQ[key].title);
    await ctx.editMessageText(`${FAQ[key].title}\n\n${FAQ[key].text}`, backButton());
  });
});

bot.action("back_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("请点击下方按钮选择服务：", mainMenu());
});

// ==================================================================
// 内部工作群端功能
// ==================================================================
// 场景：品牌方/KOL团队每天需要知道「今天要发什么内容」「哪个部门要处理什么」
// 以及「昨天的发文成效简报」。这里用 Post Log (Demo) 分页模拟发文排程与记录，
// 正式版会跟排程发布系统（像 MYB7 x Josephy 那个 Schedule Post）直接串接。

// Demo 用：管理员可以用这个指令，手动模拟「今日发文任务」通知（正式版会自动读排程表）
bot.command("demo_daily_reminder", async (ctx) => {
  const groupId = process.env.INTERNAL_GROUP_ID;
  if (!groupId) {
    await ctx.reply("未设置 INTERNAL_GROUP_ID，无法发送内部通知");
    return;
  }
  const today = todayDateStrKL();
  const message =
    `📋 今日发文与任务提醒（${today}）\n\n` +
    `📱 内容组\n・09:00 发布每日签到活动预告\n・21:00 发布幸运抽奖开奖公告\n\n` +
    `💬 客服组\n・持续处理 FAQ 未解答问题（今日累积 3 则待回复）\n\n` +
    `📊 运营组\n・核对昨日签到人数与积分发放是否正确\n・更新本周排行榜前十名名单`;
  await ctx.telegram.sendMessage(groupId, message);
  await ctx.reply("✅ 已发送今日提醒到内部工作群（Demo模拟）");
});

// Demo 用：模拟「昨日发文数据简报」
bot.command("demo_daily_report", async (ctx) => {
  const groupId = process.env.INTERNAL_GROUP_ID;
  if (!groupId) {
    await ctx.reply("未设置 INTERNAL_GROUP_ID，无法发送内部通知");
    return;
  }
  try {
    let totalPosts = 0;
    let byDept = {};
    if (postLogSheet) {
      const rows = await postLogSheet.getRows();
      totalPosts = rows.length;
      rows.forEach((r) => {
        const dept = r.get("部门") || "未分类";
        byDept[dept] = (byDept[dept] || 0) + 1;
      });
    }
    const deptLines = Object.entries(byDept).map(([d, c]) => `・${d}：${c} 则`).join("\n") || "（暂无记录，Demo数据待累积）";

    const message =
      `📊 昨日发文数据简报（Demo）\n\n` +
      `发文总数：${totalPosts} 则\n` +
      `${deptLines}\n\n` +
      `（正式版会包含浏览量、互动率、签到/抽奖参与人数等完整数据）`;
    await ctx.telegram.sendMessage(groupId, message);
    await ctx.reply("✅ 已发送数据简报到内部工作群（Demo模拟）");
  } catch (err) {
    console.error("发送数据简报失败:", err.message);
    await ctx.reply("发送失败: " + err.message);
  }
});

// ---------------- 简易健康检查用 HTTP 服务 ----------------
const http = require("http");
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`${BRAND_NAME} Demo Bot is running.`);
  })
  .listen(PORT, () => console.log(`健康检查 HTTP 服务已启动，监听 port ${PORT}`));

// ---------------- 启动 ----------------
(async () => {
  await initSheet();

  bot
    .launch({ allowedUpdates: ["message", "callback_query"] })
    .catch((err) => console.error("❌ bot.launch 发生错误:", err.message));

  console.log(`${BRAND_NAME} Demo Bot 已启动`);

  // 每天 09:00 自动发一次「今日任务提醒」到内部群（demo 用固定内容，正式版读排程表）
  cron.schedule(
    "0 9 * * *",
    async () => {
      const groupId = process.env.INTERNAL_GROUP_ID;
      if (!groupId) return;
      const today = todayDateStrKL();
      await bot.telegram.sendMessage(
        groupId,
        `📋 今日发文与任务提醒（${today}）\n\n（自动排程示范，实际内容会读取排程表）`
      );
    },
    { timezone: "Asia/Kuala_Lumpur" }
  );
  console.log("[内部群提醒] cron 已注册，每天 09:00（Asia/Kuala_Lumpur 时区）");
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
