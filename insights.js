// 数据统计：每帖点击、最佳发布时间、群人数变化、每周报告文字
const DAY = 86400000;
const MYT = 8 * 3600000;
const mytParts = (ms) => { const d = new Date(ms + MYT); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), wd: d.getUTCDay() }; };
const p2 = (n) => String(n).padStart(2, "0");
const mdLabel = (ms) => { const p = mytParts(ms); return `${p2(p.m)}/${p2(p.d)}`; };

function postStats(D, a) {
  const buttons = (a.buttons || []).map((b, i) => ({ label: b.label, url: b.url, clicks: 0, unique: 0, _h: new Set() }));
  const hourly = new Array(24).fill(0);
  const sentMs = a.sentAt ? new Date(a.sentAt).getTime() : 0;
  const all = new Set();
  let total = 0;
  for (const c of D.clicks || []) {
    if (c.a !== a.id) continue;
    total++; all.add(c.h);
    const b = buttons[c.b];
    if (b) { b.clicks++; b._h.add(c.h); }
    if (sentMs) { const k = Math.floor((c.t - sentMs) / 3600000); if (k >= 0 && k < 24) hourly[k]++; }
  }
  buttons.forEach((b) => { b.unique = b._h.size; delete b._h; });
  const members = a.membersAtSend || 0;
  return {
    clicks: total, unique: all.size, members,
    ctr: members ? Math.round((all.size / members) * 1000) / 10 : null,
    buttons, hourly,
    tracked: !!(a.sent && a.sent.tracked),
  };
}

// 最佳发布时间：按「发出时的整点」统计每则带按钮的帖子平均带来多少人点击
function bestTimes(D) {
  const posts = D.announcements.filter((a) => a.status === "sent" && a.sentAt && a.sent && a.sent.tracked && (a.buttons || []).length);
  const rows = posts.map((a) => ({ h: mytParts(new Date(a.sentAt).getTime()).h, u: postStats(D, a).unique }));
  const totalUnique = rows.reduce((s, r) => s + r.u, 0);
  const enough = rows.length >= 5 && totalUnique >= 20;
  const by = {};
  rows.forEach((r) => { (by[r.h] = by[r.h] || { h: r.h, posts: 0, unique: 0 }); by[r.h].posts++; by[r.h].unique += r.u; });
  const slots = Object.values(by).filter((x) => x.posts >= 2).map((x) => ({ hour: x.h, label: `${p2(x.h)}:00 到 ${p2((x.h + 1) % 24)}:00`, posts: x.posts, avgUnique: Math.round((x.unique / x.posts) * 10) / 10 })).sort((a, b) => b.avgUnique - a.avgUnique).slice(0, 3);
  return { enough: enough && slots.length > 0, posts: rows.length, totalUnique, needMore: Math.max(0, 5 - rows.length), slots };
}

// 群人数：每个发布位置最新人数、7 天变化、近 14 天走势
function memberSummary(D, targets) {
  const snaps = D.memberStats || [];
  return targets.map((t) => {
    const mine = snaps.filter((s) => String(s.c) === String(t.chatId)).sort((a, b) => a.t - b.t);
    const last = mine[mine.length - 1];
    const weekAgo = mine.filter((s) => s.t <= Date.now() - 7 * DAY).pop() || mine[0];
    const perDay = {};
    mine.forEach((s) => { perDay[mdLabel(s.t)] = s.n; });
    return { id: t.id, name: t.name, count: last ? last.n : null, at: last ? last.t : null, delta7: last && weekAgo ? last.n - weekAgo.n : null, series: Object.entries(perDay).slice(-14).map(([d, n]) => ({ d, n })) };
  });
}

function buildWeeklyReport(D, targets, days = 7) {
  const since = Date.now() - days * DAY;
  const ev = D.events.filter((e) => e.t >= since);
  const uniq = (type) => new Set(ev.filter((e) => e.type === type).map((e) => e.u)).size;
  const sent = D.announcements.filter((a) => a.status === "sent" && a.sentAt && new Date(a.sentAt).getTime() >= since);
  const stats = sent.map((a) => ({ a, s: postStats(D, a) }));
  const clicks = stats.reduce((n, x) => n + x.s.clicks, 0);
  const top = stats.slice().sort((x, y) => y.s.unique - x.s.unique)[0];
  const lines = [`${D.brand} 每周报告（${mdLabel(since)} 到 ${mdLabel(Date.now())}）`, ""];
  lines.push(`新增用户 ${ev.filter((e) => e.type === "start").length}，绑定 Giftcode ${ev.filter((e) => e.type === "bind").length}，签到 ${uniq("checkin")} 人，互动 ${uniq("interact")} 人`);
  lines.push(`发布帖子 ${sent.length} 则，按钮点击 ${clicks} 次`);
  if (top && top.s.unique > 0) lines.push(`表现最好的帖子：「${top.a.title || "未命名"}」，约 ${top.s.unique} 人点击`);
  memberSummary(D, targets).filter((m) => m.count != null).forEach((m) => lines.push(`${m.name}：${m.count.toLocaleString("en-US")} 人${m.delta7 != null ? `（近 7 天 ${m.delta7 >= 0 ? "+" : ""}${m.delta7}）` : ""}`));
  const bt = bestTimes(D);
  if (bt.enough) lines.push(`最佳发布时间：${bt.slots[0].label}`);
  return lines.join("\n");
}

module.exports = { postStats, bestTimes, memberSummary, buildWeeklyReport, mytParts };
