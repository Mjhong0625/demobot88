// 简易数据层：全部放记忆体，同时写入 DATA_DIR/data.json（有挂 Railway Volume 时重启不会丢）
const fs = require("fs");
const path = require("path");

const DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DIR, "data.json");

const uid = () => Math.random().toString(36).slice(2, 10);

function defaults() {
  const brand = process.env.BRAND_NAME || "DemoBet88";
  const end = new Date(Date.now() + 7 * 86400000);
  end.setHours(20, 0, 0, 0);
  return {
    brand,
    welcome: {
      imageId: process.env.WELCOME_IMAGE_URL || "",
      caption:
        "👋 欢迎加入 {brand} VIP专属通道！\n\n🔥 新会员首绑即领 Giftcode\n🎁 今日已有 {count} 人签到领奖\n💰 邀请好友最高可得 RM318\n\n（这是功能展示 Demo，数据仅供体验）\n\n请点击下方按钮开始体验：",
    },
    menu: [
      [{ id: "m_act", label: "🔥 限时活动：豪礼派对周", type: "builtin", action: "activity_menu", enabled: true }],
      [
        { id: "m_gift", label: "🎁 领取Giftcode", type: "builtin", action: "bind_id", enabled: true },
        { id: "m_checkin", label: "📅 每日签到", type: "builtin", action: "checkin", enabled: true },
      ],
      [
        { id: "m_pts", label: "💎 我的积分", type: "builtin", action: "my_points", enabled: true },
        { id: "m_draw", label: "🎰 幸运抽奖", type: "builtin", action: "lucky_draw", enabled: true },
      ],
      [
        { id: "m_ref", label: "🤝 邀请好友", type: "builtin", action: "referral", enabled: true },
        { id: "m_faq", label: "❓ 常见问题", type: "builtin", action: "faq_menu", enabled: true },
      ],
      [{ id: "m_int", label: "🛠️ 内部功能展示（团队协作）", type: "builtin", action: "internal_menu", enabled: true }],
    ],
    faq: [
      { id: "f1", title: "📝 如何注册", text: "1️⃣ 点击官网注册\n2️⃣ 填写基本资料\n3️⃣ OTP验证完成注册" },
      { id: "f2", title: "💰 如何充值", text: "1️⃣ 选择充值方式\n2️⃣ 输入金额\n3️⃣ 完成付款" },
      { id: "f3", title: "🏧 如何提现", text: "1️⃣ 进入提现页面\n2️⃣ 填写金额与账户\n3️⃣ 等待审核放款" },
    ],
    activity: {
      enabled: true,
      title: "豪礼派对周｜Golden Party Week",
      body: "本周三大福利：\n🎁 每日首充加送 8%\n🏆 累充满RM500，抽iPhone17 ProMax\n🧧 每晚8点整点红包雨，手快有手慢无",
      imageId: process.env.ACTIVITY_IMAGE_URL || "",
      endAt: end.toISOString(),
      goal: 500,
      prize: "iPhone17 ProMax",
    },
    announcements: [],
    media: [],
    events: [],
    log: [],
  };
}

let data = defaults();
try {
  if (fs.existsSync(FILE)) {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    data = { ...data, ...saved };
    console.log("[store] 已读取 " + FILE);
  }
} catch (e) {
  console.error("[store] 读取失败，使用默认值:", e.message);
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(data));
    } catch (e) {
      console.error("[store] 写入失败（若未挂 Volume，重启会重置，属正常）:", e.message);
    }
  }, 500);
}

function logEvent(type, userId) {
  data.events.push({ t: Date.now(), type, u: userId || 0 });
  if (data.events.length > 20000) data.events.splice(0, data.events.length - 20000);
  save();
}

function logAction(action, detail) {
  data.log.unshift({ t: Date.now(), action, detail: detail || "" });
  if (data.log.length > 300) data.log.length = 300;
  save();
}

module.exports = { get data() { return data; }, save, uid, logEvent, logAction };
