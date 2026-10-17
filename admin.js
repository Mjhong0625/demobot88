// 管理后台：Express + 简易密码登入（cookie）
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

function startAdmin({ bot, store, sendAnnouncement, isReady }) {
  const app = express();
  const D = () => store.data;
  const PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString("hex");
  if (!process.env.ADMIN_PASSWORD) console.log(`[后台] 未设置 ADMIN_PASSWORD，本次随机密码：${PASSWORD}`);
  const token = crypto.createHmac("sha256", PASSWORD).update("mjh-admin").digest("hex");

  app.use(express.json({ limit: "1mb" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  const cookies = (req) =>
    Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, v.join("=")]));
  const authed = (req) => {
    const c = cookies(req).mjh_session || "";
    return c.length === token.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(token));
  };
  const guard = (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "未登入" }));

  // 健康检查
  app.get("/health", (req, res) => res.type("text").send(`ok | bot: ${isReady() ? "connected" : "connecting"}`));

  // 登入（简单防暴力破解）
  const fails = new Map();
  app.post("/api/login", (req, res) => {
    const ip = req.ip;
    const f = fails.get(ip) || { n: 0, t: 0 };
    if (f.n >= 8 && Date.now() - f.t < 600000) return res.status(429).json({ error: "尝试次数过多，请10分钟后再试" });
    if ((req.body.password || "") !== PASSWORD) {
      fails.set(ip, { n: f.n + 1, t: Date.now() });
      return res.status(401).json({ error: "密码不正确" });
    }
    fails.delete(ip);
    res.setHeader("Set-Cookie", `mjh_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    res.json({ ok: true });
  });
  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", "mjh_session=; HttpOnly; Path=/; Max-Age=0");
    res.json({ ok: true });
  });
  app.get("/api/me", (req, res) => res.json({ authed: authed(req), brand: D().brand }));

  // ---------- 总览 ----------
  app.get("/api/overview", guard, (req, res) => {
    const days = req.query.days === "30" ? 30 : 7;
    const fmt = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date(t));
    const labels = [];
    for (let i = days - 1; i >= 0; i--) labels.push(fmt(Date.now() - i * 86400000));
    const since = Date.now() - days * 86400000;
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
      days,
      labels,
      cards: {
        newUsers: ev.filter((e) => e.type === "start").length,
        binds: ev.filter((e) => e.type === "bind").length,
        checkins: uniq(["checkin"]),
        interact: uniq(["interact"]),
      },
      series: {
        newUsers: series(["start"], false),
        checkins: series(["checkin"], true),
        interact: series(["interact"], true),
      },
      attention: {
        scheduled: anns.filter((a) => a.status === "scheduled").length,
        drafts: anns.filter((a) => a.status === "draft").length,
        failed: failed.length,
        lastError: failed[0] ? `${failed[0].title}：${failed[0].error}` : "",
        botReady: isReady(),
        storageSet: !!process.env.STORAGE_CHAT_ID,
      },
    });
  });

  // ---------- 机器人设置 ----------
  app.get("/api/config", guard, (req, res) => {
    const d = D();
    res.json({ brand: d.brand, welcome: d.welcome, menu: d.menu, faq: d.faq, activity: d.activity, media: d.media.map(({ id, name, type }) => ({ id, name, type })) });
  });

  const okUrl = (u) => /^(https?:\/\/|tg:\/\/)/i.test(u || "");
  app.put("/api/menu", guard, (req, res) => {
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
          id: b.id || store.uid(),
          label,
          type,
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
    store.logAction("更新菜单按钮", `${clean.length} 行`);
    store.save();
    res.json({ ok: true });
  });

  app.put("/api/welcome", guard, (req, res) => {
    D().welcome = { imageId: String(req.body.imageId || ""), caption: String(req.body.caption || "").slice(0, 1000) };
    store.logAction("更新欢迎页");
    store.save();
    res.json({ ok: true });
  });

  app.put("/api/faq", guard, (req, res) => {
    const list = (req.body.faq || []).slice(0, 20).map((f) => ({ id: f.id || store.uid(), title: String(f.title || "").slice(0, 40), text: String(f.text || "").slice(0, 3500) })).filter((f) => f.title);
    D().faq = list;
    store.logAction("更新常见问题", `${list.length} 条`);
    store.save();
    res.json({ ok: true });
  });

  app.put("/api/activity", guard, (req, res) => {
    const a = req.body.activity || {};
    const end = new Date(a.endAt);
    if (isNaN(end)) return res.status(400).json({ error: "结束时间格式不正确" });
    D().activity = {
      enabled: a.enabled !== false,
      title: String(a.title || "").slice(0, 80),
      body: String(a.body || "").slice(0, 900),
      imageId: String(a.imageId || ""),
      endAt: end.toISOString(),
      goal: Math.max(1, Number(a.goal) || 500),
      prize: String(a.prize || "").slice(0, 60),
    };
    store.logAction("更新活动", D().activity.title);
    store.save();
    res.json({ ok: true });
  });

  // ---------- 公告 / 发文排程 ----------
  app.get("/api/announcements", guard, (req, res) => {
    res.json({ list: D().announcements.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)), defaultTarget: process.env.DEFAULT_TARGET || "" });
  });

  app.post("/api/announcements", guard, (req, res) => {
    const b = req.body;
    const at = b.at ? new Date(b.at) : null;
    if (b.status === "scheduled" && (!at || isNaN(at))) return res.status(400).json({ error: "确认排程前请先选择发布时间" });
    if (!String(b.text || "").trim() && !b.mediaId) return res.status(400).json({ error: "请填写正文或选择素材" });
    let a = b.id ? D().announcements.find((x) => x.id === b.id) : null;
    if (a && a.status === "sent") return res.status(400).json({ error: "已发送的公告不能再修改" });
    if (!a) {
      a = { id: store.uid(), createdAt: new Date().toISOString() };
      D().announcements.push(a);
    }
    Object.assign(a, {
      title: String(b.title || "").slice(0, 80),
      target: String(b.target || "").trim(),
      text: String(b.text || "").slice(0, 4000),
      mediaId: b.mediaId || "",
      at: at && !isNaN(at) ? at.toISOString() : null,
      status: b.status === "scheduled" ? "scheduled" : "draft",
      error: "",
    });
    store.logAction(a.status === "scheduled" ? "确认排程" : "保存草稿", a.title || a.id);
    store.save();
    res.json({ ok: true, announcement: a });
  });

  app.delete("/api/announcements/:id", guard, (req, res) => {
    const i = D().announcements.findIndex((x) => x.id === req.params.id);
    if (i >= 0) {
      store.logAction("删除公告", D().announcements[i].title || "");
      D().announcements.splice(i, 1);
      store.save();
    }
    res.json({ ok: true });
  });

  // 立即发送测试（发到 STORAGE_CHAT_ID，也就是你自己的私聊）
  app.post("/api/announcements/test", guard, async (req, res) => {
    const target = process.env.STORAGE_CHAT_ID;
    if (!target) return res.status(400).json({ error: "尚未设置 STORAGE_CHAT_ID，无法发送测试" });
    try {
      await sendAnnouncement({ text: req.body.text, mediaId: req.body.mediaId }, target);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "发送失败：" + e.message });
    }
  });

  // ---------- 素材库（上传后自动转成 Telegram file_id） ----------
  app.get("/api/media", guard, (req, res) => res.json({ list: D().media.map(({ id, name, type, size, createdAt }) => ({ id, name, type, size, createdAt })) }));

  app.post("/api/media", guard, upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "没有收到文件" });
    const chat = process.env.STORAGE_CHAT_ID;
    if (!chat) return res.status(400).json({ error: "尚未设置 STORAGE_CHAT_ID（先私聊 bot 发 /chatid 取得）" });
    const isImg = f.mimetype.startsWith("image/");
    const isVid = f.mimetype.startsWith("video/");
    if (!isImg && !isVid) return res.status(400).json({ error: "只支持图片和视频" });
    if (isImg && f.size > 10 * 1024 * 1024) return res.status(400).json({ error: "图片请控制在 10MB 以内" });
    try {
      const name = Buffer.from(f.originalname, "latin1").toString("utf8");
      let fileId;
      if (isImg) {
        const msg = await bot.telegram.sendPhoto(chat, { source: f.buffer, filename: name });
        fileId = msg.photo[msg.photo.length - 1].file_id;
      } else {
        const msg = await bot.telegram.sendVideo(chat, { source: f.buffer, filename: name }, { supports_streaming: true });
        fileId = msg.video.file_id;
      }
      const item = { id: store.uid(), name, type: isImg ? "photo" : "video", fileId, size: f.size, createdAt: new Date().toISOString() };
      D().media.push(item);
      store.logAction("上传素材", name);
      store.save();
      res.json({ ok: true, item: { id: item.id, name, type: item.type, fileId } });
    } catch (e) {
      res.status(500).json({ error: "上传到 Telegram 失败：" + e.message });
    }
  });

  app.delete("/api/media/:id", guard, (req, res) => {
    const i = D().media.findIndex((m) => m.id === req.params.id);
    if (i >= 0) {
      store.logAction("删除素材", D().media[i].name);
      D().media.splice(i, 1);
      store.save();
    }
    res.json({ ok: true });
  });

  // 图片缩图：由服务器向 Telegram 取回再转给浏览器
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

  // 取得 file_id（让菜单按钮/活动/欢迎页选素材）
  app.get("/api/media-ids", guard, (req, res) => res.json({ list: D().media.filter((m) => m.type === "photo").map((m) => ({ id: m.id, name: m.name, fileId: m.fileId })) }));

  // ---------- 操作记录 ----------
  app.get("/api/log", guard, (req, res) => res.json({ list: D().log.slice(0, 100) }));

  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`管理后台已启动，port ${PORT}`));
}

module.exports = { startAdmin };
