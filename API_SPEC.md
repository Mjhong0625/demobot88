# DemoBet88 管理后台 API 规格（给前端用）

后端已完成，前端只需要做界面并调用下面的接口。后端会把 `public/` 文件夹当静态网站提供，所以前端交付 `public/index.html`（可附带 css/js/图片文件）即可，不要改 `bot.js`、`admin.js`、`store.js`。

## 通用规则
- 所有接口前缀 `/api/`，请求与回应都是 JSON（上传素材除外）。
- 认证：登入成功后浏览器自动带 cookie（`mjh_session`，HttpOnly），前端不用自己存 token。除了 `/api/login`、`/api/me`，其他接口未登入都回 `401 {"error":"未登入"}`，前端收到 401 要跳回登入页。
- 失败统一回 `4xx/5xx {"error":"中文错误信息"}`，前端直接把 `error` 显示给用户即可。
- 时间：后端存 ISO 字串（UTC）。界面一律显示马来西亚时间（UTC+8）。送出时间时，把用户选的马来西亚时间转成 ISO 再传。
- 前端使用 `fetch(..., {credentials:"same-origin"})`。

## 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | body `{password}`，成功 `{ok:true}`；密码错 401；错太多次 429 |
| POST | `/api/logout` | 清除登入 |
| GET | `/api/me` | `{authed:boolean, brand:string}`，页面载入时先调这个决定显示登入页还是后台 |

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

## 发文排程（公告）
**列表** `GET /api/announcements` → `{ list: Announcement[], defaultTarget: string }`

Announcement：
```json
{ "id":"", "title":"", "target":"", "text":"", "mediaId":"", "at":"ISO或null",
  "status":"draft|scheduled|sent|failed", "error":"", "sentAt":"ISO", "createdAt":"ISO" }
```
- `status`：`draft` 草稿；`scheduled` 已确认排程，到点自动发送；`sent` 已发送（不可再修改）；`failed` 发送失败（`error` 有原因，修改后重新「确认排程」可重发）。
- `target` 为空表示使用 `defaultTarget`；`defaultTarget` 也为空时，前端提示用户必须填发布位置。

**新增/修改** `POST /api/announcements`，body：
```json
{ "id":"（修改时带，新增不带）", "title":"", "target":"", "text":"", "mediaId":"", "at":"ISO", "status":"draft|scheduled" }
```
- 必须有 `text` 或 `mediaId` 其一。
- `status:"scheduled"` 时 `at` 必填。已发送的公告再修改会回 400。
- 回 `{ok:true, announcement}`。

**删除** `DELETE /api/announcements/:id`

**发送测试** `POST /api/announcements/test`，body `{text, mediaId}`，发到管理员自己的聊天（需要后端设了 STORAGE_CHAT_ID，否则回 400 说明原因）。

界面建议：弹窗编辑，左边表单，右边 Telegram 气泡预览（正文、图片/视频、时间）。保存方式下拉：保存草稿 / 确认排程。

## 素材库
- `GET /api/media` → `{ list:[{id,name,type:"photo"|"video",size,createdAt}] }`
- `POST /api/media`：`multipart/form-data`，字段名 `file`。成功 `{ok:true,item:{id,name,type,fileId}}`。只收图片和视频；图片 ≤10MB，视频 ≤50MB；一次上传一个文件，多文件请逐个调用并显示进度。
- `DELETE /api/media/:id`
- `GET /api/media/:id/file`：图片缩图（只有 `type=photo` 有，视频回 404，前端用占位图标）。需要登入 cookie，可直接放进 `<img src>`。
- `GET /api/media-ids` → `{ list:[{id,name,fileId}] }`，仅图片，给「菜单按钮/欢迎页/活动」选图用。选图时存的值是 `fileId`，不是 `id`。

## 机器人设置
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

## 操作记录
`GET /api/log` → `{ list:[{t:毫秒时间戳, action, detail}] }`，最近 100 条。

## 页面清单（沿用现有 5 页）
工作总览 / 发文排程 / 素材库 / 机器人设置（菜单按钮、欢迎页、常见问题、限时活动四个页签）/ 操作记录。
另有登入页。配色与 logo：MJH & Co，黑绿品牌色，荧光绿 `#C8FF00` 为主色。

## 参考实现
`public/index.html` 是目前可运行的完整版本，所有接口调用方式都在里面，GPT 可以直接参考或在它基础上美化，但要保持接口调用不变。
