// 简易数据层：全部放记忆体，同时写入 DATA_DIR/data.json（有挂 Railway Volume 时重启不会丢）
const fs = require("fs");
const path = require("path");

const DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DIR, "data.json");

const uid = () => Math.random().toString(36).slice(2, 10);

// DEMO_MODE=1：展示用 demo（含示范功能和示范文案）。正式客户部署不要设，默认是中性的真实版本。
const DEMO = process.env.DEMO_MODE === "1";

// 示范内容（只在 DEMO_MODE=1 使用）
const demoEnd = new Date(Date.now() + 7 * 86400000);
demoEnd.setHours(20, 0, 0, 0);
const DEMO_WELCOME = {
      imageId: process.env.WELCOME_IMAGE_URL || "",
      caption:
        "👋 欢迎加入 {brand} VIP专属通道！\n\n🔥 新会员首绑即领 Giftcode\n🎁 今日已有 {count} 人签到领奖\n💰 邀请好友最高可得 RM318\n\n（这是功能展示 Demo，数据仅供体验）\n\n请点击下方按钮开始体验：",
    };
const DEMO_MENU = [
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
    ];
const DEMO_FAQ = [
      { id: "f1", title: "📝 如何注册", text: "1️⃣ 点击官网注册\n2️⃣ 填写基本资料\n3️⃣ OTP验证完成注册" },
      { id: "f2", title: "💰 如何充值", text: "1️⃣ 选择充值方式\n2️⃣ 输入金额\n3️⃣ 完成付款" },
      { id: "f3", title: "🏧 如何提现", text: "1️⃣ 进入提现页面\n2️⃣ 填写金额与账户\n3️⃣ 等待审核放款" },
    ];
const DEMO_ACTIVITY = {
      enabled: true,
      title: "豪礼派对周｜Golden Party Week",
      body: "本周三大福利：\n🎁 每日首充加送 8%\n🏆 累充满RM500，抽iPhone17 ProMax\n🧧 每晚8点整点红包雨，手快有手慢无",
      imageId: process.env.ACTIVITY_IMAGE_URL || "",
      endAt: demoEnd.toISOString(),
      goal: 500,
      prize: "iPhone17 ProMax",
    };

function defaults() {
  const brand = process.env.BRAND_NAME || (DEMO ? "DemoBet88" : "我的品牌");
  const end = new Date(Date.now() + 7 * 86400000);
  end.setHours(20, 0, 0, 0);
  return {
    brand,
    welcome: DEMO ? DEMO_WELCOME : {
      imageId: process.env.WELCOME_IMAGE_URL || "",
      caption: "👋 欢迎来到 {brand}！\n\n请点击下方按钮，选择你需要的服务：",
    },
    menu: DEMO ? DEMO_MENU : [
      [{ id: "m_checkin", label: "📅 每日签到", type: "builtin", action: "checkin", enabled: true }],
      [{ id: "m_faq", label: "❓ 常见问题", type: "builtin", action: "faq_menu", enabled: true }],
    ],
    faq: DEMO ? DEMO_FAQ : [
      { id: "f1", title: "❓ 示例问题一", text: "这里是示例答案，请到后台「机器人设置 › 常见问题」修改成你自己的内容。" },
    ],
    activity: DEMO ? DEMO_ACTIVITY : { enabled: false, title: "", body: "", imageId: "", endAt: end.toISOString(), goal: 500, prize: "" },
    announcements: [],
    media: [],
    users: [],
    targets: [],
    events: [],
    log: [],
    tgUsers: {}, // Telegram 用户档案：id -> {username,name,lang,firstSeen,lastSeen,count}
    members: {}, // 会员资料（积分、绑定ID等），原本在记忆体，现在会永久保存
    checkins: {}, // 签到记录
    clicks: [], // 帖子按钮点击记录 {t, a:公告id, b:按钮序号, h:访客指纹}
    memberStats: [], // 群人数快照 {t, c:chatId, n}
    weekly: { enabled: false, weekday: 1, hour: 9, lastSent: "" }, // 每周报告（默认关闭）
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

for (const k of ["tgUsers", "members", "checkins"]) if (!data[k] || typeof data[k] !== "object" || Array.isArray(data[k])) data[k] = {};

// 像 Map 一样用的永久表（背后是 data.json 里的对象）
function table(name) {
  return {
    get: (k) => data[name][String(k)],
    has: (k) => String(k) in data[name],
    set(k, v) { data[name][String(k)] = v; save(); return this; },
    get size() { return Object.keys(data[name]).length; },
    values: () => Object.values(data[name]),
    entries: () => Object.entries(data[name]),
  };
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

function logAction(action, detail, actor) {
  data.log.unshift({ t: Date.now(), action, detail: detail || "", by: actor || "系统" });
  if (data.log.length > 300) data.log.length = 300;
  save();
}

module.exports = { get data() { return data; }, save, uid, logEvent, logAction, table, DEMO };
