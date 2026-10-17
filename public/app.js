/* MJH Desk 业务逻辑（交互、接口调用）。界面外壳在 index.html + mjh-ui.css，新增元素的功能性样式在 app.css。 */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = {
  overview: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  schedule: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  media: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  bot: '<svg viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/></svg>',
  staff: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .6 3.3 2.2 3.5 5.2"/></svg>',
  log: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
};
const ALL_PAGES = [["overview", "工作总览", "overview"], ["schedule", "发文排程", "schedule"], ["media", "素材库", "media"], ["bot", "机器人设置", "bot"], ["staff", "员工与权限", "staff"], ["log", "操作记录", "log"]];
const BUILTIN = { activity_menu: "限时活动", bind_id: "领取Giftcode", checkin: "每日签到", my_points: "我的积分", lucky_draw: "幸运抽奖", referral: "邀请好友", faq_menu: "常见问题", internal_menu: "内部功能展示" };
const STATUS = { draft: "草稿", scheduled: "待发送", sent: "已发送", failed: "发送失败" };
const ROLE_DESC = { super_admin: "可以管理员工账号、机器人设置、发布位置，以及发文和素材", admin: "负责日常发文和素材，不能改机器人设置和员工账号", guest: "只能查看所有页面内容，不能修改任何东西，适合给潜在客户或同事浏览" };

let ME = null, BRAND = "", PAGES = ALL_PAGES.slice(0, 3);

async function api(path, opts = {}) {
  const o = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  const r = await fetch("/api/" + path, o);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "login") { showLogin(); throw new Error("请重新登入"); }
  if (!r.ok) throw new Error(j.error || "操作失败");
  return j;
}
function toast(msg, err) {
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3600);
}
const fmtDT = iso => iso ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Kuala_Lumpur", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "-";
function toLocalInput(iso) {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
const fromLocalInput = v => v ? new Date(v + ":00+08:00").toISOString() : null;
// 马来西亚「墙上时间」的加减（把 YYYY-MM-DDTHH:mm 当作 UTC 做算术，只用于快捷时间）
function wall(addMin, setHM) {
  const base = toLocalInput(new Date().toISOString());
  const [d, t] = base.split("T"); const [y, m, dd] = d.split("-").map(Number); let [h, mi] = t.split(":").map(Number);
  let ms = Date.UTC(y, m - 1, dd, h, mi);
  if (setHM) { let target = Date.UTC(y, m - 1, dd, setHM[0], setHM[1]); if (target <= ms) target += 86400000; ms = target; }
  else ms += addMin * 60000;
  const x = new Date(ms), p = n => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

function tomorrowAt(h, mi) { // 明天某时某分（马来西亚时间）
  const [d] = toLocalInput(new Date().toISOString()).split("T"); const [y, m, dd] = d.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd + 1, h, mi)), p = n => String(n).padStart(2, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

/* ---------- 访客只读：禁用输入、隐藏会修改数据的按钮（服务器端同样会拒绝写入） ---------- */
const RO_HIDE = /^[＋+]|保存|发送|排程|新建|新增|添加|删除|移除|上传|延长|复制|重设|更换|确认|测试|发给我|选择文件|从素材库选择|立即|草稿/;
function applyReadonly() {
  if (!ME || !ME.readonly) return;
  const main = $("#main"), mod = $("#modalRoot");
  [main, mod].forEach(root => {
    if (!root) return;
    root.querySelectorAll("input,select,textarea").forEach(el => { if (!el.disabled) el.disabled = true; });
    root.querySelectorAll("button,.btn,label.x-drop,.x-drop").forEach(el => {
      if (el.closest("#nav")) return;
      if (RO_HIDE.test(el.textContent || "") && !/^(关闭|取消|返回)$/.test((el.textContent || "").trim())) el.style.display = "none";
    });
  });
  if (main && !main.querySelector(".x-guest-note")) main.insertAdjacentHTML("afterbegin", '<div class="x-guest-note">访客模式：可以查看所有内容，但不能修改。</div>');
}
function startReadonly() {
  const mo = new MutationObserver(() => applyReadonly());
  ["#main", "#modalRoot"].forEach(sel => { const el = $(sel); if (el) mo.observe(el, { childList: true, subtree: true }); });
}

/* ---------- 登入 ---------- */
function showLogin() { $("#app").classList.add("hide"); $("#login").classList.remove("hide"); }
$("#lf").onsubmit = async e => {
  e.preventDefault();
  try { await api("login", { method: "POST", body: { username: $("#un") ? $("#un").value : "", password: $("#pw").value } }); $("#lerr").textContent = ""; $("#pw").value = ""; boot(); }
  catch (err) { $("#lerr").textContent = err.message; }
};
$("#logout").onclick = async () => { await api("logout", { method: "POST" }); showLogin(); };

async function boot() {
  const me = await fetch("/api/me", { credentials: "same-origin" }).then(r => r.json());
  if (!me.authed) return showLogin();
  ME = me; BRAND = me.brand;
  $("#wsN").textContent = BRAND; $("#wsL").textContent = BRAND[0] || "D";
  PAGES = ALL_PAGES.filter(p => ({ bot: me.can.bot, staff: me.can.users, log: me.can.log })[p[0]] ?? true);
  $("#login").classList.add("hide"); $("#app").classList.remove("hide");
  $("#nav").innerHTML = PAGES.map(([k, n, ic]) => `<a data-p="${k}">${ICON[ic]}${n}</a>`).join("");
  $("#nav").onclick = e => { const a = e.target.closest("a"); if (a) location.hash = a.dataset.p; };
  const foot = $(".foot");
  if (foot && !$("#who")) foot.insertAdjacentHTML("afterbegin", `<div id="who" class="x-who"></div>`);
  $("#who").innerHTML = `<b>${esc(me.user.displayName)}</b><span>${esc(me.user.roleLabel)}</span><button id="chgpw" type="button">修改密码</button>`;
  $("#chgpw").onclick = changePassword;
  document.body.classList.toggle("x-ro", !!me.readonly);
  if (me.readonly) { $("#chgpw").remove(); startReadonly(); }
  route();
}
window.onhashchange = () => { if (!$("#app").classList.contains("hide")) route(); };

function route() {
  let p = (location.hash || "#overview").slice(1);
  if (!PAGES.find(x => x[0] === p)) p = "overview";
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.p === p));
  const name = (PAGES.find(x => x[0] === p) || [])[1] || "工作总览";
  setTimeout(() => { const b = $("#breadcrumb"); if (b) b.textContent = name; document.title = name + " · MJH Desk"; }, 0);
  ({ overview: pOverview, schedule: pSchedule, media: pMedia, bot: pBot, staff: pStaff, log: pLog })[p]();
}
const head = (t, s, extra = "") => `<div class="top"><div><h1>${t}</h1><p class="lead">${s}</p></div>${extra}</div>`;
function openModal(html) { $("#modalRoot").innerHTML = html; const mk = $("#mk"); if (mk) mk.onclick = e => { if (e.target.id === "mk") closeModal(); }; }
const closeModal = () => { $("#modalRoot").innerHTML = ""; };
async function guarded(btn, fn) { // 防止重复点击
  if (btn.disabled) return; btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, 1); } finally { btn.disabled = false; }
}

function changePassword() {
  openModal(`<div class="mask" id="mk"><div class="modal x-narrow"><div class="l"><h3>修改密码</h3>
    <label>目前的密码</label><input type="password" id="pOld" autocomplete="current-password">
    <label>新密码（至少 8 个字符）</label><input type="password" id="pNew" autocomplete="new-password">
    <div style="display:flex;gap:10px;margin-top:22px"><button class="btn" id="pOk">保存</button><button class="btn ghost" id="pNo">取消</button></div></div></div></div>`);
  $("#pNo").onclick = closeModal;
  $("#pOk").onclick = e => guarded(e.target.closest("button"), async () => { await api("me/password", { method: "POST", body: { oldPassword: $("#pOld").value, newPassword: $("#pNew").value } }); toast("密码已更新"); closeModal(); });
}

/* ---------- 总览 ---------- */
let ovDays = 7, ovTab = "newUsers";
async function pOverview() {
  const main = $("#main");
  const d = await api("overview?days=" + ovDays);
  $("#botst").textContent = d.attention.botReady ? "● Bot 已连线" : "○ Bot 连线中";
  const c = d.cards, a = d.attention, isSuper = ME.can.bot;
  const att = [];
  if (!a.botReady) att.push(["!", "Bot 尚未连线", "请联系技术支持检查服务状态"]);
  if (a.noTargets) att.push(["!", "还没有设置发布位置", isSuper ? "到「机器人设置 › 发布位置」添加要发布的群组或频道" : "请联系超级管理员设置发布位置"]);
  if (!a.storageSet) att.push(["!", "素材上传尚未启用", "请联系技术支持完成设置"]);
  if (a.failed) att.push(["!", `${a.failed} 则公告发送失败`, a.lastError]);
  if (a.expiringMedia) att.push(["!", `${a.expiringMedia} 个素材即将到期`, "3 天内自动清理，需要保留请到素材库点「延长」"]);
  if (a.scheduled) att.push([a.scheduled, `${a.scheduled} 则公告等待发送`, "已确认定时，到点自动发出"]);
  if (a.drafts) att.push([a.drafts, `${a.drafts} 则草稿待确认`, "确认发送方式后才会发出"]);
  main.innerHTML = head("一切井然有序。", `欢迎回来，${esc(ME.user.displayName)}。这里是 ${esc(BRAND)} 的工作概览，数据来自 bot 实际记录。`,
    `<a class="btn" href="#schedule" onclick="setTimeout(()=>editAnn(),80)" style="text-decoration:none">＋ 新建公告</a>`) +
    `<div style="display:flex;justify-content:flex-end;margin-bottom:14px"><div class="seg" id="rng"><button data-d="7" class="${ovDays === 7 ? "on" : ""}">最近 7 天</button><button data-d="30" class="${ovDays === 30 ? "on" : ""}">最近 30 天</button></div></div>
    <div class="grid4">
      <div class="stat first"><p>新增用户</p><h2>${c.newUsers}</h2><small>期间首次启动 bot</small></div>
      <div class="stat"><p>绑定 Giftcode</p><h2>${c.binds}</h2><small>完成游戏ID绑定</small></div>
      <div class="stat"><p>签到人数</p><h2>${c.checkins}</h2><small>期间去重人数</small></div>
      <div class="stat"><p>Bot 互动人数</p><h2>${c.interact}</h2><small>期间去重人数</small></div>
    </div>
    <div class="two">
      <div class="card"><h3 style="margin:0">社群概况</h3><div class="tabs" id="ctabs">
        <a data-t="newUsers" class="${ovTab === "newUsers" ? "on" : ""}">新增用户</a><a data-t="checkins" class="${ovTab === "checkins" ? "on" : ""}">签到人数</a><a data-t="interact" class="${ovTab === "interact" ? "on" : ""}">互动人数</a></div>
        <div id="chart"></div></div>
      <div class="card"><h3 style="margin:0 0 8px">需要您关注 <span class="chip draft">${att.length}</span></h3>
        ${att.length ? att.map(x => `<div class="item"><div class="ic">${esc(x[0])}</div><div><b>${esc(x[1])}</b><small>${esc(x[2])}</small></div></div>`).join("") : '<div class="empty">目前没有待办事项</div>'}</div>
    </div>`;
  $("#rng").onclick = e => { const b = e.target.closest("button"); if (b) { ovDays = +b.dataset.d; pOverview(); } };
  $("#ctabs").onclick = e => { const b = e.target.closest("a"); if (b) { ovTab = b.dataset.t; drawChart(d); document.querySelectorAll("#ctabs a").forEach(x => x.classList.toggle("on", x === b)); } };
  drawChart(d);
}
function drawChart(d) {
  const v = d.series[ovTab], W = 720, H = 260, P = { l: 36, r: 16, t: 14, b: 30 };
  const max = Math.max(4, ...v), step = Math.ceil(max / 3), top = step * 3;
  const x = i => P.l + (v.length === 1 ? 0 : i * (W - P.l - P.r) / (v.length - 1));
  const y = n => H - P.b - n / top * (H - P.t - P.b);
  const pts = v.map((n, i) => [x(i), y(n)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = line + ` L${pts[pts.length - 1][0]} ${H - P.b} L${pts[0][0]} ${H - P.b} Z`;
  let g = "";
  for (let k = 0; k <= 3; k++) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(k * step)}" y2="${y(k * step)}" stroke="#e6e8de" stroke-dasharray="4 5"/><text x="${P.l - 8}" y="${y(k * step) + 4}" text-anchor="end" font-size="11" fill="#9aa08f">${k * step}</text>`;
  const every = Math.ceil(v.length / 8);
  const xl = d.labels.map((l, i) => i % every === 0 || i === v.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#9aa08f">${l.slice(5).replace("-", "/")}</text>` : "").join("");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%"><defs><linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9a2c" stop-opacity=".22"/><stop offset="1" stop-color="#7f9a2c" stop-opacity="0"/></linearGradient></defs>${g}${xl}<path d="${area}" fill="url(#gr)"/><path d="${line}" fill="none" stroke="#7f9a2c" stroke-width="2.5" stroke-linejoin="round"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#7f9a2c" stroke-width="2"><title>${d.labels[i]}：${v[i]}</title></circle>`).join("")}</svg>`;
}

/* ---------- 发文排程 ---------- */
let MEDIA = [], TARGETS = [], annFilter = "all";
async function loadRefs() {
  const [m, t] = await Promise.all([api("media"), api("targets")]);
  MEDIA = m.list; TARGETS = t.list; window.TTL = m.ttlDays;
}
async function pSchedule() {
  const r = await api("announcements"); await loadRefs();
  window.ANN = r.list;
  renderSchedule();
}
function renderSchedule() {
  const list = window.ANN, f = annFilter;
  const cnt = k => k === "all" ? list.length : list.filter(a => a.status === k).length;
  const shown = f === "all" ? list : list.filter(a => a.status === f);
  const tabs = [["all", "全部"], ["scheduled", "待发送"], ["draft", "草稿"], ["sent", "已发送"], ["failed", "发送失败"]];
  $("#main").innerHTML = head("发文排程", "写好内容、加上图片或视频，选择立即发送或定时发送。", `<button class="btn" onclick="editAnn()">＋ 新建公告</button>`) +
    `<div class="card"><div class="tabs" id="atabs">${tabs.map(([k, n]) => `<a data-f="${k}" class="${f === k ? "on" : ""}">${n}${cnt(k) ? ` <span class="x-n">${cnt(k)}</span>` : ""}</a>`).join("")}</div>` +
    (shown.length ? `<table><tr><th>内容</th><th>发布位置</th><th>计划时间（马来西亚）</th><th>素材</th><th>状态</th><th>编辑者</th></tr>${shown.map(a => `<tr class="click" onclick="editAnn('${a.id}')"><td><b>${esc(a.title || "（未命名）")}</b><br><small style="color:var(--mute)">${esc((a.text || "").replace(/\n/g, " ").slice(0, 36))}</small></td><td>${esc(a.targetName || "未选择")}</td><td>${fmtDT(a.at)}</td><td>${a.mediaId ? (a.mediaMissing ? '<span style="color:var(--danger)">素材已过期</span>' : esc((MEDIA.find(x => x.id === a.mediaId) || {}).name || "有素材")) : "纯文字"}</td><td><span class="chip ${a.status}">${STATUS[a.status]}</span>${a.error ? `<br><small style="color:var(--danger)">${esc(a.error)}</small>` : ""}</td><td>${esc(a.updatedBy || a.createdBy || "")}</td></tr>`).join("")}</table>` : `<div class="empty">${f === "all" ? "还没有公告，点右上角新建第一则" : "这个分类下还没有公告"}</div>`) + `</div>`;
  $("#atabs").onclick = e => { const a = e.target.closest("a"); if (a) { annFilter = a.dataset.f; renderSchedule(); } };
}

function editAnn(id, dupFrom) {
  const src = (window.ANN || []).find(x => x.id === (id || dupFrom));
  const E = {
    id: id || undefined, title: "", targetId: "", text: "", mediaId: "", mode: "schedule", at: wall(60), status: "draft", error: "", uploading: false,
  };
  if (src) {
    Object.assign(E, { title: dupFrom ? "" : src.title, targetId: src.targetId || "", text: src.text || "", mediaId: src.mediaMissing ? "" : (src.mediaId || ""), status: src.status, error: src.error || "" });
    if (!dupFrom) { E.mode = src.status === "draft" ? "draft" : "schedule"; if (src.at) E.at = toLocalInput(src.at); }
  }
  if (!E.targetId && TARGETS.length === 1) E.targetId = TARGETS[0].id;
  if (!E.targetId && src && src.target) E.legacyTarget = src.target;
  const locked = !dupFrom && src && src.status === "sent";
  const noTarget = !TARGETS.length && !E.legacyTarget;

  const mediaOf = () => MEDIA.find(x => x.id === E.mediaId);
  const body = () => `<div class="mask" id="mk"><div class="modal"><div class="l">
    <h3>${locked ? "查看公告" : id ? "编辑公告" : dupFrom ? "复制公告" : "新建公告"}</h3>
    ${locked ? `<p class="hint" style="margin:0 0 8px">已发送的公告不能再修改。想再发一次，点「复制」另建一则。</p>` : ""}
    ${E.error ? `<div class="x-alert">上次发送失败：${esc(E.error)}。修改后重新选择发送方式即可再试。</div>` : ""}
    <label>发布到哪里</label>
    ${noTarget ? `<div class="x-alert">还没有设置发布位置。${ME.can.bot ? "到「机器人设置 › 发布位置」添加群组或频道后再回来。" : "请联系超级管理员先设置发布位置。"}</div>` :
      `<select id="aG" ${locked ? "disabled" : ""}>${E.legacyTarget ? `<option value="">${esc(E.legacyTarget)}（旧版设置）</option>` : '<option value="">请选择…</option>'}${TARGETS.map(t => `<option value="${t.id}" ${t.id === E.targetId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`}
    <label>正文</label><textarea id="aX" ${locked ? "disabled" : ""} placeholder="写下想告诉会员的内容…">${esc(E.text)}</textarea>
    <div class="hint" id="aCnt"></div>
    <label>图片或视频（选填）</label><div id="mArea"></div>
    ${locked ? "" : `<label>怎么发送</label>
    <div class="x-modes" id="aModes">
      <button type="button" data-m="now" class="x-mode"><b>立即发送</b><small>马上发出</small></button>
      <button type="button" data-m="schedule" class="x-mode"><b>定时发送</b><small>到时间自动发</small></button>
      <button type="button" data-m="draft" class="x-mode"><b>存为草稿</b><small>先不发</small></button>
    </div>
    <div id="aWhen" class="x-when"><label>发送时间（马来西亚）</label><input type="datetime-local" id="aA" value="${E.at}">
      <div class="x-chips"><button type="button" data-q="h1">1 小时后</button><button type="button" data-q="n20">今晚 8:00</button><button type="button" data-q="m9">明早 9:00</button></div></div>
    <details class="x-more"><summary>内部备注标题（选填）</summary><input type="text" id="aT" value="${esc(E.title)}" placeholder="不填会自动用正文开头"></details>`}
    <div class="x-actions">
      ${locked ? "" : `<button class="btn" id="aGo"></button><button class="btn ghost" id="aTest">发给我自己看看</button>`}
      ${src ? `<button class="btn ghost" id="aDup">复制</button>` : ""}${id ? `<button class="btn danger" id="aDel">删除</button>` : ""}<button class="btn ghost" id="aClose" style="margin-left:auto">关闭</button></div></div>
    <div class="r"><div style="font-size:12px;letter-spacing:.15em;color:var(--mute)">TELEGRAM 预览</div><div class="tg"><div class="hd"><i>${esc((BRAND || "D")[0])}</i><div><b id="pvT">${esc(BRAND)}</b><br><small style="color:var(--mute)">预览</small></div></div><div class="bd"><div class="bub" id="pv"></div></div></div>
    <p class="hint">预览为示意，实际显示以 Telegram 为准。</p></div></div></div>`;

  openModal(body());
  const close = closeModal;
  $("#aClose").onclick = close;

  // 预览
  const pv = () => {
    const m = mediaOf(), t = $("#aX").value;
    const g = $("#aG"); const tn = g && g.selectedOptions[0] && g.value ? g.selectedOptions[0].textContent : BRAND;
    $("#pvT").textContent = tn;
    $("#pv").innerHTML = (m ? (m.type === "photo" ? `<img src="/api/media/${m.id}/file">` : `<div class="vid">视频：${esc(m.name)}</div>`) : "") + (t ? esc(t) : '<span style="color:#9aa">您的公告内容会出现在这里。</span>') + `<div class="tm">${(E.mode === "schedule" ? ($("#aA") ? $("#aA").value : E.at) : toLocalInput(new Date().toISOString())).slice(-5)} ✓✓</div>`;
    const n = t.length;
    $("#aCnt").textContent = m && n > 1024 ? `正文 ${n} 字：带图片/视频时超过 1024 字会拆成两条消息发出` : `${n} 字`;
  };
  // 素材区（上传后自动存入素材库）
  const drawMedia = () => {
    const m = mediaOf(), area = $("#mArea");
    if (E.uploading) { area.innerHTML = `<div class="x-drop busy"><span class="x-spin"></span>上传中，请稍候…</div>`; return; }
    if (m) {
      area.innerHTML = `<div class="x-mchip">${m.type === "photo" ? `<img src="/api/media/${m.id}/file">` : `<span class="x-vi">视频</span>`}<div><b>${esc(m.name)}</b><small>已存入素材库，保留 ${window.TTL || 30} 天</small></div>${locked ? "" : `<button type="button" class="btn ghost sm" id="mRm">移除</button>`}</div>`;
      if (!locked) $("#mRm").onclick = () => { E.mediaId = ""; drawMedia(); pv(); };
    } else if (!locked) {
      const usable = MEDIA.filter(x => true);
      area.innerHTML = `<label class="x-drop" for="mFile" id="mDrop"><b>＋ 点击选择，或把图片/视频拖到这里</b><small>图片最大 10MB，视频最大 50MB；上传后自动存入素材库</small></label><input type="file" id="mFile" accept="image/*,video/*" hidden>
        ${usable.length ? `<div class="x-lib">或 <select id="mLib"><option value="">从素材库选择…</option>${usable.map(x => `<option value="${x.id}">${x.type === "video" ? "视频" : "图片"}｜${esc(x.name)}</option>`).join("")}</select></div>` : ""}`;
      const up = async file => {
        if (!file) return;
        E.uploading = true; drawMedia();
        try {
          const fd = new FormData(); fd.append("file", file);
          const r = await api("media", { method: "POST", body: fd });
          MEDIA.unshift(r.item); E.mediaId = r.item.id;
        } catch (err) { toast(err.message, 1); }
        E.uploading = false; drawMedia(); pv();
      };
      $("#mFile").onchange = e => up(e.target.files[0]);
      const drop = $("#mDrop");
      ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
      ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
      drop.addEventListener("drop", e => up(e.dataTransfer.files[0]));
      const lib = $("#mLib"); if (lib) lib.onchange = () => { E.mediaId = lib.value; drawMedia(); pv(); };
    } else area.innerHTML = '<span class="hint">纯文字</span>';
  };
  // 发送方式
  const GO = { now: "立即发送", schedule: "确认定时发送", draft: "保存草稿" };
  const drawMode = () => {
    if (locked) return;
    document.querySelectorAll("#aModes .x-mode").forEach(b => b.classList.toggle("on", b.dataset.m === E.mode));
    $("#aWhen").classList.toggle("hide", E.mode !== "schedule");
    $("#aGo").textContent = GO[E.mode];
    pv();
  };
  drawMedia(); pv();
  ["aX"].forEach(k => $("#" + k).addEventListener("input", pv));
  const g = $("#aG"); if (g) g.addEventListener("change", () => { E.targetId = g.value; if (g.value) E.legacyTarget = ""; pv(); });
  if (locked) {
    $("#aDup") && ($("#aDup").onclick = () => editAnn(null, src.id));
  } else {
    $("#aModes").onclick = e => { const b = e.target.closest("[data-m]"); if (b) { E.mode = b.dataset.m; drawMode(); } };
    $("#aA").addEventListener("input", () => { E.at = $("#aA").value; pv(); });
    document.querySelector(".x-chips").onclick = e => {
      const q = e.target.dataset.q; if (!q) return;
      E.at = q === "h1" ? wall(60) : q === "n20" ? wall(0, [20, 0]) : tomorrowAt(9, 0);
      $("#aA").value = E.at; pv();
    };
    drawMode();
    $("#aGo").onclick = e => guarded(e.target.closest("button"), async () => {
      const text = $("#aX").value, targetId = $("#aG") ? $("#aG").value : "";
      if (E.mode !== "draft" && !targetId && !E.legacyTarget) throw new Error("请先选择要发布到哪里");
      if (!text.trim() && !E.mediaId) throw new Error("请填写正文，或添加一张图片/视频");
      const tn = $("#aG") && $("#aG").selectedOptions[0] ? $("#aG").selectedOptions[0].textContent : "";
      if (E.mode === "now" && !confirm(`确定现在就发送到「${tn || "所选位置"}」吗？发送后无法撤回。`)) return;
      const payload = { id: E.id, title: $("#aT") ? $("#aT").value : "", targetId, target: E.legacyTarget || "", text, mediaId: E.mediaId, status: E.mode === "draft" ? "draft" : "scheduled", at: E.mode === "schedule" ? fromLocalInput($("#aA").value) : null, sendNow: E.mode === "now" };
      await api("announcements", { method: "POST", body: payload });
      toast(E.mode === "now" ? "已提交，正在发送…" : E.mode === "schedule" ? "已确认，到时间会自动发送" : "草稿已保存");
      close(); pSchedule();
    });
    $("#aTest").onclick = e => guarded(e.target.closest("button"), async () => { await api("announcements/test", { method: "POST", body: { text: $("#aX").value, mediaId: E.mediaId } }); toast("已发到你自己的 Telegram，去看看效果"); });
  }
  if (src && $("#aDup") && !locked) $("#aDup").onclick = () => editAnn(null, src.id);
  if (id) $("#aDel").onclick = e => guarded(e.target.closest("button"), async () => { if (!confirm("确定删除这则公告？")) return; await api("announcements/" + id, { method: "DELETE" }); close(); pSchedule(); });
}

/* ---------- 素材库 ---------- */
async function pMedia() {
  const r = await api("media");
  MEDIA = r.list;
  $("#main").innerHTML = head("素材库", `图片和视频会自动存进这里，保留 ${r.ttlDays} 天后自动清理。被排程、草稿或机器人设置使用中的素材不会被清理。`, `<div><input type="file" id="up" accept="image/*,video/*" class="hide" multiple><button class="btn" id="upb">＋ 上传素材</button></div>`) +
    (r.list.length ? `<div class="media">${r.list.map(m => `<div class="mi"><div class="th">${m.type === "photo" ? `<img src="/api/media/${m.id}/file" loading="lazy">` : "视频"}</div><div class="in"><div class="nm">${esc(m.name)}</div><div style="color:var(--mute);margin:2px 0 6px">${m.type === "video" ? "视频" : "图片"} · ${(m.size / 1048576).toFixed(1)}MB${m.uploadedBy ? " · " + esc(m.uploadedBy) : ""}</div>
      ${m.inUse ? `<div class="x-badge ok" title="${esc(m.inUseReason)}">${esc(m.inUseReason)}</div>` : `<div class="x-badge ${m.daysLeft <= 3 ? "warn" : ""}">剩余 ${m.daysLeft} 天</div>`}
      <div class="x-btns">${m.inUse ? "" : `<button class="btn ghost sm" onclick="extendMedia('${m.id}')">延长 ${r.ttlDays} 天</button>`}<button class="btn danger sm" onclick="delMedia('${m.id}')">删除</button></div></div></div>`).join("")}</div>` : '<div class="card empty">素材库是空的。上传图片或视频，或在新建公告时直接添加，都会自动存到这里。</div>');
  $("#upb").onclick = () => $("#up").click();
  $("#up").onchange = async e => {
    for (const f of e.target.files) {
      toast("上传中：" + f.name);
      const fd = new FormData(); fd.append("file", f);
      try { await api("media", { method: "POST", body: fd }); toast("已完成：" + f.name); } catch (err) { toast(f.name + "：" + err.message, 1); }
    }
    pMedia();
  };
}
async function delMedia(id) { if (!confirm("确定删除这个素材？")) return; try { await api("media/" + id, { method: "DELETE" }); pMedia(); } catch (e) { toast(e.message, 1); } }
async function extendMedia(id) { try { await api("media/" + id + "/extend", { method: "POST" }); toast("已延长"); pMedia(); } catch (e) { toast(e.message, 1); } }

/* ---------- 机器人设置（超级管理员） ---------- */
let CFG, PHOTOS = [], botTab = "profile", TG = [];
async function pBot() {
  const [c, p, t] = await Promise.all([api("config"), api("media-ids"), api("targets")]);
  CFG = c; PHOTOS = p.list; TG = t.list.filter(x => x.id !== "__default").map(x => ({ ...x }));
  renderBot();
}
function photoSel(id, val) {
  return `<select id="${id}"><option value="">不放图片</option>${PHOTOS.map(p => `<option value="${esc(p.fileId)}" ${p.fileId === val ? "selected" : ""}>${esc(p.name)}</option>`).join("")}${val && !PHOTOS.find(p => p.fileId === val) ? `<option value="${esc(val)}" selected>（沿用现有图片）</option>` : ""}</select>`;
}
function renderBot() {
  const tabs = [["profile", "机器人资料"], ["menu", "菜单按钮"], ["welcome", "欢迎页"], ["faq", "常见问题"], ["activity", "限时活动"], ["targets", "发布位置"]];
  $("#main").innerHTML = head("机器人设置", "这里的每一项修改，保存后 bot 立即生效，不需要重新部署。") +
    `<div class="card"><div class="tabs" id="bt">${tabs.map(([k, n]) => `<a data-t="${k}" class="${botTab === k ? "on" : ""}">${n}</a>`).join("")}</div><div id="bp"></div></div>`;
  $("#bt").onclick = e => { const a = e.target.closest("a"); if (a) { botTab = a.dataset.t; renderBot(); } };
  ({ profile: tabProfile, menu: tabMenu, welcome: tabWelcome, faq: tabFaq, activity: tabActivity, targets: tabTargets })[botTab]();
}
const saveBtn = fn => { $("#sv").onclick = e => guarded(e.target.closest("button"), async () => { await fn(); toast("已保存，bot 已同步"); }); };


/* ---------- 机器人资料（直接同步到 Telegram） ---------- */
async function tabProfile() {
  $("#bp").innerHTML = '<div class="empty">正在读取 Telegram 上的机器人资料…</div>';
  let P;
  try { P = await api("bot-profile"); } catch (e) { $("#bp").innerHTML = `<div class="x-alert">${esc(e.message)}</div>`; return; }
  const cmds = P.commands.map(c => ({ ...c }));
  const draw = () => {
    $("#bp").innerHTML = `<p class="hint" style="margin-top:0">这里改的就是用户在 Telegram 里看到的机器人资料。保存后直接同步，不需要再去 BotFather。</p>
    ${P.readOk ? "" : '<div class="x-alert">暂时读不到 Telegram 上现有的资料，保存会用这里填的内容覆盖。</div>'}
    <div class="x-prof"><div>
      <label style="margin-top:0">头像</label>
      <div class="x-avrow"><div class="x-av" id="avBox"><img id="avImg" src="/api/bot-profile/avatar?ts=${Date.now()}" alt="" onerror="this.remove()"><span>${esc((P.name || "B")[0])}</span></div>
        <div><button class="btn ghost sm" id="avUp" type="button">更换头像</button> <button class="btn ghost sm" id="avRm" type="button">移除</button><input type="file" id="avFile" accept="image/*" hidden><div class="hint">建议正方形 JPG，至少 512×512，5MB 以内。更换后几秒内生效。</div></div></div>
      <label>名称 <small class="x-cnt" id="cN"></small></label><input type="text" id="pN" maxlength="64" value="${esc(P.name)}">
      <div class="hint">用户在聊天列表和资料页看到的名字。Telegram 对改名有频率限制，不要频繁修改。</div>
      <label>简介 <small class="x-cnt" id="cS"></small></label><textarea id="pS" maxlength="120" style="min-height:70px">${esc(P.shortDescription)}</textarea>
      <div class="hint">显示在机器人的资料页，别人分享这个机器人时也会带上。最多 120 字。</div>
      <label>说明 <small class="x-cnt" id="cD"></small></label><textarea id="pD" maxlength="512" style="min-height:130px">${esc(P.description)}</textarea>
      <div class="hint">用户第一次打开对话、还没点开始之前看到的介绍，适合写这个机器人能帮他们做什么。最多 512 字。</div>
      <label>命令菜单</label>
      ${cmds.map((c, i) => `<div class="x-crow"><span>/</span><input type="text" data-i="${i}" data-f="command" value="${esc(c.command)}" placeholder="start" maxlength="32"><input type="text" data-i="${i}" data-f="description" value="${esc(c.description)}" placeholder="命令说明，例如：开始使用"><button class="btn danger sm" data-del="${i}" type="button">删除</button></div>`).join("")}
      <div class="x-chips"><button type="button" data-add="start|开始使用">＋ /start 开始使用</button><button type="button" data-add="menu|打开主菜单">＋ /menu 打开主菜单</button><button type="button" data-add="|">＋ 自定义命令</button></div>
      <div class="hint">显示在聊天输入框旁的「菜单」按钮里。命令只能用英文小写、数字和下划线。${P.username ? `<br>机器人的 @用户名（@${esc(P.username)}）无法在后台修改，这是 Telegram 的限制。` : ""}</div>
      <div class="x-actions"><button class="btn" id="sv" type="button">保存并同步到 Telegram</button></div>
      <div id="pRes" class="x-res"></div>
    </div>
    <div><div style="font-size:12px;letter-spacing:.15em;color:var(--mute)">用户看到的效果</div>
      <div class="x-pv"><div class="x-pv1"><div class="x-av sm"><img src="/api/bot-profile/avatar?ts=${Date.now()}" alt="" onerror="this.remove()"><span id="pvL">B</span></div><b id="pvN"></b><small>@${esc(P.username || "bot")}</small><p id="pvS"></p></div>
      <div class="x-pv2"><div class="x-av"><img src="/api/bot-profile/avatar?ts=${Date.now()}" alt="" onerror="this.remove()"><span id="pvL2">B</span></div><b>这个机器人能做什么？</b><p id="pvD"></p><div class="x-start">开始</div></div></div></div></div>`;
    const upd = () => {
      const n = $("#pN").value, s = $("#pS").value, d = $("#pD").value;
      $("#cN").textContent = `${n.length}/64`; $("#cS").textContent = `${s.length}/120`; $("#cD").textContent = `${d.length}/512`;
      $("#pvN").textContent = n || "（未命名）"; $("#pvS").textContent = s || "（暂无简介）"; $("#pvD").textContent = d || "（暂无说明）";
      $("#pvL").textContent = $("#pvL2").textContent = (n || "B")[0]; $("#avBox span").textContent = (n || "B")[0];
    };
    $("#bp").oninput = e => { const i = e.target.dataset.i; if (i != null) cmds[i][e.target.dataset.f] = e.target.value; upd(); };
    $("#bp").onclick = e => {
      const del = e.target.dataset.del, add = e.target.dataset.add;
      if (del != null) { cmds.splice(+del, 1); keep(); }
      if (add != null) { const [c, d] = add.split("|"); if (c && cmds.some(x => x.command === c)) return toast("已经有 /" + c + " 了", 1); cmds.push({ command: c, description: d }); keep(); }
    };
    const keep = () => { P.name = $("#pN").value; P.shortDescription = $("#pS").value; P.description = $("#pD").value; draw(); };
    $("#avUp").onclick = () => $("#avFile").click();
    $("#avFile").onchange = e => guarded($("#avUp"), async () => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append("file", f);
      await api("bot-profile/avatar", { method: "POST", body: fd }); toast("头像已更换，几秒后生效"); setTimeout(keep, 1500);
    });
    $("#avRm").onclick = () => guarded($("#avRm"), async () => { if (!confirm("确定移除机器人头像？")) return; await api("bot-profile/avatar", { method: "DELETE" }); toast("头像已移除"); setTimeout(keep, 1200); });
    $("#sv").onclick = e => guarded(e.target.closest("button"), async () => {
      const r = await api("bot-profile", { method: "PUT", body: { name: $("#pN").value, shortDescription: $("#pS").value, description: $("#pD").value, commands: cmds } });
      const L = { name: "名称", shortDescription: "简介", description: "说明", commands: "命令菜单" };
      const bad = Object.entries(r.results).filter(([, v]) => !v.ok), done = Object.entries(r.results).filter(([, v]) => v.ok && !v.skipped);
      const box = $("#pRes");
      box.className = "x-res " + (bad.length ? "bad" : "ok");
      box.innerHTML = [...done.map(([k]) => `✓ ${L[k]}已同步到 Telegram`), ...bad.map(([k, v]) => `✗ ${L[k]}没有成功：${esc(v.error)}`)].join("<br>") || "没有任何修改";
      toast(bad.length ? "部分内容没有成功，请看下方说明" : done.length ? "已同步到 Telegram" : "没有任何修改", !!bad.length);
    });
    upd();
  };
  draw();
}

function tabMenu() {
  const rows = CFG.menu;
  const kbPreview = () => rows.map(r => `<div>${r.map(b => `<span class="${b.enabled === false ? "off" : ""}">${esc(b.label || "（未命名）")}</span>`).join("")}</div>`).join("");
  $("#bp").innerHTML = `<div style="display:grid;grid-template-columns:1fr 340px;gap:24px" class="mgrid"><div id="mrows">${rows.map((r, ri) => `
    <div class="row"><div class="rowctl"><button onclick="mvRow(${ri},-1)">↑</button><button onclick="mvRow(${ri},1)">↓</button><button onclick="rmRow(${ri})">×</button></div><div>
    ${r.map((b, bi) => btnCard(b, ri, bi)).join("")}${r.length < 3 ? `<button class="btn ghost sm" onclick="addBtn(${ri})">＋ 同一行加按钮</button>` : ""}</div></div>`).join("")}
    <button class="btn ghost" onclick="addRow()">＋ 新增一行</button> <button class="btn" id="sv" style="margin-left:8px">保存并同步</button></div>
    <div><div style="font-size:12px;letter-spacing:.15em;color:var(--mute)">主菜单预览</div><div class="tg"><div class="bd" style="min-height:0"><div class="bub">欢迎加入 ${esc(CFG.brand)}…</div><div class="kb" id="kbp">${kbPreview()}</div></div></div></div></div>`;
  $("#mrows").addEventListener("input", syncMenu);
  $("#mrows").addEventListener("change", e => { syncMenu(); if (e.target.dataset.rr) tabMenu(); });
  saveBtn(async () => { syncMenu(); await api("menu", { method: "PUT", body: { menu: CFG.menu } }); });
}
function btnCard(b, ri, bi) {
  const k = `${ri}-${bi}`;
  return `<div class="bcard" data-k="${k}"><div class="g"><input type="text" data-f="label" value="${esc(b.label)}" placeholder="按钮文字">
  <select data-f="type" data-rr="1"><option value="builtin" ${b.type === "builtin" ? "selected" : ""}>内置功能</option><option value="text" ${b.type === "text" ? "selected" : ""}>文字内容页</option><option value="link" ${b.type === "link" ? "selected" : ""}>外部链接</option></select></div>
  ${b.type === "builtin" ? `<select data-f="action" style="margin-top:10px">${Object.entries(BUILTIN).map(([v, n]) => `<option value="${v}" ${b.action === v ? "selected" : ""}>${n}</option>`).join("")}</select>` : ""}
  ${b.type === "text" ? `<textarea data-f="content" style="margin-top:10px;min-height:90px" placeholder="点击按钮后显示的内容">${esc(b.content || "")}</textarea><div style="margin-top:8px">${photoSel("img" + k, b.imageId || "").replace("<select", '<select data-f="imageId"')}</div>` : ""}
  ${b.type === "link" ? `<input type="text" data-f="url" style="margin-top:10px" value="${esc(b.url || "")}" placeholder="https://…">` : ""}
  <div style="display:flex;justify-content:space-between;margin-top:10px"><label style="margin:0;font-weight:500"><input type="checkbox" data-f="enabled" ${b.enabled !== false ? "checked" : ""}> 显示此按钮</label><button class="btn danger sm" onclick="rmBtn(${ri},${bi})">删除按钮</button></div></div>`;
}
function syncMenu() {
  document.querySelectorAll(".bcard").forEach(card => {
    const [ri, bi] = card.dataset.k.split("-").map(Number), b = CFG.menu[ri] && CFG.menu[ri][bi]; if (!b) return;
    card.querySelectorAll("[data-f]").forEach(el => { b[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; });
    if (b.type === "builtin" && !b.action) b.action = "checkin";
  });
  const kb = $("#kbp"); if (kb) kb.innerHTML = CFG.menu.map(r => `<div>${r.map(b => `<span class="${b.enabled === false ? "off" : ""}">${esc(b.label || "（未命名）")}</span>`).join("")}</div>`).join("");
}
const nid = () => Math.random().toString(36).slice(2, 10);
function mvRow(i, d) { syncMenu(); const j = i + d; if (j < 0 || j >= CFG.menu.length) return; [CFG.menu[i], CFG.menu[j]] = [CFG.menu[j], CFG.menu[i]]; tabMenu(); }
function rmRow(i) { if (confirm("删除这一整行按钮？")) { syncMenu(); CFG.menu.splice(i, 1); tabMenu(); } }
function rmBtn(ri, bi) { syncMenu(); CFG.menu[ri].splice(bi, 1); if (!CFG.menu[ri].length) CFG.menu.splice(ri, 1); tabMenu(); }
function addBtn(ri) { syncMenu(); CFG.menu[ri].push({ id: nid(), label: "新按钮", type: "text", content: "", enabled: true }); tabMenu(); }
function addRow() { syncMenu(); CFG.menu.push([{ id: nid(), label: "新按钮", type: "text", content: "在这里写点击后显示的内容", enabled: true }]); tabMenu(); }

function tabWelcome() {
  $("#bp").innerHTML = `<label style="margin-top:0">欢迎页图片</label>${photoSel("wI", CFG.welcome.imageId)}<p class="hint">图片来自素材库。没有选择则只发文字。</p>
  <label>欢迎文字</label><textarea id="wC" style="min-height:200px">${esc(CFG.welcome.caption)}</textarea><p class="hint">可用 {brand} 代表品牌名，{count} 代表今日签到人数。</p>
  <button class="btn" id="sv" style="margin-top:14px">保存并同步</button>`;
  saveBtn(() => api("welcome", { method: "PUT", body: { imageId: $("#wI").value, caption: $("#wC").value } }));
}
function tabFaq() {
  const draw = () => {
    $("#bp").innerHTML = `${CFG.faq.map((f, i) => `<div class="bcard"><input type="text" data-i="${i}" data-f="title" value="${esc(f.title)}" placeholder="问题标题（会显示在按钮上）"><textarea data-i="${i}" data-f="text" style="margin-top:10px;min-height:90px">${esc(f.text)}</textarea><div style="text-align:right;margin-top:8px"><button class="btn danger sm" onclick="rmFaq(${i})">删除</button></div></div>`).join("")}
    <button class="btn ghost" onclick="addFaq()">＋ 新增问题</button> <button class="btn" id="sv" style="margin-left:8px">保存并同步</button>`;
    $("#bp").oninput = e => { const i = e.target.dataset.i; if (i != null) CFG.faq[i][e.target.dataset.f] = e.target.value; };
    saveBtn(() => api("faq", { method: "PUT", body: { faq: CFG.faq } }));
  };
  window.rmFaq = i => { CFG.faq.splice(i, 1); draw(); };
  window.addFaq = () => { CFG.faq.push({ id: nid(), title: "新问题", text: "" }); draw(); };
  draw();
}
function tabActivity() {
  const a = CFG.activity;
  $("#bp").innerHTML = `<label style="margin-top:0"><input type="checkbox" id="aE" ${a.enabled ? "checked" : ""}> 启用活动页</label>
  <label>活动标题</label><input type="text" id="aTi" value="${esc(a.title)}">
  <label>活动内容</label><textarea id="aBo">${esc(a.body)}</textarea>
  <label>活动图片</label>${photoSel("aIm", a.imageId)}
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px"><div><label>结束时间（马来西亚）</label><input type="datetime-local" id="aEn" value="${toLocalInput(a.endAt)}"></div><div><label>目标金额 RM</label><input type="number" id="aGo" value="${a.goal}"></div><div><label>大奖名称</label><input type="text" id="aPr" value="${esc(a.prize)}"></div></div>
  <button class="btn" id="sv" style="margin-top:18px">保存并同步</button>`;
  saveBtn(() => api("activity", { method: "PUT", body: { activity: { enabled: $("#aE").checked, title: $("#aTi").value, body: $("#aBo").value, imageId: $("#aIm").value, endAt: fromLocalInput($("#aEn").value), goal: +$("#aGo").value, prize: $("#aPr").value } } }));
}
function tabTargets() {
  const draw = () => {
    $("#bp").innerHTML = `<p class="hint" style="margin-top:0">这里设置公告可以发到哪些群组或频道。设置好之后，发文时只需要在下拉选单里选名字，不用再记 ID。</p>
    <div class="x-steps"><b>怎么设置：</b>1. 把 bot 拉进群组或频道，并设为管理员（频道要开「发布消息」权限）　2. 填一个好认的名称　3. 填 @频道用户名，或 -100 开头的数字 ID　4. 点「测试连接」确认可以发布</div>
    ${TG.map((t, i) => `<div class="bcard x-trow"><input type="text" data-i="${i}" data-f="name" value="${esc(t.name)}" placeholder="名称，例如：VIP 福利群"><input type="text" data-i="${i}" data-f="chatId" value="${esc(t.chatId)}" placeholder="@频道用户名 或 -100…"><button class="btn ghost sm" data-chk="${i}">测试连接</button><button class="btn danger sm" data-del="${i}">删除</button><div class="x-res" id="res${i}"></div></div>`).join("")}
    <button class="btn ghost" id="addT">＋ 新增发布位置</button> <button class="btn" id="sv" style="margin-left:8px">保存并同步</button>`;
    $("#bp").oninput = e => { const i = e.target.dataset.i; if (i != null) TG[i][e.target.dataset.f] = e.target.value; };
    $("#bp").onclick = async e => {
      const del = e.target.dataset.del, chk = e.target.dataset.chk;
      if (del != null) { TG.splice(+del, 1); draw(); }
      if (chk != null) {
        const res = $("#res" + chk); res.className = "x-res"; res.textContent = "连接中…";
        try { const r = await api("targets/check", { method: "POST", body: { chatId: TG[chk].chatId } }); res.className = "x-res " + (r.canPost ? "ok" : "warn"); res.textContent = `${r.title}：${r.message}`; }
        catch (err) { res.className = "x-res bad"; res.textContent = err.message; }
      }
    };
    $("#addT").onclick = () => { TG.push({ id: "", name: "", chatId: "" }); draw(); };
    saveBtn(async () => { await api("targets", { method: "PUT", body: { targets: TG } }); const t = await api("targets"); TG = t.list.filter(x => x.id !== "__default").map(x => ({ ...x })); draw(); });
  };
  draw();
}

/* ---------- 员工与权限（超级管理员） ---------- */
async function pStaff() {
  const r = await api("users");
  window.USERS = r.list;
  $("#main").innerHTML = head("员工与权限", "为你的团队开设账号。每个人用自己的账号登入，操作记录会留下是谁做的。", `<button class="btn" onclick="editUser()">＋ 新增员工</button>`) +
    `<div class="x-roles"><div><b>超级管理员</b><small>${ROLE_DESC.super_admin}</small></div><div><b>管理员</b><small>${ROLE_DESC.admin}</small></div><div><b>访客（只读）</b><small>${ROLE_DESC.guest}</small></div></div>` +
    `<div class="card"><table><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th>最近登入</th><th></th></tr>${r.list.map(u => `<tr><td><b>${esc(u.displayName)}</b>${u.isSelf ? ' <span class="chip draft">我</span>' : ""}${u.system ? ' <span class="chip draft">系统账号</span>' : ""}</td><td>${esc(u.username)}</td><td>${esc(u.roleLabel)}</td><td><span class="chip ${u.active ? "sent" : "failed"}">${u.active ? "启用中" : "已停用"}</span></td><td>${fmtDT(u.lastLoginAt)}</td><td style="text-align:right">${u.system ? '<small style="color:var(--mute)">由技术支持管理</small>' : `<button class="btn ghost sm" onclick="editUser('${u.id}')">编辑</button>`}</td></tr>`).join("")}</table></div>`;
}
function editUser(id) {
  const u = (window.USERS || []).find(x => x.id === id) || { role: "admin", active: true, displayName: "", username: "" };
  openModal(`<div class="mask" id="mk"><div class="modal x-narrow"><div class="l"><h3>${id ? "编辑员工" : "新增员工"}</h3>
    <label>姓名</label><input type="text" id="uN" value="${esc(u.displayName)}" placeholder="例如：Amy">
    <label>登入账号</label><input type="text" id="uU" value="${esc(u.username)}" ${id ? "disabled" : ""} placeholder="英文小写或数字，例如 amy" autocapitalize="off">
    <label>角色</label><select id="uR"><option value="admin" ${u.role === "admin" ? "selected" : ""}>管理员</option><option value="super_admin" ${u.role === "super_admin" ? "selected" : ""}>超级管理员</option><option value="guest" ${u.role === "guest" ? "selected" : ""}>访客（只读）</option></select>
    <div class="hint" id="uRD"></div>
    <label>${id ? "重设密码（不改就留空）" : "登入密码（至少 8 个字符）"}</label><input type="password" id="uP" autocomplete="new-password">
    ${id ? `<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="uA" ${u.active ? "checked" : ""}> 账号启用中（取消勾选即停用，对方立刻被登出）</label>` : ""}
    <div class="x-actions"><button class="btn" id="uOk">保存</button>${id && !u.isSelf ? `<button class="btn danger" id="uDel">删除账号</button>` : ""}<button class="btn ghost" id="uNo" style="margin-left:auto">取消</button></div></div></div></div>`);
  const rd = () => $("#uRD").textContent = ROLE_DESC[$("#uR").value]; $("#uR").onchange = rd; rd();
  $("#uNo").onclick = closeModal;
  $("#uOk").onclick = e => guarded(e.target.closest("button"), async () => {
    if (id) { const b = { displayName: $("#uN").value, role: $("#uR").value, active: $("#uA").checked }; if ($("#uP").value) b.password = $("#uP").value; await api("users/" + id, { method: "PUT", body: b }); }
    else await api("users", { method: "POST", body: { displayName: $("#uN").value, username: $("#uU").value, role: $("#uR").value, password: $("#uP").value } });
    toast("已保存"); closeModal(); pStaff();
  });
  if ($("#uDel")) $("#uDel").onclick = e => guarded(e.target.closest("button"), async () => { if (!confirm("确定删除这个账号？")) return; await api("users/" + id, { method: "DELETE" }); closeModal(); pStaff(); });
}

/* ---------- 操作记录 ---------- */
async function pLog() {
  const r = await api("log");
  $("#main").innerHTML = head("操作记录", "后台上的每一次修改都会留下记录。") + `<div class="card">${r.list.length ? `<table><tr><th>时间</th><th>操作人</th><th>操作</th><th>内容</th></tr>${r.list.map(l => `<tr><td>${fmtDT(l.t)}</td><td>${esc(l.by || "系统")}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.detail)}</td></tr>`).join("")}</table>` : '<div class="empty">还没有记录</div>'}</div>`;
}

boot();
