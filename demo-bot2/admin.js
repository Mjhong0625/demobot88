// 管理后台：Express + 账号登入（超级管理员 / 管理员）+ 素材 30 天自动清理
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

const DAY = 86400000;
const TTL_DAYS = Math.max(1, Number(process.env.MEDIA_TTL_DAYS) || 30);

// 权限表：super_admin = 全部；admin = 只管内容（总览、发文排程、素材库）
const PERMS = {
  super_admin: ["content", "bot", "users", "log", "targets_edit"],
  admin: ["content"],
};
const ROLE_LABEL = { super_admin: "超级管理员", admin: "管理员" };

function startAdmin({ bot, store, sendAnnouncement, checkNow, isReady, token: BOT_TOKEN }) {
  const app = express();
  const D = () => store.data;

  // ---------------- 账号与密码 ----------------
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
  function setPassword(user, pw) {
    user.salt = crypto.randomBytes(16).toString("hex");
    user.hash = hashPw(pw, user.salt);
  }
  function checkPassword(user, pw) {
    const a = Buffer.from(hashPw(pw, user.salt), "hex");
    const b = Buffer.from(user.hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // 系统账号 owner：密码永远以环境变量 ADMIN_PASSWORD 为准（忘记密码时的恢复入口）
  const ENV_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString("hex");
  if (!process.env.ADMIN_PASSWORD) console.log(`[后台] 未设置 ADMIN_PASSWORD，本次随机密码：${ENV_PASSWORD}（账号：owner）`);
  let owner = D().users.find((u) => u.system);
  if (!owner) {
    owner = { id: store.uid(), username: "owner", displayName: "系统管理员", role: "super_admin", active: true, system: true, createdAt: new Date().toISOString() };
    D().users.push(owner);
  }
  setPassword(owner, ENV_PASSWORD);
  owner.active = true;
  owner.role = "super_admin";
  store.save();

  const publicUser = (u) => ({
    id: u.id, username: u.username, displayName: u.displayName, role: u.role, roleLabel: ROLE_LABEL[u.role],
    active: u.active !== false, system: !!u.system, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
  });
  const can = (u, perm) => !!u && (PERMS[u.role] || []).includes(perm);
  const actor = (req) => req.user.displayName || req.user.username;

  // ---------------- 登入状态（服务器端 session） ----------------
  const sessions = new Map(); // token -> { uid, exp }
  const SESSION_MS = 7 * DAY;
  const cookies = (req) =>
    Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, v.join("=")]));
  function userFromReq(req) {
    const t = cookies(req).mjh_session;
    const s = t && sessions.get(t);
    if (!s || s.exp < Date.now()) { if (t) sessions.delete(t); return null; }
    const u = D().users.find((x) => x.id === s.uid);
    return u && u.active !== false ? u : null;
  }
  const purgeSessions = (uid) => { for (const [t, s] of sessions) if (s.uid === uid) sessions.delete(t); };
  setInterval(() => { for (const [t, s] of sessions) if (s.exp < Date.now()) sessions.delete(t); }, 3600000).unref();

  const guard = (req, res, next) => {
    const u = userFromReq(req);
    if (!u) return res.status(401).json({ error: "未登入" });
    req.user = u;
    next();
  };
  const need = (perm) => [guard, (req, res, next) => (can(req.user, perm) ? next() : res.status(403).json({ error: "你的账号没有权限执行此操作" }))];

  app.use(express.json({ limit: "1mb" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.get("/health", (req, res) => res.type("text").send(`ok | bot: ${isReady() ? "connected" : "connecting"}`));

  // ---------------- 登入 / 登出 / 我 ----------------
  const fails = new Map();
  app.post("/api/login", (req, res) => {
    const username = String(req.body.username || "owner").trim().toLowerCase();
    const key = `${req.ip}|${username}`;
    const f = fails.get(key) || { n: 0, t: 0 };
    if (f.n >= 8 && Date.now() - f.t < 600000) return res.status(429).json({ error: "尝试次数过多，请10分钟后再试" });
    const user = D().users.find((u) => u.username === username);
    if (!user || !checkPassword(user, req.body.password || "")) {
      fails.set(key, { n: f.n + 1, t: Date.now() });
      return res.status(401).json({ error: "账号或密码不正确" });
    }
    if (user.active === false) return res.status(403).json({ error: "此账号已停用，请联系你的管理员" });
    fails.delete(key);
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { uid: user.id, exp: Date.now() + SESSION_MS });
    user.lastLoginAt = new Date().toISOString();
    store.save();
    res.setHeader("Set-Cookie", `mjh_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    res.json({ ok: true });
  });
  app.post("/api/logout", (req, res) => {
    const t = cookies(req).mjh_session;
    if (t) sessions.delete(t);
    res.setHeader("Set-Cookie", "mjh_session=; HttpOnly; Path=/; Max-Age=0");
    res.json({ ok: true });
  });
  app.get("/api/me", (req, res) => {
    const u = userFromReq(req);
    res.json({
      authed: !!u,
      brand: D().brand,
      user: u ? publicUser(u) : null,
      can: u ? { bot: can(u, "bot"), users: can(u, "users"), log: can(u, "log"), targetsEdit: can(u, "targets_edit") } : null,
      mediaTtlDays: TTL_DAYS,
    });
  });

  app.post("/api/me/password", guard, (req, res) => {
    if (req.user.system) return res.status(400).json({ error: "系统账号的密码需在服务器变量 ADMIN_PASSWORD 修改" });
    const { oldPassword, newPassword } = req.body;
    if (!checkPassword(req.user, oldPassword || "")) return res.status(400).json({ error: "目前的密码不正确" });
    if (String(newPassword || "").length < 8) return res.status(400).json({ error: "新密码至少 8 个字符" });
    setPassword(req.user, newPassword);
    store.logAction("修改自己的密码", "", actor(req));
    store.save();
    res.json({ ok: true });
  });

  // ---------------- 员工账号（仅超级管理员） ----------------
  const validUsername = (s) => /^[a-z0-9][a-z0-9_.-]{2,23}$/.test(s);
  app.get("/api/users", need("users"), (req, res) => {
    res.json({ list: D().users.map((u) => ({ ...publicUser(u), isSelf: u.id === req.user.id })), roles: ROLE_LABEL });
  });
  app.post("/api/users", need("users"), (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();
    const role = req.body.role;
    if (!validUsername(username)) return res.status(400).json({ error: "账号需为 3 到 24 位的英文小写、数字、点、下划线或横线" });
    if (!PERMS[role]) return res.status(400).json({ error: "请选择角色" });
    if (String(req.body.password || "").length < 8) return res.status(400).json({ error: "密码至少 8 个字符" });
    if (D().users.some((u) => u.username === username)) return res.status(400).json({ error: "这个账号已经存在" });
    const u = { id: store.uid(), username, displayName: String(req.body.displayName || username).trim().slice(0, 30), role, active: true, createdAt: new Date().toISOString(), createdBy: actor(req) };
    setPassword(u, req.body.password);
    D().users.push(u);
    store.logAction("新增员工账号", `${u.displayName}（${ROLE_LABEL[role]}）`, actor(req));
    store.save();
    res.json({ ok: true, user: publicUser(u) });
  });
  app.put("/api/users/:id", need("users"), (req, res) => {
    const u = D().users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: "找不到这个账号" });
    const b = req.body;
    const self = u.id === req.user.id;
    if (u.system && (b.role !== undefined || b.active !== undefined || b.password)) return res.status(400).json({ error: "系统账号不能在这里修改角色、停用或改密码" });
    if (self && (b.active === false || (b.role && b.role !== u.role))) return res.status(400).json({ error: "不能停用或降级自己的账号" });
    if (b.role !== undefined && !PERMS[b.role]) return res.status(400).json({ error: "角色不正确" });
    if (b.password !== undefined && b.password !== "" && String(b.password).length < 8) return res.status(400).json({ error: "新密码至少 8 个字符" });
    // 至少保留一个启用中的超级管理员
    const afterRole = b.role ?? u.role, afterActive = b.active ?? (u.active !== false);
    if (u.role === "super_admin" && (afterRole !== "super_admin" || !afterActive)) {
      const others = D().users.filter((x) => x.id !== u.id && x.role === "super_admin" && x.active !== false);
      if (!others.length) return res.status(400).json({ error: "至少要保留一位启用中的超级管理员" });
    }
    if (b.displayName !== undefined) u.displayName = String(b.displayName).trim().slice(0, 30) || u.username;
    if (b.role !== undefined) u.role = b.role;
    if (b.active !== undefined) u.active = !!b.active;
    if (b.password) setPassword(u, b.password);
    if (b.active === false || b.password || (b.role && !can(u, "content"))) purgeSessions(u.id);
    store.logAction("修改员工账号", `${u.displayName}${b.active === false ? "（已停用）" : b.password ? "（已重设密码）" : ""}`, actor(req));
    store.save();
    res.json({ ok: true, user: publicUser(u) });
  });
  app.delete("/api/users/:id", need("users"), (req, res) => {
    const i = D().users.findIndex((x) => x.id === req.params.id);
    if (i < 0) return res.json({ ok: true });
    const u = D().users[i];
    if (u.system) return res.status(400).json({ error: "系统账号不能删除" });
    if (u.id === req.user.id) return res.status(400).json({ error: "不能删除自己的账号" });
    if (u.role === "super_admin" && !D().users.some((x) => x.id !== u.id && x.role === "super_admin" && x.active !== false))
      return res.status(400).json({ error: "至少要保留一位启用中的超级管理员" });
    D().users.splice(i, 1);
    purgeSessions(u.id);
    store.logAction("删除员工账号", u.displayName, actor(req));
    store.save();
    res.json({ ok: true });
  });

  // ---------------- 素材：引用检查 / 30 天清理 ----------------
  const expOf = (m) => m.expiresAt || new Date(new Date(m.createdAt).getTime() + TTL_DAYS * DAY).toISOString();
  function mediaUse(m) {
    if (D().announcements.some((a) => a.mediaId === m.id && a.status !== "sent")) return "排程或草稿使用中";
    const d = D();
    const fid = m.fileId;
    const inSettings = d.welcome.imageId === fid || d.activity.imageId === fid || d.menu.some((row) => row.some((b) => b.imageId === fid));
    return inSettings ? "机器人设置使用中" : "";
  }
  const mediaView = (m) => {
    const exp = new Date(expOf(m)).getTime();
    const use = mediaUse(m);
    return { id: m.id, name: m.name, type: m.type, size: m.size, createdAt: m.createdAt, uploadedBy: m.uploadedBy || "", expiresAt: new Date(exp).toISOString(), daysLeft: Math.max(0, Math.ceil((exp - Date.now()) / DAY)), inUse: !!use, inUseReason: use };
  };

  async function cleanupMedia() {
    const now = Date.now();
    const keep = [];
    let removed = 0;
    for (const m of D().media) {
      if (new Date(expOf(m)).getTime() > now || mediaUse(m)) { keep.push(m); continue; }
      removed++;
      if (m.chatId && m.msgId) bot.telegram.deleteMessage(m.chatId, m.msgId).catch(() => {});
    }
    if (removed) {
      D().media = keep;
      store.logAction("素材到期自动清理", `${removed} 个（超过 ${TTL_DAYS} 天且没有被使用）`, "系统");
      store.save();
      console.log(`[素材清理] 已清理 ${removed} 个过期素材`);
    }
  }
  setTimeout(cleanupMedia, 15000).unref();
  setInterval(cleanupMedia, 3600000).unref();

  // ---------------- 总览 ----------------
  app.get("/api/overview", guard, (req, res) => {
    const days = req.query.days === "30" ? 30 : 7;
    const fmt = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date(t));
    const labels = [];
    for (let i = days - 1; i >= 0; i--) labels.push(fmt(Date.now() - i * DAY));
    const since = Date.now() - days * DAY;
    const ev = D().events.filter((e) => e.t >= since);
    const uniq = (types) => new Set(ev.filter((e) => types.includes(e.type)).map((e) => e.u)).size;
    const series = (types, unique) =>
      labels.map((d) => {
        const list = ev.filter((e) => types.includes(e.type) && fmt(e.t) === d);
        return unique ? new Set(list.map((e) => e.u)).size : list.length;
      });
    const anns = D().announcements;
    const failed = anns.filter((a) => a.status === "failed");
    res.json({
      days, labels,
      cards: { newUsers: ev.filter((e) => e.type === "start").length, binds: ev.filter((e) => e.type === "bind").length, checkins: uniq(["checkin"]), interact: uniq(["interact"]) },
      series: { newUsers: series(["start"], false), checkins: series(["checkin"], true), interact: series(["interact"], true) },
      attention: {
        scheduled: anns.filter((a) => a.status === "scheduled").length,
        drafts: anns.filter((a) => a.status === "draft").length,
        failed: failed.length,
        lastError: failed[0] ? `${failed[0].title || "公告"}：${failed[0].error}` : "",
        botReady: isReady(),
        storageSet: !!process.env.STORAGE_CHAT_ID,
        noTargets: !D().targets.length && !process.env.DEFAULT_TARGET,
        expiringMedia: D().media.filter((m) => { const v = mediaView(m); return !v.inUse && v.daysLeft <= 3; }).length,
      },
    });
  });

  // ---------------- 机器人设置（仅超级管理员） ----------------
  app.get("/api/config", need("bot"), (req, res) => {
    const d = D();
    res.json({ brand: d.brand, welcome: d.welcome, menu: d.menu, faq: d.faq, activity: d.activity, media: d.media.map(({ id, name, type }) => ({ id, name, type })) });
  });

  const okUrl = (u) => /^(https?:\/\/|tg:\/\/)/i.test(u || "");
  app.put("/api/menu", need("bot"), (req, res) => {
    const rows = req.body.menu;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "格式错误" });
    const clean = [];
    for (const row of rows.slice(0, 12)) {
      const r = [];
      for (const b of (row || []).slice(0, 3)) {
        const label = String(b.label || "").trim().slice(0, 40);
        if (!label) continue;
        const type = ["builtin", "text", "link"].includes(b.type) ? b.type : "text";
        if (type === "link" && !okUrl(b.url)) return res.status(400).json({ error: `按钮「${label}」的链接必须以 https:// 开头` });
        r.push({
          id: b.id || store.uid(), label, type,
          action: type === "builtin" ? String(b.action || "") : undefined,
          content: type === "text" ? String(b.content || "").slice(0, 3500) : undefined,
          imageId: type === "text" ? String(b.imageId || "") : undefined,
          url: type === "link" ? String(b.url) : undefined,
          enabled: b.enabled !== false,
        });
      }
      if (r.length) clean.push(r);
    }
    D().menu = clean;
    store.logAction("更新菜单按钮", `${clean.length} 行`, actor(req));
    store.save();
    res.json({ ok: true });
  });
  app.put("/api/welcome", need("bot"), (req, res) => {
    D().welcome = { imageId: String(req.body.imageId || ""), caption: String(req.body.caption || "").slice(0, 1000) };
    store.logAction("更新欢迎页", "", actor(req));
    store.save();
    res.json({ ok: true });
  });
  app.put("/api/faq", need("bot"), (req, res) => {
    const list = (req.body.faq || []).slice(0, 20).map((f) => ({ id: f.id || store.uid(), title: String(f.title || "").slice(0, 40), text: String(f.text || "").slice(0, 3500) })).filter((f) => f.title);
    D().faq = list;
    store.logAction("更新常见问题", `${list.length} 条`, actor(req));
    store.save();
    res.json({ ok: true });
  });
  app.put("/api/activity", need("bot"), (req, res) => {
    const a = req.body.activity || {};
    const end = new Date(a.endAt);
    if (isNaN(end)) return res.status(400).json({ error: "结束时间格式不正确" });
    D().activity = { enabled: a.enabled !== false, title: String(a.title || "").slice(0, 80), body: String(a.body || "").slice(0, 900), imageId: String(a.imageId || ""), endAt: end.toISOString(), goal: Math.max(1, Number(a.goal) || 500), prize: String(a.prize || "").slice(0, 60) };
    store.logAction("更新活动", D().activity.title, actor(req));
    store.save();
    res.json({ ok: true });
  });

  // ---------------- 常用发布位置 ----------------
  const targetList = () => {
    const l = D().targets.slice();
    if (process.env.DEFAULT_TARGET && !l.some((t) => t.chatId === process.env.DEFAULT_TARGET)) l.unshift({ id: "__default", name: "默认发布位置", chatId: process.env.DEFAULT_TARGET });
    return l;
  };
  app.get("/api/targets", guard, (req, res) => res.json({ list: targetList().map((t) => ({ id: t.id, name: t.name, chatId: can(req.user, "targets_edit") ? t.chatId : undefined })) }));
  app.put("/api/targets", need("targets_edit"), (req, res) => {
    const list = [];
    for (const t of (req.body.targets || []).slice(0, 30)) {
      const name = String(t.name || "").trim().slice(0, 40);
      let chatId = String(t.chatId || "").trim();
      if (!name && !chatId) continue;
      if (!name || !chatId) return res.status(400).json({ error: "每个发布位置都要填名称和群组/频道 ID" });
      if (!/^(@[A-Za-z0-9_]{4,}|-?\d{5,})$/.test(chatId)) return res.status(400).json({ error: `「${name}」的 ID 格式不对：请填 @频道用户名，或 -100 开头的数字 ID` });
      list.push({ id: t.id || store.uid(), name, chatId });
    }
    D().targets = list;
    store.logAction("更新发布位置", `${list.length} 个`, actor(req));
    store.save();
    res.json({ ok: true });
  });
  // 测试连接：确认 bot 进得去、能不能发
  app.post("/api/targets/check", guard, async (req, res) => {
    const chatId = String(req.body.chatId || "").trim();
    if (!chatId) return res.status(400).json({ error: "请先填写 ID" });
    try {
      const chat = await bot.telegram.getChat(chatId);
      const me = bot.botInfo || (await bot.telegram.getMe());
      const m = await bot.telegram.getChatMember(chat.id, me.id);
      const isAdmin = m.status === "administrator" || m.status === "creator";
      const canPost = chat.type === "channel" ? isAdmin && m.can_post_messages !== false : ["administrator", "creator", "member"].includes(m.status) && m.can_send_messages !== false;
      res.json({
        ok: true, title: chat.title || chat.username || String(chat.id), type: chat.type, canPost,
        message: canPost ? "连接成功，bot 可以发布" : chat.type === "channel" ? "bot 在这个频道里还不是管理员，请先把 bot 设为管理员并开启「发布消息」" : "bot 在这个群里暂时不能发言，请检查权限",
      });
    } catch (e) {
      res.status(400).json({ error: "连接失败：bot 找不到这个群组/频道，或还没有被加入。请确认 ID 正确，并把 bot 加为管理员。" });
    }
  });

  // ---------------- 公告 / 发文排程 ----------------
  const targetName = (a) => {
    if (a.targetId) return (targetList().find((t) => t.id === a.targetId) || {}).name || "（已删除的位置）";
    return a.target || "";
  };
  app.get("/api/announcements", guard, (req, res) => {
    res.json({
      list: D().announcements.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).map((a) => ({ ...a, targetName: targetName(a), mediaMissing: !!a.mediaId && !D().media.some((m) => m.id === a.mediaId) })),
      defaultTarget: process.env.DEFAULT_TARGET || "",
    });
  });

  app.post("/api/announcements", guard, (req, res) => {
    const b = req.body;
    const now = Date.now();
    const sendNow = b.sendNow === true;
    const status = sendNow || b.status === "scheduled" ? "scheduled" : "draft";
    let at = sendNow ? new Date(now) : b.at ? new Date(b.at) : null;
    if (at && isNaN(at)) at = null;
    const text = String(b.text || "");
    if (!text.trim() && !b.mediaId) return res.status(400).json({ error: "请填写正文，或添加一张图片/视频" });
    if (b.mediaId && !D().media.some((m) => m.id === b.mediaId)) return res.status(400).json({ error: "这个素材已经不存在，请重新上传或选择" });
    let targetId = String(b.targetId || "");
    if (targetId && !targetList().some((t) => t.id === targetId)) return res.status(400).json({ error: "选择的发布位置已不存在，请重新选择" });
    const legacyTarget = String(b.target || "").trim();
    if (status === "scheduled") {
      if (!targetId && !legacyTarget && !process.env.DEFAULT_TARGET) return res.status(400).json({ error: "请先选择发布位置" });
      if (!at) return res.status(400).json({ error: "请先选择发布时间" });
      if (!sendNow && at.getTime() < now - 60000) return res.status(400).json({ error: "选择的时间已经过去了，请选择之后的时间，或使用「立即发送」" });
    }
    let a = b.id ? D().announcements.find((x) => x.id === b.id) : null;
    if (a && a.status === "sent") return res.status(400).json({ error: "已发送的公告不能再修改，可以用「复制」另建一则" });
    if (!a) {
      a = { id: store.uid(), createdAt: new Date().toISOString(), createdBy: actor(req) };
      D().announcements.push(a);
    }
    Object.assign(a, {
      title: String(b.title || "").trim().slice(0, 80) || text.trim().split("\n")[0].slice(0, 20),
      targetId, target: targetId ? "" : legacyTarget,
      text: text.slice(0, 4000),
      mediaId: b.mediaId || "",
      at: at ? at.toISOString() : null,
      status, error: "", updatedBy: actor(req), updatedAt: new Date().toISOString(),
    });
    store.logAction(sendNow ? "立即发送公告" : status === "scheduled" ? "确认定时发送" : "保存草稿", a.title || a.id, actor(req));
    store.save();
    if (status === "scheduled" && at.getTime() <= now + 1000) setImmediate(() => checkNow().catch(() => {}));
    res.json({ ok: true, announcement: a });
  });

  app.delete("/api/announcements/:id", guard, (req, res) => {
    const i = D().announcements.findIndex((x) => x.id === req.params.id);
    if (i >= 0) {
      store.logAction("删除公告", D().announcements[i].title || "", actor(req));
      D().announcements.splice(i, 1);
      store.save();
    }
    res.json({ ok: true });
  });

  // 测试发送：发到 STORAGE_CHAT_ID（管理员自己的私聊）
  app.post("/api/announcements/test", guard, async (req, res) => {
    const target = process.env.STORAGE_CHAT_ID;
    if (!target) return res.status(400).json({ error: "还没有设置测试接收位置（STORAGE_CHAT_ID），请联系技术支持" });
    try {
      await sendAnnouncement({ text: req.body.text, mediaId: req.body.mediaId }, target);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "发送失败：" + e.message });
    }
  });

  // ---------------- 素材库 ----------------
  app.get("/api/media", guard, (req, res) => res.json({ list: D().media.map(mediaView).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), ttlDays: TTL_DAYS }));

  app.post("/api/media", guard, upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "没有收到文件" });
    const chat = process.env.STORAGE_CHAT_ID;
    if (!chat) return res.status(400).json({ error: "还没有设置素材存放位置（STORAGE_CHAT_ID），请联系技术支持" });
    const isImg = f.mimetype.startsWith("image/");
    const isVid = f.mimetype.startsWith("video/");
    if (!isImg && !isVid) return res.status(400).json({ error: "只支持图片和视频" });
    if (isImg && f.size > 10 * 1024 * 1024) return res.status(400).json({ error: "图片请控制在 10MB 以内" });
    try {
      const name = Buffer.from(f.originalname, "latin1").toString("utf8");
      let fileId, msg;
      if (isImg) {
        msg = await bot.telegram.sendPhoto(chat, { source: f.buffer, filename: name });
        fileId = msg.photo[msg.photo.length - 1].file_id;
      } else {
        msg = await bot.telegram.sendVideo(chat, { source: f.buffer, filename: name }, { supports_streaming: true });
        fileId = msg.video.file_id;
      }
      const item = {
        id: store.uid(), name, type: isImg ? "photo" : "video", fileId, size: f.size,
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL_DAYS * DAY).toISOString(),
        uploadedBy: actor(req), chatId: msg.chat && msg.chat.id, msgId: msg.message_id,
      };
      D().media.push(item);
      store.logAction("上传素材", name, actor(req));
      store.save();
      res.json({ ok: true, item: mediaView(item) });
    } catch (e) {
      res.status(500).json({ error: "上传失败：" + e.message });
    }
  });

  app.post("/api/media/:id/extend", guard, (req, res) => {
    const m = D().media.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: "找不到这个素材" });
    m.expiresAt = new Date(Date.now() + TTL_DAYS * DAY).toISOString();
    store.save();
    res.json({ ok: true, item: mediaView(m) });
  });

  app.delete("/api/media/:id", guard, (req, res) => {
    const i = D().media.findIndex((m) => m.id === req.params.id);
    if (i < 0) return res.json({ ok: true });
    const m = D().media[i];
    const use = mediaUse(m);
    if (use) return res.status(409).json({ error: `这个素材${use}，暂时不能删除。请先修改对应的公告或设置。` });
    if (m.chatId && m.msgId) bot.telegram.deleteMessage(m.chatId, m.msgId).catch(() => {});
    D().media.splice(i, 1);
    store.logAction("删除素材", m.name, actor(req));
    store.save();
    res.json({ ok: true });
  });

  app.get("/api/media/:id/file", guard, async (req, res) => {
    const m = D().media.find((x) => x.id === req.params.id);
    if (!m || m.type !== "photo") return res.status(404).end();
    try {
      const link = await bot.telegram.getFileLink(m.fileId);
      const r = await fetch(link.href || String(link));
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.status(502).end();
    }
  });

  app.get("/api/media-ids", need("bot"), (req, res) => res.json({ list: D().media.filter((m) => m.type === "photo").map((m) => ({ id: m.id, name: m.name, fileId: m.fileId })) }));


  // ---------------- 机器人资料：名称 / 头像 / 简介 / 说明 / 命令（直接同步到 Telegram，仅超级管理员） ----------------
  const tgErr = (e) => {
    const m = String((e && (e.description || e.message)) || e);
    const r = m.match(/retry after (\d+)/i);
    if (r) {
      const sec = Number(r[1]);
      const wait = sec >= 3600 ? Math.ceil(sec / 3600) + " 小时" : sec >= 120 ? Math.ceil(sec / 60) + " 分钟" : sec + " 秒";
      return `Telegram 限制了修改频率（改名字尤其严格），请 ${wait}后再试`;
    }
    return m.replace(/^\d+: /, "");
  };
  const API_ROOT = process.env.TELEGRAM_API_ROOT || "https://api.telegram.org";
  const call = (method, payload) => bot.telegram.callApi(method, payload || {});

  app.get("/api/bot-profile", need("bot"), async (req, res) => {
    const [n, s, d, c] = await Promise.allSettled([call("getMyName"), call("getMyShortDescription"), call("getMyDescription"), call("getMyCommands")]);
    const me = bot.botInfo || {};
    res.json({
      username: me.username || "",
      name: n.status === "fulfilled" ? n.value.name : "",
      shortDescription: s.status === "fulfilled" ? s.value.short_description : "",
      description: d.status === "fulfilled" ? d.value.description : "",
      commands: c.status === "fulfilled" ? c.value.map((x) => ({ command: x.command, description: x.description })) : [],
      readOk: [n, s, d, c].every((x) => x.status === "fulfilled"),
    });
  });

  app.put("/api/bot-profile", need("bot"), async (req, res) => {
    const b = req.body || {};
    const name = String(b.name ?? "").trim(), shortD = String(b.shortDescription ?? "").trim(), desc = String(b.description ?? "").trim();
    if (!name) return res.status(400).json({ error: "机器人名称不能为空" });
    if (name.length > 64) return res.status(400).json({ error: "名称最多 64 个字符" });
    if (shortD.length > 120) return res.status(400).json({ error: "简介最多 120 个字符" });
    if (desc.length > 512) return res.status(400).json({ error: "说明最多 512 个字符" });
    const cmds = [];
    for (const c of (b.commands || []).slice(0, 30)) {
      const command = String(c.command || "").trim().replace(/^\//, "").toLowerCase();
      const description = String(c.description || "").trim();
      if (!command && !description) continue;
      if (!/^[a-z0-9_]{1,32}$/.test(command)) return res.status(400).json({ error: `命令「${command || "（空）"}」只能用英文小写、数字和下划线，最多 32 个字符` });
      if (!description || description.length > 256) return res.status(400).json({ error: `命令 /${command} 需要填写说明（最多 256 个字符）` });
      cmds.push({ command, description });
    }
    if (new Set(cmds.map((c) => c.command)).size !== cmds.length) return res.status(400).json({ error: "命令名称不能重复" });

    // 只提交有变化的项目（避免触发 Telegram 对改名的频率限制）
    const [n, s, d, c] = await Promise.allSettled([call("getMyName"), call("getMyShortDescription"), call("getMyDescription"), call("getMyCommands")]);
    const cur = {
      name: n.status === "fulfilled" ? n.value.name : null,
      short: s.status === "fulfilled" ? s.value.short_description : null,
      desc: d.status === "fulfilled" ? d.value.description : null,
      cmds: c.status === "fulfilled" ? JSON.stringify(c.value.map((x) => ({ command: x.command, description: x.description }))) : null,
    };
    const results = {};
    const run = async (key, changed, fn) => {
      if (!changed) { results[key] = { ok: true, skipped: true }; return; }
      try { await fn(); results[key] = { ok: true }; } catch (e) { results[key] = { ok: false, error: tgErr(e) }; }
    };
    await run("name", name !== cur.name, () => call("setMyName", { name }));
    await run("shortDescription", shortD !== cur.short, () => call("setMyShortDescription", { short_description: shortD }));
    await run("description", desc !== cur.desc, () => call("setMyDescription", { description: desc }));
    await run("commands", JSON.stringify(cmds) !== cur.cmds, () => (cmds.length ? call("setMyCommands", { commands: cmds }) : call("deleteMyCommands")));
    const changed = Object.entries(results).filter(([, v]) => v.ok && !v.skipped).map(([k]) => k);
    if (changed.length) store.logAction("更新机器人资料", changed.map((k) => ({ name: "名称", shortDescription: "简介", description: "说明", commands: "命令" }[k])).join("、"), actor(req));
    res.json({ ok: Object.values(results).every((v) => v.ok), results });
  });

  app.post("/api/bot-profile/avatar", need("bot"), upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f || !f.mimetype.startsWith("image/")) return res.status(400).json({ error: "请选择一张图片（建议正方形的 JPG，至少 512x512）" });
    if (f.size > 5 * 1024 * 1024) return res.status(400).json({ error: "头像图片请控制在 5MB 以内" });
    try {
      const fd = new FormData();
      fd.append("photo", JSON.stringify({ type: "static", photo: "attach://avatar" }));
      fd.append("avatar", new Blob([f.buffer], { type: f.mimetype }), "avatar.jpg");
      const r = await fetch(`${API_ROOT}/bot${BOT_TOKEN}/setMyProfilePhoto`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.description || "Telegram 没有接受这张图片");
      store.logAction("更换机器人头像", "", actor(req));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: `头像更换失败：${tgErr(e)}。请换一张正方形 JPG 图片再试。` });
    }
  });
  app.delete("/api/bot-profile/avatar", need("bot"), async (req, res) => {
    try { await call("removeMyProfilePhoto"); store.logAction("移除机器人头像", "", actor(req)); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: "移除失败：" + tgErr(e) }); }
  });
  // 目前头像（尽力而为：取不到就让前端显示占位图）
  app.get("/api/bot-profile/avatar", need("bot"), async (req, res) => {
    try {
      const me = bot.botInfo || (await bot.telegram.getMe());
      const ph = await bot.telegram.getUserProfilePhotos(me.id, 0, 1);
      if (!ph.total_count) return res.status(404).end();
      const sizes = ph.photos[0];
      const link = await bot.telegram.getFileLink(sizes[sizes.length - 1].file_id);
      const r = await fetch(link.href || String(link));
      res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.status(404).end(); }
  });

  // ---------------- 操作记录（仅超级管理员） ----------------
  app.get("/api/log", need("log"), (req, res) => res.json({ list: D().log.slice(0, 150) }));

  // ---------------- 静态页面与错误处理 ----------------
  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
  app.use((err, req, res, next) => {
    if (err && err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "文件太大：图片上限 10MB，视频上限 50MB" });
    console.error("[后台] 请求出错:", err && err.message);
    res.status(err && err.status ? err.status : 500).json({ error: "操作没有成功，请稍后重试" });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`管理后台已启动，port ${PORT}`));
}

module.exports = { startAdmin };
