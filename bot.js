// DemoBet88 展示用 Telegram Bot + 管理后台（同一个服务）
// bot 的菜单、文案、FAQ、活动、公告全部从 store 读取，后台修改后立即生效。
//
// ⚠️ Demo：会员积分/签到等资料在记忆体，重启会清空；后台配置写入 DATA_DIR（挂 Volume 才会保留）。
//
// 环境变量：
//   BOT_TOKEN        必填
//   ADMIN_PASSWORD   后台登入密码（不填会随机产生并印在 log）
//   STORAGE_CHAT_ID  素材上传用的聊天ID（你自己私聊bot后发 /chatid 取得）
//   ADMIN_IDS        允许使用「传图取file_id」功能的 Telegram 用户ID，逗号分隔（选填）
//   BRAND_NAME / WELCOME_IMAGE_URL / ACTIVITY_IMAGE_URL / DEFAULT_TARGET（选填）

require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const store = require("./store");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("缺少 BOT_TOKEN，请在环境变量中设置");
  process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN, process.env.TELEGRAM_API_ROOT ? { telegram: { apiRoot: process.env.TELEGRAM_API_ROOT } } : {});
const D = () => store.data;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

// ---------------- 记忆体资料 ----------------
const DEMO = store.DEMO; // 示范模式：只在展示用 demo 开启，正式客户的 bot 不会出现示范功能
const members = store.table("members");
const checkins = store.table("checkins");
const pendingBind = new Set();

function getMember(user) {
  if (!members.has(user.id)) {
    members.set(user.id, {
      username: user.username ? "@" + user.username : user.first_name || "",
      gameId: null,
      giftcode: null,
      points: 0,
      contributed: 0,
      referrals: 0,
      referralEarnings: 0,
      refBy: null,
    });
    return { m: members.get(user.id), isNew: true };
  }
  return { m: members.get(user.id), isNew: false };
}
const M = (user) => getMember(user).m;

function todayStrKL(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(d);
}
const randomCode = () => (process.env.GIFT_PREFIX || "DEMO") + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- VIP 等级 ----
const TIERS = [
  { name: "Bronze", emoji: "🥉", min: 0 },
  { name: "Silver", emoji: "🥈", min: 100 },
  { name: "Gold", emoji: "🥇", min: 300 },
  { name: "Diamond", emoji: "💎", min: 600 },
];
const getTier = (p) => TIERS.filter((t) => p >= t.min).pop();
const getNextTier = (p) => TIERS.find((t) => t.min > p) || null;
const tierLadder = (p) => {
  const c = getTier(p);
  return TIERS.map((t) => (t.name === c.name ? `▶️${t.emoji}${t.name}◀️` : `${t.emoji}${t.name}`)).join("  →  ");
};
const progressBar = (cur, total) => {
  const f = Math.max(0, Math.min(cur, total));
  return "🟩".repeat(f) + "⬜".repeat(Math.max(total - f, 0));
};

function countdown() {
  const diff = new Date(D().activity.endAt).getTime() - Date.now();
  if (!(diff > 0)) return null;
  return `${Math.floor(diff / 86400000)}天${Math.floor((diff % 86400000) / 3600000)}小时`;
}
// 示范模式显示示范人数；正式版只显示真实的今日签到人数
const todayCount = () => DEMO ? 1800 + checkins.size * 3 : checkins.values().filter((r) => r.lastDate === todayStrKL()).length;

// ---------------- 界面工具 ----------------
function btn(b) {
  if (b.type === "link") return Markup.button.url(b.label, b.url);
  if (b.type === "builtin") return Markup.button.callback(b.label, b.action);
  return Markup.button.callback(b.label, "c:" + b.id);
}
function mainMenu() {
  const rows = D()
    .menu.map((row) => row.filter((b) => b.enabled !== false && b.label).map(btn))
    .filter((r) => r.length);
  if (!rows.length) rows.push([Markup.button.callback("🔄 刷新", "back_menu")]);
  return Markup.inlineKeyboard(rows);
}
const backButton = () => Markup.inlineKeyboard([[Markup.button.callback("⬅️ 返回主菜单", "back_menu")]]);

async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.reply(text, extra);
  }
}
async function sendPhotoScreen(ctx, imageId, caption, extra) {
  try { await ctx.deleteMessage(); } catch (e) {}
  if (imageId) {
    try {
      await ctx.replyWithPhoto(imageId, { caption, ...extra });
      return;
    } catch (err) {
      console.error("发送图片画面失败，改用纯文字:", err.message);
    }
  }
  await ctx.reply(caption, extra);
}

bot.catch((err, ctx) => console.error(`处理讯息时发生错误 (update ${ctx.update.update_id}):`, err.message));

// 记录互动（后台总览的数据来源）
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.chat?.type === "private") {
    store.logEvent("interact", ctx.from.id);
    // 记录 Telegram 用户档案和活跃度（后台「用户」页的数据来源）
    const f = ctx.from, now = Date.now();
    const u = D().tgUsers[f.id] || (D().tgUsers[f.id] = { firstSeen: now, count: 0 });
    u.username = f.username ? "@" + f.username : "";
    u.name = [f.first_name, f.last_name].filter(Boolean).join(" ");
    u.lang = f.language_code || "";
    u.lastSeen = now;
    u.count += 1;
  }
  return next();
});

// 示范功能（假抽奖、假活动冲榜、模拟邀请、内部功能展示）只在 DEMO_MODE 开放
const DEMO_ONLY = new Set(["bind_id", "lucky_draw", "referral", "share_referral", "activity_menu", "activity_progress", "activity_contribute", "internal_menu", "internal_posts", "internal_report", "internal_tasks"]);
bot.use(async (ctx, next) => {
  const d = ctx.callbackQuery && ctx.callbackQuery.data;
  if (!DEMO && d && DEMO_ONLY.has(d)) {
    try { await ctx.answerCbQuery("此功能尚未开通", { show_alert: true }); } catch (e) {}
    return;
  }
  return next();
});

// ==================================================================
// /start、/chatid、返回菜单
// ==================================================================
bot.start(async (ctx) => {
  const { m, isNew } = getMember(ctx.from);
  if (isNew) {
    store.logEvent("start", ctx.from.id);
    const ref = (ctx.startPayload || "").match(/^ref_(\d+)$/);
    if (ref && Number(ref[1]) !== ctx.from.id && members.has(Number(ref[1]))) {
      const inviter = members.get(Number(ref[1]));
      inviter.referrals += 1;
      inviter.referralEarnings += 18;
      m.refBy = Number(ref[1]);
      store.logEvent("referral", Number(ref[1]));
      ctx.telegram.sendMessage(Number(ref[1]), `🎉 有好友通过你的链接加入了！获得推荐奖金 RM18（累计 RM${inviter.referralEarnings}）`).catch(() => {});
    }
  }
  pendingBind.delete(ctx.from.id);
  const caption = D().welcome.caption.replace(/\{brand\}/g, D().brand).replace(/\{count\}/g, todayCount());
  if (D().welcome.imageId) {
    try {
      await ctx.replyWithPhoto(D().welcome.imageId, { caption, ...mainMenu() });
      return;
    } catch (err) {
      console.error("发送欢迎图片失败，改用纯文字:", err.message);
    }
  }
  await ctx.reply(caption, mainMenu());
});

bot.command("chatid", (ctx) => ctx.reply(`Chat ID：${ctx.chat.id}\nUser ID：${ctx.from.id}`));
// /menu：随时重新打开主菜单（后台「机器人资料」的命令列表里可以放这条）
bot.command("menu", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  pendingBind.delete(ctx.from.id);
  await ctx.reply("请点击下方按钮选择服务：", mainMenu());
});

bot.action("back_menu", async (ctx) => {
  await ctx.answerCbQuery();
  pendingBind.delete(ctx.from.id);
  await safeEdit(ctx, `🔥 新会员首绑即领 Giftcode\n🎁 今日已有 ${todayCount()} 人签到领奖\n\n请点击下方按钮选择服务：`, mainMenu());
});

// 后台新增的「文字内容」按钮
bot.action(/^c:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  pendingBind.delete(ctx.from.id);
  const id = ctx.match[1];
  let found = null;
  D().menu.forEach((row) => row.forEach((b) => { if (b.id === id) found = b; }));
  if (!found) return safeEdit(ctx, "此功能已下架", backButton());
  store.logEvent("custom_btn", ctx.from.id);
  const text = found.content || found.label;
  if (found.imageId) return sendPhotoScreen(ctx, found.imageId, text, backButton());
  return safeEdit(ctx, text, backButton());
});

// ==================================================================
// 1. Giftcode
// ==================================================================
bot.action("bind_id", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, "🎁 新会员专属Giftcode\n\n请输入你的游戏ID解锁专属Code：", backButton());
  pendingBind.add(ctx.from.id);
});

// 管理员传图取 file_id（一般用户发图不会有任何回应）
bot.on("photo", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const isAdmin = ADMIN_IDS.includes(String(ctx.from.id)) || String(ctx.chat.id) === String(process.env.STORAGE_CHAT_ID || "");
  if (!isAdmin) return;
  const sizes = ctx.message.photo;
  await ctx.reply(`📎 file_id：\n<code>${sizes[sizes.length - 1].file_id}</code>\n\n（也可以直接到后台素材库上传）`, { parse_mode: "HTML" });
});

bot.on("text", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  if (pendingBind.has(ctx.from.id)) {
    pendingBind.delete(ctx.from.id);
    const gameId = ctx.message.text.trim().slice(0, 32);
    const m = M(ctx.from);
    m.gameId = gameId;
    m.giftcode = m.giftcode || randomCode();
    store.logEvent("bind", ctx.from.id);
    await ctx.reply(
      `🎉 <b>恭喜解锁！</b>\n\n游戏ID：<code>${esc(gameId)}</code>\n你的专属Giftcode（点击可复制）：\n<code>${m.giftcode}</code>\n\n` +
        `⚠️ 此Code为一次性专属，<b>24小时内</b>使用，逾期作废\n👉 立即使用领取新手礼包`,
      { parse_mode: "HTML", ...mainMenu() }
    );
    return;
  }
  await ctx.reply("请点击下方按钮选择服务 👇", mainMenu());
});

// ==================================================================
// 2. 签到
// ==================================================================
const VIP_DAYS = 7;
bot.action("checkin", async (ctx) => {
  await ctx.answerCbQuery();
  const today = todayStrKL();
  const rec = checkins.get(ctx.from.id) || { lastDate: null, streak: 0 };
  if (rec.lastDate === today) {
    const remain = Math.max(VIP_DAYS - rec.streak, 0);
    return safeEdit(
      ctx,
      `📅 你今天已经签到过啦！\n\n🔥 连续签到：${rec.streak}天\n${progressBar(rec.streak, VIP_DAYS)} ${Math.min(rec.streak, VIP_DAYS)}/${VIP_DAYS}天\n` +
        (!DEMO ? "明天再来继续累积吧！" : remain > 0 ? `再签到 ${remain} 天，解锁 VIP 会员 + RM50 彩金！` : `🎉 你已经是 VIP 会员！`),
      backButton()
    );
  }
  let streak = 1;
  if (rec.lastDate) {
    const diff = Math.round((new Date(today) - new Date(rec.lastDate)) / 86400000);
    if (diff === 1) streak = rec.streak + 1;
  }
  const broke = rec.lastDate && streak === 1 && rec.streak > 1;
  checkins.set(ctx.from.id, { lastDate: today, streak });
  store.logEvent("checkin", ctx.from.id);
  const bonus = 10 + Math.min(streak - 1, 5);
  M(ctx.from).points += bonus;
  const remain = Math.max(VIP_DAYS - streak, 0);
  let msg = `✅ 签到成功！第 ${streak} 天\n\n`;
  if (broke) msg += `⚠️ 上次进度已中断，本次重新开始计算\n\n`;
  msg += `🔥 连续签到：${streak}天\n💎 获得 ${bonus} 积分`;
  if (streak > 1) msg += `（连续签到加成 +${bonus - 10}）`;
  msg += `\n${progressBar(streak, VIP_DAYS)} ${Math.min(streak, VIP_DAYS)}/${VIP_DAYS}天\n`;
  if (DEMO) msg += remain > 0 ? `再坚持 ${remain} 天，解锁 VIP 会员 🎯\n⚠️ 断签1天，进度将会重置` : `🎉 恭喜解锁 VIP 会员 + RM50 彩金！`;
  else msg += "断签 1 天进度会重新开始，明天记得再来！";
  await safeEdit(ctx, msg, Markup.inlineKeyboard([DEMO ? [Markup.button.callback("🎰 试试手气", "lucky_draw"), Markup.button.callback("⬅️ 返回主菜单", "back_menu")] : [Markup.button.callback("⬅️ 返回主菜单", "back_menu")]]));
});

// ==================================================================
// 3. 积分
// ==================================================================
bot.action("my_points", async (ctx) => {
  await ctx.answerCbQuery();
  const m = M(ctx.from);
  const rec = checkins.get(ctx.from.id) || { streak: 0 };
  const tier = getTier(m.points);
  const next = getNextTier(m.points);
  let line = `当前等级：${tier.emoji} ${tier.name}\n${tierLadder(m.points)}\n`;
  if (next) {
    const total = next.min - tier.min;
    line += `${progressBar(Math.round(((m.points - tier.min) / total) * 7), 7)} 再赚 ${next.min - m.points} 积分升级 ${next.emoji} ${next.name}\n`;
  } else line += `🎉 已达最高等级！\n`;
  await safeEdit(
    ctx,
    `💎 我的积分\n\n${line}\n累积积分：${m.points}\n游戏ID：${m.gameId || "未绑定"}\n连续签到：${rec.streak}天\n已邀请好友：${m.referrals}人\n累计赚取推荐奖金：RM${m.referralEarnings}`,
    backButton()
  );
});

// ==================================================================
// 4. 抽奖
// ==================================================================
const PRIZES = [
  { label: "RM10 彩金", weight: 3 },
  { label: "RM8 彩金", weight: 3 },
  { label: "谢谢参与，再接再厉", weight: 4 },
  { label: "RM18 彩金", weight: 2 },
  { label: "免费抽奖券 x1", weight: 3 },
];
function pickPrize() {
  let r = Math.random() * PRIZES.reduce((s, p) => s + p.weight, 0);
  for (const p of PRIZES) { if (r < p.weight) return p.label; r -= p.weight; }
  return PRIZES[0].label;
}
bot.action("lucky_draw", async (ctx) => {
  await ctx.answerCbQuery();
  store.logEvent("draw", ctx.from.id);
  const spin = await ctx.reply("🎰 抽奖中...");
  const edit = (t) => ctx.telegram.editMessageText(spin.chat.id, spin.message_id, undefined, t).catch(() => {});
  await sleep(800); await edit("🎰 抽奖中... 🎯🎯🎯");
  await sleep(800); await edit("🎰 抽奖中... 🎯🎯🎯🎯🎯");
  await sleep(700);
  const result = pickPrize();
  const tease = result.includes("RM18") ? "🔥 手气不错！\n\n" : "😮 差一点点，再抽一次说不定就中大奖了\n\n";
  await edit(`${tease}🎉 抽奖结果：${result}\n\n（Demo模拟抽奖，正式版会串接真实彩金/奖励发放系统）`);
  await ctx.reply("分享给好友，你和朋友都能再抽一次 👇", Markup.inlineKeyboard([
    [Markup.button.callback("📤 分享给好友", "referral"), Markup.button.callback("🎰 再抽一次", "lucky_draw")],
    [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
  ]));
});

// ==================================================================
// 5. 邀请好友
// ==================================================================
bot.action("referral", async (ctx) => {
  await ctx.answerCbQuery();
  const m = M(ctx.from);
  const link = `https://t.me/${ctx.botInfo?.username || "bot"}?start=ref_${ctx.from.id}`;
  await safeEdit(
    ctx,
    `🤝 邀请好友，最高赚 RM318\n\n你的专属邀请链接：\n${link}\n\n📊 已邀请：${m.referrals} 人\n💰 已赚取：RM${m.referralEarnings}\n\n规则：\n每成功邀请1位好友 = RM18\n（好友通过你的链接首次进入机器人即自动计算）`,
    Markup.inlineKeyboard([[Markup.button.callback("🧪 模拟好友加入（Demo）", "share_referral"), Markup.button.callback("⬅️ 返回主菜单", "back_menu")]])
  );
});
bot.action("share_referral", async (ctx) => {
  await ctx.answerCbQuery();
  const m = M(ctx.from);
  m.referrals += 1;
  m.referralEarnings += 18;
  await safeEdit(ctx, `✅ 已模拟 1 位好友通过你的链接加入\n\n💰 获得推荐奖金 RM18\n📊 已邀请：${m.referrals} 人\n💰 累计赚取：RM${m.referralEarnings}`, backButton());
});

// ==================================================================
// 6. 活动（后台可改标题/内容/图片/截止时间/目标）
// ==================================================================
const actKeyboard = (primaryProgress) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("💰 立即冲榜", "activity_contribute"), Markup.button.callback("📊 查看进度", "activity_progress")],
    [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
  ]);

bot.action("activity_menu", async (ctx) => {
  await ctx.answerCbQuery();
  const a = D().activity;
  if (!a.enabled) return safeEdit(ctx, "🎉 目前没有进行中的活动，敬请期待！", backButton());
  const left = countdown();
  await sendPhotoScreen(
    ctx,
    a.imageId,
    `🎉 ${a.title}\n\n📅 ${left ? "活动倒数：" + left : "活动已结束，敬请期待下一期"}\n\n${a.body}`,
    actKeyboard()
  );
});

function progressText(m) {
  const a = D().activity;
  const goal = Number(a.goal) || 500;
  const remain = Math.max(goal - m.contributed, 0);
  return `${progressBar(Math.round((m.contributed / goal) * 7), 7)}\n已累计冲榜：RM${m.contributed} / RM${goal}\n` +
    (remain > 0 ? `还差 RM${remain} 即可抽 ${a.prize} 🎯` : `🎉 已达标！快去客服兑换你的抽奖资格`);
}
bot.action("activity_progress", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, `📊 你的活动进度\n\n${progressText(M(ctx.from))}`, Markup.inlineKeyboard([[Markup.button.callback("💰 现在就冲", "activity_contribute"), Markup.button.callback("⬅️ 返回主菜单", "back_menu")]]));
});
bot.action("activity_contribute", async (ctx) => {
  await ctx.answerCbQuery();
  const m = M(ctx.from);
  m.contributed = Math.min(m.contributed + 100, Number(D().activity.goal) || 500);
  store.logEvent("contribute", ctx.from.id);
  await safeEdit(ctx, `✅ 冲榜成功（Demo模拟 +RM100）\n\n${progressText(m)}`, backButton());
});

// ==================================================================
// 7. FAQ（后台可增删改）
// ==================================================================
bot.action("faq_menu", async (ctx) => {
  await ctx.answerCbQuery();
  const items = D().faq;
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2).map((f) => Markup.button.callback(f.title, "faq:" + f.id)));
  rows.push([Markup.button.callback("⬅️ 返回主菜单", "back_menu")]);
  await safeEdit(ctx, "❓ 常见问题", Markup.inlineKeyboard(rows));
});
bot.action(/^faq:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const f = D().faq.find((x) => x.id === ctx.match[1]);
  store.logEvent("faq", ctx.from.id);
  await safeEdit(
    ctx,
    f ? `${f.title}\n\n${f.text}` : "此问题已下架",
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ 常见问题", "faq_menu"), Markup.button.callback("🏠 主菜单", "back_menu")]])
  );
});

// ==================================================================
// 8. 内部功能展示（今日发文读取后台真实排程）
// ==================================================================
bot.action("internal_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(
    ctx,
    `🛠️ 内部工作管理系统 Demo\n\n以下是团队协作后台会产出的内容示范。\n「今日发文」读取的是管理后台里真实排定的公告，你在后台新增后这里马上看得到：`,
    Markup.inlineKeyboard([
      [Markup.button.callback("📝 今日发文", "internal_posts"), Markup.button.callback("📊 数据汇报", "internal_report")],
      [Markup.button.callback("👥 工作分配", "internal_tasks")],
      [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
    ])
  );
});
const internalBack = () => Markup.inlineKeyboard([[Markup.button.callback("⬅️ 内部功能展示", "internal_menu"), Markup.button.callback("🏠 主菜单", "back_menu")]]);

const STATUS_LABEL = { draft: "草稿", scheduled: "已排程待发", sent: "已发送", failed: "发送失败" };
const klTime = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

bot.action("internal_posts", async (ctx) => {
  await ctx.answerCbQuery();
  const today = todayStrKL();
  const list = D().announcements
    .filter((a) => a.at && todayStrKL(new Date(a.at)) === today)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  let body;
  if (!list.length) {
    body = "今天后台还没有排定任何公告。\n\n到管理后台「发文排程」新增一则，再回来点这里，就会看到它。";
  } else {
    body = list
      .map((a) => `【${klTime(a.at)}】${a.title || "（未命名）"}｜${STATUS_LABEL[a.status] || a.status}\n${(a.text || "").slice(0, 140)}${a.mediaId ? "\n（附素材）" : ""}`)
      .join("\n\n━━━━━━━━━━\n");
  }
  await safeEdit(
    ctx,
    `📝 今日发文排程\n\n${body}\n\n━━━━━━━━━━\n✏️ 如需修改，请于发布前联系 @content_team_lead\n（正式运作时，此消息会在每天固定时间自动发送到工作群）`,
    internalBack()
  );
});

bot.action("internal_report", async (ctx) => {
  await ctx.answerCbQuery();
  const since = Date.now() - 86400000;
  const ev = D().events.filter((e) => e.t >= since);
  const uniq = (t) => new Set(ev.filter((e) => e.type === t).map((e) => e.u)).size;
  const cnt = (t) => ev.filter((e) => e.type === t).length;
  await safeEdit(
    ctx,
    `📊 数据汇报（近24小时，来自 bot 实际记录）\n\n👥 新增会员：${cnt("start")} 人\n📅 签到人数：${uniq("checkin")} 人\n🎰 抽奖参与：${cnt("draw")} 次\n🤝 新增推荐：${cnt("referral")} 组\n🎁 绑定Giftcode：${cnt("bind")} 人\n💬 互动人数：${uniq("interact")} 人\n\n（以上为这个 Demo 实际记录到的数据；正式版会串接平台后台，补上充值、转化等数据）`,
    internalBack()
  );
});

bot.action("internal_tasks", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(
    ctx,
    `👥 工作分配（Demo 示范）\n\n📱 内容组\n・09:00 发布晨间暖场文案\n・14:00 发布活动进度更新\n・20:00 发布晚间红包预告\n如有排程冲突，请联系 @content_team_lead\n\n` +
      `💬 客服组\n・待处理咨询 12 则\n・VIP客户专属问题 3 则，优先处理\n如需协助，请联系 @support_team_lead\n\n` +
      `🎨 设计组\n・活动主视觉修改（1版待审）\n如需延期，请联系 @design_team_lead\n\n` +
      `📊 运营组\n・核对今日签到/抽奖数据无误\n如发现数据异常，请联系 @ops_team_lead\n\n（正式运作时，负责人与联系窗口依真实团队编制设定）`,
    internalBack()
  );
});

// ==================================================================
// 排程发送（读后台公告：状态为 scheduled 且时间已到才发）
// ==================================================================
// 帖子底下的按钮：有公开网址时一律走 /r/ 跳转以便统计点击；没有时退回直接链接（无法统计）
const publicBase = () => (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "") || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "");
function buildMarkup(a) {
  const bs = (a.buttons || []).filter((b) => b && b.label && b.url).slice(0, 3);
  if (!bs.length) return undefined;
  const base = a.id ? publicBase() : "";
  return { inline_keyboard: bs.map((b, i) => [{ text: b.label, url: base ? `${base}/r/${a.id}/${i}` : b.url }]) };
}

// 返回发出的消息编号，之后才能编辑、置顶、删除
async function sendAnnouncement(a, chatId) {
  const text = a.text || "";
  const media = a.mediaId ? D().media.find((m) => m.id === a.mediaId) : null;
  if (a.mediaId && !media) throw new Error("素材已被删除或已过期，请重新选择素材");
  const markup = buildMarkup(a);
  const tracked = !!(markup && a.id && publicBase());
  const extra = markup ? { reply_markup: markup } : {};
  if (media) {
    const send = media.type === "video" ? bot.telegram.sendVideo.bind(bot.telegram) : bot.telegram.sendPhoto.bind(bot.telegram);
    if (text.length <= 1024) {
      const m = await send(chatId, media.fileId, { caption: text, ...extra });
      return { chatId: m.chat.id, media: m.message_id, text: null, tracked };
    }
    const m1 = await send(chatId, media.fileId);
    const m2 = await bot.telegram.sendMessage(chatId, text, extra);
    return { chatId: m1.chat.id, media: m1.message_id, text: m2.message_id, tracked };
  }
  const m = await bot.telegram.sendMessage(chatId, text || "（空白公告）", extra);
  return { chatId: m.chat.id, media: null, text: m.message_id, tracked };
}

// 发布后管理：编辑正文/按钮、置顶、从频道删除
const isNotModified = (e) => /not modified/i.test(e.message || "");
const postErr = (e) => {
  const m = e.message || "";
  if (/not enough rights|administrator rights|CHAT_ADMIN_REQUIRED/i.test(m)) return "bot 在这个频道/群里没有足够的管理权限（需要编辑、删除、置顶消息的权限）";
  if (/can't be edited|message to edit not found/i.test(m)) return "这则消息已经不能编辑，可能已被删除";
  if (/message to delete not found/i.test(m)) return "这则消息在 Telegram 里已经不存在";
  if (/too many requests|retry after/i.test(m)) return "操作太频繁，请稍后再试";
  return m;
};
const postOps = {
  buildMarkup,
  async edit(a, { text, buttons }) {
    const s = a.sent;
    const tmp = { ...a, text, buttons };
    const markup = buildMarkup(tmp) || { inline_keyboard: [] };
    const hasBtnChange = JSON.stringify((a.buttons || [])) !== JSON.stringify(buttons || []);
    try {
      if (s.text) await bot.telegram.editMessageText(s.chatId, s.text, undefined, text || "（空白公告）", { reply_markup: markup });
      else {
        if (text.length > 1024) throw new Error("带图片或视频的帖子，正文不能超过 1024 字");
        await bot.telegram.editMessageCaption(s.chatId, s.media, undefined, text, { reply_markup: markup });
      }
    } catch (e) {
      if (!isNotModified(e)) throw new Error(postErr(e));
      if (hasBtnChange) {
        try { await bot.telegram.editMessageReplyMarkup(s.chatId, s.text || s.media, undefined, markup); } catch (e2) { if (!isNotModified(e2)) throw new Error(postErr(e2)); }
      }
    }
  },
  async pin(a, on) {
    const id = a.sent.media || a.sent.text;
    try {
      if (on) await bot.telegram.pinChatMessage(a.sent.chatId, id, { disable_notification: true });
      else await bot.telegram.unpinChatMessage(a.sent.chatId, id);
    } catch (e) { throw new Error(postErr(e)); }
  },
  async remove(a) {
    for (const id of [a.sent.media, a.sent.text].filter(Boolean)) {
      try { await bot.telegram.deleteMessage(a.sent.chatId, id); } catch (e) { if (!/not found/i.test(e.message || "")) throw new Error(postErr(e)); }
    }
  },
  async memberCount(chatId) { return bot.telegram.callApi("getChatMemberCount", { chat_id: chatId }); },
};

// 通知管理员（发送失败、每周报告）：ADMIN_IDS 和 STORAGE_CHAT_ID
const adminChats = () => [...new Set([...ADMIN_IDS, String(process.env.STORAGE_CHAT_ID || "")].filter(Boolean))];
async function notifyAdmins(text) {
  for (const c of adminChats()) { try { await bot.telegram.sendMessage(c, text); } catch (e) { console.log("[通知失败]", c, e.message); } }
}

// 群人数快照（每 6 小时一次，用来算增长）
async function snapshotMembers() {
  const chats = new Set(D().targets.map((t) => String(t.chatId)));
  if (process.env.DEFAULT_TARGET) chats.add(String(process.env.DEFAULT_TARGET));
  for (const c of chats) {
    try {
      const n = await postOps.memberCount(c);
      D().memberStats.push({ t: Date.now(), c, n });
    } catch (e) { /* bot 不在该群或无权限，略过 */ }
  }
  if (D().memberStats.length > 4000) D().memberStats.splice(0, D().memberStats.length - 4000);
  store.save();
}

// 公告的发布位置：优先用后台「常用发布位置」，其次旧版直接填的ID，最后是 DEFAULT_TARGET
function resolveChat(a) {
  if (a.targetId) {
    if (a.targetId === "__default") return process.env.DEFAULT_TARGET || null;
    const t = D().targets.find((x) => x.id === a.targetId);
    return t ? t.chatId : null;
  }
  return a.target || process.env.DEFAULT_TARGET || null;
}

let sending = false;
async function checkSchedule() {
  if (sending) return;
  sending = true;
  try {
    const now = Date.now();
    for (const a of D().announcements) {
      if (a.status !== "scheduled" || !a.at || new Date(a.at).getTime() > now) continue;
      const target = resolveChat(a);
      if (!target) {
        a.status = "failed"; a.error = "找不到发布位置（可能已被删除），请重新选择发布位置";
        store.logAction("发送失败", `${a.title}：${a.error}`);
        store.save();
        notifyAdmins(`发文失败提醒\n帖子：${a.title || "未命名"}\n原因：${a.error}`);
        continue;
      }
      try {
        a.sent = await sendAnnouncement(a, target);
        a.status = "sent"; a.sentAt = new Date().toISOString(); a.error = "";
        try { a.membersAtSend = await postOps.memberCount(a.sent.chatId); D().memberStats.push({ t: Date.now(), c: String(target), n: a.membersAtSend }); } catch (e) { /* 读不到人数不影响发送 */ }
        store.logEvent("post_sent", 0);
        store.logAction("公告已发送", a.title || a.id);
      } catch (e) {
        a.status = "failed"; a.error = e.message;
        store.logAction("发送失败", `${a.title}：${e.message}`);
        notifyAdmins(`发文失败提醒\n帖子：${a.title || "未命名"}\n原因：${e.message}`);
      }
      store.save();
    }
  } finally {
    sending = false;
  }
}
setInterval(checkSchedule, 30000);
setTimeout(() => snapshotMembers().catch(() => {}), 30000);
setInterval(() => snapshotMembers().catch(() => {}), 6 * 3600000);

// 每周报告（框架：默认关闭，后台「机器人设置 › 每周报告」打开后，按设定的星期和时间私信管理员）
const insights = require("./insights");
const weekKey = (ms) => { const p = insights.mytParts(ms); return `${p.y}-${p.m}-${p.d - p.wd}`; };
setInterval(async () => {
  const w = D().weekly;
  if (!w || !w.enabled) return;
  const p = insights.mytParts(Date.now());
  if (p.wd !== Number(w.weekday) || p.h < Number(w.hour) || w.lastSent === weekKey(Date.now())) return;
  w.lastSent = weekKey(Date.now()); store.save();
  await notifyAdmins(insights.buildWeeklyReport(D(), D().targets));
  store.logAction("发送每周报告", "");
}, 600000);

// ---------------- 启动：后台 + bot ----------------
let botReady = false;
const { startAdmin } = require("./admin");
startAdmin({ bot, store, sendAnnouncement, checkNow: checkSchedule, isReady: () => botReady, token: BOT_TOKEN, ops: postOps, publicBase, snapshotMembers, notifyAdmins });

bot
  .launch({ allowedUpdates: ["message", "callback_query"] }, () => { botReady = true; console.log("Telegram 连线成功"); })
  .catch((err) => console.error("❌ bot.launch 发生错误:", err.message));

console.log(`${D().brand} Bot 已启动（${DEMO ? "DEMO 示范模式" : "正式模式"}）`);
console.log(`[环境变量检查] STORAGE_CHAT_ID = ${process.env.STORAGE_CHAT_ID || "（未设置，素材上传会失败）"}`);
console.log(`[环境变量检查] ADMIN_PASSWORD = ${process.env.ADMIN_PASSWORD ? "已设置" : "（未设置，将随机产生）"}`);
console.log(`[环境变量检查] PLATFORM_KEY = ${process.env.PLATFORM_KEY ? "已设置" : "（未设置，总汇无法读取此品牌）"}`);
console.log(`[环境变量检查] MEDIA_TTL_DAYS = ${process.env.MEDIA_TTL_DAYS || "30（默认）"}`);

// 收到停止信号（例如 Railway 重新部署）：先停 bot，再真正退出，避免旧进程卡着不放端口
function shutdown(sig) {
  try { bot.stop(sig); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
