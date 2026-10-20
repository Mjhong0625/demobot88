# DemoBet88 管理后台 API 规格（给前端用）

后端已完成，前端只需要做界面并调用下面的接口。后端会把 `public/` 文件夹当静态网站提供，所以前端交付 `public/index.html`（可附带 css/js/图片文件）即可，不要改 `bot.js`、`admin.js`、`store.js`。

## 通用规则
- 所有接口前缀 `/api/`，请求与回应都是 JSON（上传素材除外）。
- 认证：账号 + 密码登入，浏览器自动带 HttpOnly cookie。除了 `/api/login`、`/api/me`，其他接口未登入回 `401`，没有权限回 `403 {"error":"你的账号没有权限执行此操作"}`，前端把 `error` 显示给用户即可。
- 时间：后端存 ISO（UTC），界面一律显示马来西亚时间（UTC+8）。
- 每个品牌是一个独立部署（一个 bot 一个后台），品牌内有两种角色：
  - `super_admin` 超级管理员：全部功能，包括员工账号、机器人设置、发布位置、操作记录
  - `admin` 管理员：总览、发文排程、素材库（不能改机器人设置、员工、发布位置，看不到操作记录）
  - `guest` 访客（只读）：可以看总览、发文排程、素材库、机器人设置、操作记录（看不到员工页），但所有写入请求一律回 `403 {"error":"访客账号只能查看，不能修改"}`。`/api/me` 会带 `readonly:true`，前端据此禁用输入并隐藏编辑按钮。用途：给潜在客户或同事看后台
- 系统账号 `owner`（`system:true`）：密码由服务器变量 `ADMIN_PASSWORD` 控制，不能被停用、删除或在后台改密码，是技术支持的恢复入口。

## 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | body `{username, password}`，username 留空等于 `owner`；错 401，停用 403，错太多次 429 |
| POST | `/api/logout` | |
| GET | `/api/me` | `{authed, brand, user:{id,username,displayName,role,roleLabel}, can:{bot,users,log,targetsEdit}, mediaTtlDays}`，前端用 `can` 决定显示哪些页面 |
| POST | `/api/me/password` | body `{oldPassword,newPassword}`（至少 8 位），owner 不可用 |

## 员工账号（仅超级管理员）
- `GET /api/users` → `{list:[{id,username,displayName,role,roleLabel,active,system,isSelf,createdAt,lastLoginAt}]}`
- `POST /api/users` body `{username(3-24位小写英数._-), displayName, role:"admin"|"super_admin", password(>=8)}`
- `PUT /api/users/:id` body 任意组合 `{displayName, role, active, password}`；password 留空不改。规则：不能停用/降级自己；至少保留一位启用中的超级管理员；系统账号不可改。停用或重设密码会立即踢下线。
- `DELETE /api/users/:id`：不能删自己和系统账号。

## 总览
`GET /api/overview?days=7|30`
```json
{
  "days": 7,
  "labels": ["2026-10-11", "..."],
  "cards": { "newUsers": 0, "binds": 0, "checkins": 0, "interact": 0 },
  "series": { "newUsers": [0,...], "checkins": [0,...], "interact": [0,...] },
  "attention": { "scheduled": 0, "drafts": 0, "failed": 0, "lastError": "", "botReady": true, "storageSet": true }
}
```
- `cards`：新增用户、绑定Giftcode、签到人数（去重）、互动人数（去重）。
- `series`：与 `labels` 等长，用来画趋势图（三个页签切换）。
- `attention`：驱动「需要您关注」列表。`botReady=false` 或 `storageSet=false` 要显示警示；`failed>0` 显示 `lastError`。

## 发布位置（常用群组/频道）
- `GET /api/targets`（所有人）→ `{list:[{id,name,chatId}]}`，管理员看不到 `chatId`。发文时下拉选名称。
- `PUT /api/targets`（仅超级管理员）body `{targets:[{id?,name,chatId}]}`，整份覆盖。`chatId` 格式：`@频道用户名` 或数字 ID（如 `-100123456789`）。
- `POST /api/targets/check`（所有人）body `{chatId}` → `{ok,title,type,canPost,message}`；连不上回 400 并带说明。用于「测试连接」按钮。

## 发文排程（公告）
`GET /api/announcements` → `{list:[Announcement], defaultTarget}`
```json
{ "id":"", "title":"", "targetId":"", "targetName":"", "text":"", "mediaId":"", "mediaMissing":false,
  "at":"ISO或null", "status":"draft|scheduled|sent|failed", "error":"", "createdBy":"", "updatedBy":"" }
```
`POST /api/announcements`（新增/修改）body：
```json
{ "id":"（修改才带）", "title":"（选填，不填自动取正文开头）", "targetId":"", "text":"", "mediaId":"",
  "status":"draft|scheduled", "at":"ISO", "sendNow":false }
```
- 三种发送方式：**存草稿** `status:"draft"`；**定时发送** `status:"scheduled"` + `at`；**立即发送** `sendNow:true`（后端立刻触发，通常 1 到 2 秒内发出，不需要 at）。
- 校验（失败回 400 中文说明）：正文和素材至少一个；定时/立即必须选发布位置；定时的时间不能是过去（超过 1 分钟前）；素材必须存在；已发送的公告不能修改（前端提供「复制」另建一则）。
- `DELETE /api/announcements/:id`
- `POST /api/announcements/test` body `{text, mediaId}`：发到管理员自己的 Telegram（服务器需设 STORAGE_CHAT_ID）。

界面要点：发文窗口是一步到位：选发布位置、写正文、点选或拖入图片/视频（上传后自动存入素材库并选中）、三选一发送方式。

## 素材库（保留 30 天自动清理）
- `GET /api/media` → `{list:[{id,name,type,size,createdAt,uploadedBy,expiresAt,daysLeft,inUse,inUseReason}], ttlDays}`。`inUse=true` 表示被排程/草稿或机器人设置使用中，不会被清理也不能删除。
- `POST /api/media` multipart 字段 `file`，图片 <=10MB、视频 <=50MB，一次一个文件。成功回 `{ok,item}`（同上格式）。**发文窗口里直接上传也是调用这个接口**，所以自动进入素材库。
- `POST /api/media/:id/extend`：到期时间重置为现在起 30 天。
- `DELETE /api/media/:id`：被使用中回 409 并说明原因。
- `GET /api/media/:id/file`：图片缩图（视频 404）。
- 说明：文件本体存在 Telegram，服务器只存记录，所以清理的是记录和 Telegram 里的存放消息，不占服务器硬盘。清理每小时跑一次。

## 机器人设置（仅超级管理员）
**读取** `GET /api/config`
```json
{ "brand":"", "welcome":{"imageId":"","caption":""}, "menu":[[Button,...],...],
  "faq":[{"id","title","text"}], "activity":{...}, "media":[{id,name,type}] }
```

**菜单** `PUT /api/menu`，body `{menu: Button[][]}`（外层是行，内层是同一行的按钮，每行最多 3 个、最多 12 行）。整个 menu 一次性覆盖保存。
```json
Button = { "id":"", "label":"按钮文字", "type":"builtin|text|link", "enabled":true,
           "action":"（type=builtin）", "content":"（type=text）", "imageId":"（type=text，选填，file_id）", "url":"（type=link，必须 https:// 开头）" }
```
- `builtin` 的 `action` 可选值：`activity_menu` 限时活动、`bind_id` 领取Giftcode、`checkin` 每日签到、`my_points` 我的积分、`lucky_draw` 幸运抽奖、`referral` 邀请好友、`faq_menu` 常见问题、`internal_menu` 内部功能展示。
- `text` 类型：点击后 bot 显示 `content`（可带图）。
- `link` 类型：点击后跳转 `url`。
- 新增按钮时 `id` 可由前端随机产生（任意字串）或留空，后端会补。
- 界面建议：按钮按行列出，可调整行顺序、增删行与按钮，右边实时预览主菜单键盘，保存后提示「已同步」。

**欢迎页** `PUT /api/welcome`，body `{imageId, caption}`。`caption` 可用占位符 `{brand}`（品牌名）和 `{count}`（今日签到人数）。

**FAQ** `PUT /api/faq`，body `{faq:[{id,title,text}]}`，整份覆盖，最多 20 条。

**限时活动** `PUT /api/activity`，body：
```json
{ "activity": { "enabled":true, "title":"", "body":"", "imageId":"", "endAt":"ISO", "goal":500, "prize":"" } }
```

## 机器人资料（仅超级管理员，直接同步到 Telegram）
用户在 Telegram 里看到的名称、头像、简介、说明、命令菜单，都能在后台改，不需要去 BotFather。数据以 Telegram 上的为准（每次打开页面都实时读取）。
- `GET /api/bot-profile` → `{username, name, shortDescription, description, commands:[{command,description}], readOk}`。`readOk=false` 表示暂时读不到 Telegram 上的现有资料，界面要提醒「保存会覆盖」。
- `PUT /api/bot-profile` body `{name, shortDescription, description, commands}`。校验（400）：名称必填且 <=64；简介 <=120；说明 <=512；命令名只能英文小写/数字/下划线、<=32 字、说明必填 <=256、不可重复（开头的 `/` 会自动去掉）。后端只提交有变化的项目，回应：
  ```json
  { "ok": false, "results": { "name": {"ok":true,"skipped":true}, "shortDescription": {"ok":true}, "description": {"ok":false,"error":"中文原因"}, "commands": {"ok":true,"skipped":true} } }
  ```
  `skipped` 表示没有变化。某一项失败不影响其他项（例如改名字被 Telegram 限频）。界面要逐项显示成功/失败原因。
- `POST /api/bot-profile/avatar` multipart 字段 `file`（图片，<=5MB，建议正方形 JPG）；`DELETE /api/bot-profile/avatar` 移除；`GET /api/bot-profile/avatar` 取目前头像图片（没有头像或取不到回 404，前端显示首字占位）。
- 不能改的：机器人的 `@用户名`（Telegram 限制，只能在 BotFather）。界面里只显示、不提供编辑。
- 改名字有 Telegram 的频率限制，界面要提示「不要频繁修改」。

## 操作记录（仅超级管理员）
`GET /api/log` → `{ list:[{t:毫秒时间戳, by:操作人, action, detail}] }`，最近 150 条。

## 页面清单
工作总览 / 发文排程 / 素材库（所有人）；机器人设置（含机器人资料、菜单按钮、欢迎页、常见问题、限时活动、发布位置六个页签，默认打开「机器人资料」）/ 员工与权限 / 操作记录（仅超级管理员）。另有登入页。

## 分工与参考实现
前端分工见 `README-UI.md`。`public/app.js` 是 Claude 维护的交互逻辑，包含所有接口调用的写法。

## V6 新增：帖子按钮、点击数据、发布后管理、群人数
- 公告新增 `buttons:[{label,url}]`（最多 3 个，url 必须 https://），`POST /api/announcements` 和 `POST /api/announcements/:id/edit` 都带这个字段。
- 点击追踪：bot 发出的按钮链接是 `PUBLIC_URL/r/<公告id>/<按钮序号>`，公开路由 `GET /r/:aid/:idx` 记一笔再 302 到真实链接。没有设置 `PUBLIC_URL`（或 Railway 域名）时退回直接链接，不能统计，`/api/me` 的 `trackingReady=false`，前端要提示。
- `GET /api/announcements/:id/stats` → `{clicks, unique, members, ctr, buttons:[{label,url,clicks,unique}], hourly:[24], tracked, sentAt, pinned, removedAt, manageable}`。`unique` 按 IP+设备指纹去重，是估算值。列表接口的每则已发送公告多一个 `stats`。
- 发布后管理（已发送的公告）：`POST /:id/edit {text,buttons}`（只能改正文和按钮，素材不能换）、`POST /:id/pin {pin:true|false}`、`POST /:id/delete-message`（从 Telegram 删除，后台数据保留，`removedAt` 有值）。失败回 400 中文原因（例如 bot 没有管理权限）。
- `GET /api/members[?refresh=1]` → `{list:[{id,name,count,delta7,series:[{d,n}]}]}`，群/频道总人数快照，每 6 小时和每次发帖时记录。Telegram 不提供在线或活跃人数。
- `GET /api/insights` → `{bestTimes:{enough,slots:[{hour,label,posts,avgUnique}],needMore}, trackingReady}`，按发帖整点统计平均点击人数，至少 5 则带按钮的帖子且点击满 20 人才给建议。
- 每周报告（默认关闭）：`GET/PUT /api/weekly-report`（`{enabled,weekday(0=周日),hour}`）、`POST /preview`、`POST /test`。到点由 bot 私信 `ADMIN_IDS` 和 `STORAGE_CHAT_ID`。
- 发送失败时 bot 也会私信同一批管理员。

## V3.0 模板化新增

### GET /api/tg-users（仅 super_admin，含 owner）
参数：`q`（名字/@用户名/ID 搜寻）、`filter`（all|active|normal|dormant|bound）、`page`。回传 `{counts:{total,active,normal,dormant,bound}, total, list:[{id,name,username,level,lastSeen,interactions,streak,points,gameId}]}`。
admin / guest 一律 403。同一人 10 分钟内重复查看只记一次「查看会员名单」操作记录。

### GET /api/platform/summary（给 MJH 总汇用，不走登入）
Header `x-platform-key: <PLATFORM_KEY>`。未设置 PLATFORM_KEY → 404；密钥错 → 401。
回传 `{brand, version, demo, time, bot:{ready,username}, users:{total,active7,active30,new24h,new7}, posts:{sent7,scheduled,failed,lastSentAt,lastError}, clicks:{clicks7,unique7}, groups:[{name,count,delta7}], health:{...}}`。**不含任何会员个资**。

### /api/me 新增
`demoMode`（bool）、`can.userdata`（bool）。
