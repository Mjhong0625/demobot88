// DemoBet88 展示用 Telegram Bot（Hard-sell 体验版）
// 目的：给潜在客户看一个「能实际操作」的demo，展示菠菜平台常见的用户增长/留存机制，
//       以及内部团队协作后台长什么样。
//
// ⚠️ 这是Demo：数据存在程式记忆体里，Bot 重启会清空，纯粹展示流程用。
//    内部功能展示区块（今日发文/数据汇报/工作分配）是「手动点击预览」，
//    不会真的自动发送到任何群组 —— 每个内容结尾都会注明「正式运作时会怎样」。
//
// 需要的环境变量：
//   BOT_TOKEN
//   BRAND_NAME   - Demo品牌名称，默认 DemoBet88

require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("缺少 BOT_TOKEN，请在环境变量中设置");
  process.exit(1);
}

const BRAND_NAME = process.env.BRAND_NAME || "DemoBet88";
const bot = new Telegraf(BOT_TOKEN);

// ---------------- 内存资料（Demo 用，重启会清空） ----------------
const members = new Map(); // userId -> { username, giftcode, points, referrals, referralEarnings }
const checkins = new Map(); // userId -> { lastDate, streak }
const pendingBind = new Set();

// 活动倒数目标时间（Demo 固定值，正式版由后台设定）
const ACTIVITY_END = new Date("2026-09-09T20:00:00+08:00");

function getMember(user) {
  if (!members.has(user.id)) {
    members.set(user.id, {
      username: user.username ? "@" + user.username : (user.first_name || ""),
      giftcode: null,
      points: 0,
      contributed: 0, // 模拟「累充金额」
      referrals: 0,
      referralEarnings: 0,
    });
  }
  return members.get(user.id);
}

function todayDateStrKL() {
  const now = new Date();
  const kl = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return `${kl.getFullYear()}-${String(kl.getMonth() + 1).padStart(2, "0")}-${String(kl.getDate()).padStart(2, "0")}`;
}

function randomCode() {
  return "DEMO-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---- VIP 等级阶梯 ----
const TIERS = [
  { name: "Bronze", emoji: "🥉", min: 0 },
  { name: "Silver", emoji: "🥈", min: 100 },
  { name: "Gold", emoji: "🥇", min: 300 },
  { name: "Diamond", emoji: "💎", min: 600 },
];

function getTier(points) {
  let tier = TIERS[0];
  for (const t of TIERS) if (points >= t.min) tier = t;
  return tier;
}

function getNextTier(points) {
  return TIERS.find((t) => t.min > points) || null;
}

function tierLadderDisplay(points) {
  const current = getTier(points);
  return TIERS.map((t) => (t.name === current.name ? `▶️${t.emoji}${t.name}◀️` : `${t.emoji}${t.name}`)).join("  →  ");
}

// ---- 色块进度条 ----
function progressBar(current, total, size = 7) {
  const filled = Math.max(0, Math.min(current, total));
  return "🟩".repeat(filled) + "⬜".repeat(Math.max(total - filled, 0));
}

function formatCountdown() {
  const diffMs = ACTIVITY_END.getTime() - Date.now();
  if (diffMs <= 0) return "活动已结束";
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return `${days}天${hours}小时`;
}

// 今日签到总人数（Demo 假数据，营造从众感）
function fakeTodayCheckinCount() {
  return 1800 + checkins.size * 3;
}

// ==================================================================
// 主菜单
// ==================================================================

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔥 限时活动：豪礼派对周", "activity_menu")],
    [
      Markup.button.callback("🎁 领取Giftcode", "bind_id"),
      Markup.button.callback("📅 每日签到", "checkin"),
    ],
    [
      Markup.button.callback("💎 我的积分", "my_points"),
      Markup.button.callback("🎰 幸运抽奖", "lucky_draw"),
    ],
    [
      Markup.button.callback("🤝 邀请好友", "referral"),
      Markup.button.callback("❓ 常见问题", "faq_menu"),
    ],
    [Markup.button.callback("🛠️ 内部功能展示（团队协作）", "internal_menu")],
  ]);
}

function backButton() {
  return Markup.inlineKeyboard([[Markup.button.callback("⬅️ 返回主菜单", "back_menu")]]);
}

// 统一的「编辑或重发」处理：如果当前讯息是图片（例如 /start 的欢迎图），
// 没办法直接把它编辑成纯文字讯息，这时改成删除原讯息、重新发一条文字。
async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    try { await ctx.deleteMessage(); } catch (e) {}
    await ctx.reply(text, extra);
  }
}

bot.start(async (ctx) => {
  getMember(ctx.from);
  const todayCount = fakeTodayCheckinCount();
  const caption =
    `👋 欢迎加入 ${BRAND_NAME} VIP专属通道！\n\n` +
    `🔥 新会员首绑即领 Giftcode\n` +
    `🎁 今日已有 ${todayCount} 人签到领奖\n` +
    `💰 邀请好友最高可得 RM318\n\n` +
    `（这是功能展示 Demo，数据仅供体验，正式上线会串接真实平台后台）\n\n` +
    `请点击下方按钮开始体验：`;

  const bannerUrl = process.env.WELCOME_IMAGE_URL;
  if (bannerUrl) {
    try {
      await ctx.replyWithPhoto(bannerUrl, { caption, ...mainMenu() });
      return;
    } catch (err) {
      console.error("发送欢迎图片失败，改用纯文字:", err.message);
    }
  }
  await ctx.reply(caption, mainMenu());
});

bot.action("back_menu", async (ctx) => {
  await ctx.answerCbQuery();
  const todayCount = fakeTodayCheckinCount();
  await safeEdit(ctx, 
    `🔥 新会员首绑即领 Giftcode\n🎁 今日已有 ${todayCount} 人签到领奖\n💰 邀请好友最高可得 RM318\n\n请点击下方按钮选择服务：`,
    mainMenu()
  );
});

// ==================================================================
// 1. 领取专属Giftcode
// ==================================================================

bot.action("bind_id", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    "🎁 新会员专属Giftcode\n\n请输入你的游戏ID解锁专属Code：",
    backButton()
  );
  pendingBind.add(ctx.from.id);
});

// 临时工具：把图片传给bot，会直接回传这张图片的 file_id，
// 拿到后填进 WELCOME_IMAGE_URL 环境变量即可，不需要透过 Google Drive 外部连结。
bot.on("photo", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const sizes = ctx.message.photo;
  const fileId = sizes[sizes.length - 1].file_id; // 取最大尺寸那张
  await ctx.reply(
    `📎 图片已收到，file_id 如下（点击可复制）：\n\n\`${fileId}\`\n\n` +
      `把这串貼进 Railway 的 WELCOME_IMAGE_URL 变量即可，不需要 Google Drive 连结。`,
    { parse_mode: "Markdown" }
  );
});

bot.on("text", async (ctx) => {
  if (ctx.chat.type !== "private") return;

  if (pendingBind.has(ctx.from.id)) {
    pendingBind.delete(ctx.from.id);
    const gameId = ctx.message.text.trim();
    const m = getMember(ctx.from);
    m.giftcode = randomCode();
    await ctx.reply(
      `🎉 *恭喜解锁！*\n\n` +
        `你的专属Giftcode（点击可复制）：\n\`${m.giftcode}\`\n\n` +
        `⚠️ 此Code为一次性专属，*24小时内*使用，逾期作废\n` +
        `👉 立即使用领取新手礼包`,
      { parse_mode: "Markdown", ...mainMenu() }
    );
    return;
  }

  await ctx.reply("请点击下方按钮选择服务 👇", mainMenu());
});

// ==================================================================
// 2. 每日签到（连续天数 + VIP解锁 + 断签重置）
// ==================================================================

const VIP_UNLOCK_DAYS = 7;

bot.action("checkin", async (ctx) => {
  await ctx.answerCbQuery();
  const today = todayDateStrKL();
  const record = checkins.get(ctx.from.id) || { lastDate: null, streak: 0 };

  if (record.lastDate === today) {
    const remain = Math.max(VIP_UNLOCK_DAYS - record.streak, 0);
    const bar = progressBar(record.streak, VIP_UNLOCK_DAYS);
    await safeEdit(ctx, 
      `📅 你今天已经签到过啦！\n\n🔥 连续签到：${record.streak}天\n${bar} ${Math.min(record.streak, VIP_UNLOCK_DAYS)}/${VIP_UNLOCK_DAYS}天\n` +
        (remain > 0 ? `再签到 ${remain} 天，解锁 VIP 会员 + RM50 彩金！` : `🎉 你已经是 VIP 会员！`),
      backButton()
    );
    return;
  }

  let streak = 1;
  if (record.lastDate) {
    const diffDays = Math.round((new Date(today) - new Date(record.lastDate)) / 86400000);
    if (diffDays === 1) streak = record.streak + 1;
    // diffDays > 1 视为断签，streak 重置为 1（不额外提示，用下方文案呈现结果）
  }
  const broke = record.lastDate && streak === 1 && record.streak > 1;
  checkins.set(ctx.from.id, { lastDate: today, streak });

  const bonus = 10 + Math.min(streak - 1, 5) * 1; // 连续签到小额递增加成，封顶
  const m = getMember(ctx.from);
  m.points += bonus;

  const remain = Math.max(VIP_UNLOCK_DAYS - streak, 0);
  const bar = progressBar(streak, VIP_UNLOCK_DAYS);
  let msg = `✅ 签到成功！第 ${streak} 天\n\n`;
  if (broke) msg += `⚠️ 上次进度已中断，本次重新开始计算\n\n`;
  msg += `🔥 连续签到：${streak}天\n💎 获得 ${bonus} 积分`;
  if (streak > 1) msg += `（连续签到加成 +${bonus - 10}）`;
  msg += `\n${bar} ${Math.min(streak, VIP_UNLOCK_DAYS)}/${VIP_UNLOCK_DAYS}天\n`;
  if (remain > 0) {
    msg += `再坚持 ${remain} 天，解锁 VIP 会员 🎯\n⚠️ 断签1天，进度将会重置`;
  } else {
    msg += `🎉 恭喜解锁 VIP 会员 + RM50 彩金！`;
  }

  await safeEdit(ctx, msg, Markup.inlineKeyboard([
    [
      Markup.button.callback("🎰 试试手气", "lucky_draw"),
      Markup.button.callback("⬅️ 返回主菜单", "back_menu"),
    ],
  ]));
});

// ==================================================================
// 3. 我的积分
// ==================================================================

bot.action("my_points", async (ctx) => {
  await ctx.answerCbQuery();
  const m = getMember(ctx.from);
  const record = checkins.get(ctx.from.id) || { streak: 0 };
  const tier = getTier(m.points);
  const nextTier = getNextTier(m.points);

  let tierLine = `当前等级：${tier.emoji} ${tier.name}\n${tierLadderDisplay(m.points)}\n`;
  if (nextTier) {
    const need = nextTier.min - m.points;
    const barTotal = nextTier.min - tier.min;
    const barCurrent = m.points - tier.min;
    tierLine += `${progressBar(Math.round((barCurrent / barTotal) * 7), 7)} 再赚 ${need} 积分升级 ${nextTier.emoji} ${nextTier.name}\n`;
  } else {
    tierLine += `🎉 已达最高等级！\n`;
  }

  await safeEdit(ctx, 
    `💎 我的积分\n\n` +
      `${tierLine}\n` +
      `累积积分：${m.points}\n` +
      `连续签到：${record.streak}天\n` +
      `已邀请好友：${m.referrals}人\n` +
      `累计赚取推荐奖金：RM${m.referralEarnings}`,
    backButton()
  );
});

// ==================================================================
// 4. 幸运抽奖（悬念动画 + 差一点点 + 分享裂变）
// ==================================================================

const PRIZES = [
  { label: "RM10 彩金", weight: 3 },
  { label: "RM8 彩金", weight: 3 },
  { label: "谢谢参与，再接再厉", weight: 4 },
  { label: "RM18 彩金", weight: 2 },
  { label: "免费抽奖券 x1", weight: 3 },
];

function pickPrize() {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of PRIZES) {
    if (r < p.weight) return p.label;
    r -= p.weight;
  }
  return PRIZES[0].label;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bot.action("lucky_draw", async (ctx) => {
  await ctx.answerCbQuery();
  const spinMsg = await ctx.reply("🎰 抽奖中...");
  await sleep(800);
  await ctx.telegram.editMessageText(spinMsg.chat.id, spinMsg.message_id, undefined, "🎰 抽奖中... 🎯🎯🎯").catch(() => {});
  await sleep(800);
  await ctx.telegram.editMessageText(spinMsg.chat.id, spinMsg.message_id, undefined, "🎰 抽奖中... 🎯🎯🎯🎯🎯").catch(() => {});
  await sleep(700);

  const result = pickPrize();
  const isSmallWin = result.includes("RM10") || result.includes("RM8") || result.includes("免费");
  const teaseLine = isSmallWin ? `😮 差一点点！差2格就中RM88大奖了\n\n` : result.includes("RM18") ? `🔥 手气不错！\n\n` : `😮 只差一点点，再抽一次说不定就中了\n\n`;

  const m = getMember(ctx.from);
  await ctx.telegram.editMessageText(
    spinMsg.chat.id,
    spinMsg.message_id,
    undefined,
    `${teaseLine}🎉 抽奖结果：${result}\n\n（Demo模拟抽奖，正式版会串接真实彩金/奖励发放系统）`
  ).catch(() => {});

  await ctx.reply(
    "分享给好友，你和朋友都能再抽一次 👇",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("📤 分享给好友", "referral"),
        Markup.button.callback("🎰 再抽一次", "lucky_draw"),
      ],
      [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
    ])
  );
});

// ==================================================================
// 5. 邀请好友
// ==================================================================

bot.action("referral", async (ctx) => {
  await ctx.answerCbQuery();
  const m = getMember(ctx.from);
  const botUsername = ctx.botInfo?.username || "DemoBet88_bot";
  const link = `https://t.me/${botUsername}?start=ref_${ctx.from.id}`;

  await safeEdit(ctx, 
    `🤝 邀请好友，最高赚 RM318\n\n` +
      `你的专属邀请链接：\n${link}\n\n` +
      `📊 已邀请：${m.referrals} 人\n💰 已赚取：RM${m.referralEarnings}\n\n` +
      `规则：\n每成功邀请1位好友完成绑定 = RM18\n邀满10人额外再奖 RM138`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("📤 分享邀请链接", "share_referral"),
        Markup.button.callback("⬅️ 返回主菜单", "back_menu"),
      ],
    ])
  );
});

// Demo：模拟点击「分享」后立即算一笔推荐奖励，方便现场展示效果
bot.action("share_referral", async (ctx) => {
  await ctx.answerCbQuery();
  const m = getMember(ctx.from);
  m.referrals += 1;
  m.referralEarnings += 18;
  await safeEdit(ctx, 
    `✅ 分享成功（Demo模拟已有1位好友完成绑定）\n\n💰 获得推荐奖金 RM18\n📊 已邀请：${m.referrals} 人\n💰 累计赚取：RM${m.referralEarnings}`,
    backButton()
  );
});

// ==================================================================
// 6. 平台活动：豪礼派对周
// ==================================================================

bot.action("activity_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    `🎉 豪礼派对周｜Golden Party Week\n\n` +
      `📅 活动倒数：${formatCountdown()}\n\n` +
      `本周三大福利：\n` +
      `🎁 每日首充加送 8%\n` +
      `🏆 累充满RM500，抽iPhone17 ProMax\n` +
      `🧧 每晚8点整点红包雨，手快有手慢无`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("💰 立即冲榜", "activity_contribute"),
        Markup.button.callback("📊 查看进度", "activity_progress"),
      ],
      [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
    ])
  );
});

bot.action("activity_progress", async (ctx) => {
  await ctx.answerCbQuery();
  const m = getMember(ctx.from);
  const remain = Math.max(500 - m.contributed, 0);
  const bar = progressBar(Math.round((m.contributed / 500) * 7), 7);
  await safeEdit(ctx, 
    `📊 你的豪礼派对周进度\n\n` +
      `${bar}\n已累计冲榜：RM${m.contributed} / RM500\n` +
      (remain > 0 ? `还差 RM${remain} 即可抽 iPhone17 ProMax 🎯` : `🎉 已达标！快去客服兑换你的抽奖资格`),
    Markup.inlineKeyboard([
      [
        Markup.button.callback("💰 现在就冲", "activity_contribute"),
        Markup.button.callback("⬅️ 返回主菜单", "back_menu"),
      ],
    ])
  );
});

// Demo：模拟一次冲榜（每次点击 +100，方便现场快速展示达标效果）
bot.action("activity_contribute", async (ctx) => {
  await ctx.answerCbQuery();
  const m = getMember(ctx.from);
  m.contributed = Math.min(m.contributed + 100, 500);
  const remain = Math.max(500 - m.contributed, 0);
  const bar = progressBar(Math.round((m.contributed / 500) * 7), 7);
  await safeEdit(ctx, 
    `✅ 冲榜成功（Demo模拟 +RM100）\n\n` +
      `${bar}\n已累计冲榜：RM${m.contributed} / RM500\n` +
      (remain > 0 ? `还差 RM${remain} 即可抽 iPhone17 ProMax 🎯` : `🎉 已达标！快去客服兑换你的抽奖资格`),
    backButton()
  );
});

// ==================================================================
// 7. FAQ
// ==================================================================

const FAQ = {
  register: { title: "📝 如何注册", text: "1️⃣ 点击官网注册\n2️⃣ 填写基本资料\n3️⃣ OTP验证完成注册" },
  deposit: { title: "💰 如何充值", text: "1️⃣ 选择充值方式\n2️⃣ 输入金额\n3️⃣ 完成付款" },
  withdraw: { title: "🏧 如何提现", text: "1️⃣ 进入提现页面\n2️⃣ 填写金额与账户\n3️⃣ 等待审核放款" },
};

bot.action("faq_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    "❓ 常见问题",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("📝 如何注册", "faq_register"),
        Markup.button.callback("💰 如何充值", "faq_deposit"),
      ],
      [
        Markup.button.callback("🏧 如何提现", "faq_withdraw"),
        Markup.button.callback("⬅️ 返回主菜单", "back_menu"),
      ],
    ])
  );
});

["register", "deposit", "withdraw"].forEach((key) => {
  bot.action(`faq_${key}`, async (ctx) => {
    await ctx.answerCbQuery();
    await safeEdit(ctx, `${FAQ[key].title}\n\n${FAQ[key].text}`, backButton());
  });
});

// ==================================================================
// 8. 内部功能展示（团队协作后台，手动点击预览，不会自动发送）
// ==================================================================

bot.action("internal_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    `🛠️ 内部工作管理系统 Demo\n\n` +
      `以下是团队协作后台会自动产出的内容示范，\n` +
      `正式运作时会在每天固定时间（例如中午12点）自动发送到内部工作群，\n` +
      `这里让你直接点开看看实际内容长什么样：`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("📝 今日发文", "internal_posts"),
        Markup.button.callback("📊 数据汇报", "internal_report"),
      ],
      [Markup.button.callback("👥 工作分配", "internal_tasks")],
      [Markup.button.callback("⬅️ 返回主菜单", "back_menu")],
    ])
  );
});

function internalBackButton() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️ 内部功能展示", "internal_menu"),
      Markup.button.callback("🏠 主菜单", "back_menu"),
    ],
  ]);
}

bot.action("internal_posts", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    `📝 今日发文排程（Demo 示范）\n\n` +
      `以下3篇文案已排定今日发布时间，请内容同事确认：\n\n` +
      `━━━━━━━━━━\n` +
      `【09:00】早安暖场\n` +
      `（这里会搭配相关素材图）\n\n` +
      `✅ 新用户注册即送 RM50 彩金\n` +
      `✅ 每日签到领积分，连续7天送VIP\n` +
      `✅ 手气旺的都在这里，你还在等什么？\n` +
      `👉 立即签到抢头彩\n\n` +
      `━━━━━━━━━━\n` +
      `【14:00】活动预告\n` +
      `（这里会搭配相关素材图）\n\n` +
      `🔥 豪礼派对周进行中，仅剩 2天14小时！\n` +
      `✅ 累充满RM500，抽iPhone17 ProMax\n` +
      `✅ 每日首充加送8%，冲得越多送得越多\n` +
      `✅ 名额有限，先冲先得\n` +
      `👉 立即冲榜锁定资格\n\n` +
      `━━━━━━━━━━\n` +
      `【20:00】晚间互动\n` +
      `（这里会搭配相关素材图）\n\n` +
      `🧧 今晚8点整点红包雨，准时空投！\n` +
      `✅ 手速快的先抢先得，慢一秒就没了\n` +
      `✅ 昨晚已有842人参与，你还没上车？\n` +
      `👉 设好闹钟，8点准时冲\n` +
      `━━━━━━━━━━\n\n` +
      `✅ 内容无误请忽略此消息，系统将按时自动发布\n` +
      `✏️ 如需修改，请于发布前联系 @content_team_lead\n\n` +
      `（正式运作时，此消息会在每天固定时间自动发送到工作群，\n` +
      `文案+素材图会一起发出，内容依当月真实排程与品牌调性生成，非固定模板）`,
    internalBackButton()
  );
});

bot.action("internal_report", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    `📊 数据汇报（Demo 示范）\n\n` +
      `📅 昨日数据摘要\n\n` +
      `👥 新增会员：128 人\n` +
      `📅 签到人数：842 人（较前日 +12%）\n` +
      `🎰 抽奖参与：356 次\n` +
      `🤝 新增推荐：47 组\n` +
      `💰 活动累计冲榜：RM48,200\n\n` +
      `🔥 表现最好的内容：\n「红包雨预告」— 互动率 32%，为本周最高\n\n` +
      `（正式运作时，此消息会在每天固定时间自动发送到工作群，\n` +
      `数据串接真实平台后台，含浏览量、转化率、ROI等完整报表）`,
    internalBackButton()
  );
});

bot.action("internal_tasks", async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, 
    `👥 工作分配（Demo 示范）\n\n` +
      `📱 内容组\n` +
      `・09:00 发布晨间暖场文案\n・14:00 发布活动进度更新\n・20:00 发布晚间红包预告\n` +
      `如有排程冲突，请联系 @content_team_lead\n\n` +
      `💬 客服组\n` +
      `・待处理咨询 12 则\n・VIP客户专属问题 3 则，优先处理\n` +
      `如需协助，请联系 @support_team_lead\n\n` +
      `🎨 设计组\n` +
      `・活动主视觉修改（1版待审）\n・晚间红包雨配图，需于18:00前完成\n` +
      `如需延期，请联系 @design_team_lead\n\n` +
      `📊 运营组\n` +
      `・核对今日签到/抽奖数据无误\n・更新活动排行榜前十名\n` +
      `如发现数据异常，请联系 @ops_team_lead\n\n` +
      `（正式运作时，此消息会在每天固定时间自动发送到工作群，\n` +
      `负责人与联系窗口依真实团队编制设定）`,
    internalBackButton()
  );
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
  bot
    .launch({ allowedUpdates: ["message", "callback_query"] })
    .catch((err) => console.error("❌ bot.launch 发生错误:", err.message));

  console.log(`${BRAND_NAME} Demo Bot 已启动`);
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
