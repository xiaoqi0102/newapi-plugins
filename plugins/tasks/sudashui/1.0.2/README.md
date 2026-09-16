# SdAS API (sudashui) · NewAPI 任务插件

把 [SdAS API](https://api.sudashuiapi.com/) 接成 NewAPI 的**视频**生成上游。该站本身是一个
NewAPI 实例,所以模型 id、`/v1/models`、`/api/pricing` 的形态都是 NewAPI 那一套。

- 插件 key:`sudashui` · 版本:`1.0.2` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos` / `/{task_id}` / `/{task_id}/content`)
- 计费:**仅按次**。插件只声明上游 `quota_type=1` 的按次视频模型,
  **按秒 / 按量模型与图片模型一律不声明 ⇒ 从路由层堵死**(就算误加进渠道也调不通)
- 上游地址:https://api.sudashuiapi.com
- 文档:https://api-docs.sudashuiapi.com/ · 素材文件站:https://files.sudashuiapi.com

## 变更记录

- **1.0.2** 请求快照补齐 `reference_image_fields` / `reference_images_sent` / `_uploaded` / `_base64`
  (此前只有数量,无法判定客户端用的是哪套字段名)
- **1.0.1** 声明 27 个按次视频模型;修正块注释提前闭合(`jy-*/` 导致 `*/` 提前结束注释)的 bug
- **1.0.0** 首版(视频专用 · 按次)

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件** → **绑定插件** `sudashui`
2. **Base URL**:`https://api.sudashuiapi.com`
3. **密钥**:`sk-…`(该站 API Key;换访问令牌可用它调 `/api/user/self`、`/api/pricing`)
4. **模型**:见下表,推荐先用 6 个「最便宜 + 支持真人」档
5. **模型定价**:该站报价单位是**人民币**,本网关额度按美元看 ⇒
   **单价 = 人民币价 ÷ 7.3**(不除的话会按 7.3 倍超额计费)

> 拿价小技巧:该站 `/api/pricing` 需要登录,但**站点公告是公开的**,新上线 / 调价 / 下架
> 连单价都写在公告里,单位写「元/条」= 按次、写「元/秒」= 按秒。

## 上游协议差异(插件已全部翻译好)

| 项 | 盐值AI / 下游发出 | 本插件 → 上游 |
|---|---|---|
| 媒体字段 | `image_urls` / `video_urls` / `audio_urls` | `metadata.payload` 的 **JSON 字符串**里放 `imageUrls` / `videoUrls` / `audioUrls` |
| 画面比例 | `ratio` | `aspectRatio`(在 payload 内) |
| 时长 | `seconds` | `duration`(4~15 秒) |
| 模式 | — | 有首/尾帧 → `mode:"frames"`,否则 `mode:"references"` |
| 分辨率 | `resolution` | **不传**(分辨率写在模型名里) |
| 提示词引用 | `@Image1` | 自动转小写 `@image1`(上游只认小写) |

上游接口:提交 `POST /v1/video/generations`、查询 `GET /v1/video/generations/{task_id}`;
状态机 `SUBMITTED → IN_PROGRESS → SUCCESS / FAILURE`。

**解析防坑**:该站失败时会把**错误文本塞在 `result_url` 字段**里(而不是留空),
插件先判状态、只把成功状态下的链接当直链用。

## 请求快照(1.0.2 起,排障用)

插件在提交时把客户端原始参数写进 `tasks.private_data.plugin_state.request`,事后可以用 SQL 取回
(New API 默认**不落请求体**,失败任务的提示词只有这一步能捞)。

```sql
SELECT id, status, fail_reason,
       private_data->'plugin_state'->'request'->>'prompt'                 AS prompt,
       private_data->'plugin_state'->'request'->>'reference_image_fields' AS 发图字段,
       private_data->'plugin_state'->'request'->>'reference_images_sent'  AS 发了几张,
       private_data->'plugin_state'->'request'->>'reference_images_count' AS 有效几张
FROM tasks WHERE channel_id = <本渠道 id> ORDER BY id DESC LIMIT 10;
```

`reference_image_fields` 是判断**客户端用的哪套协议**的关键:

| 取值 | 含义 |
|---|---|
| `["image_urls"]` | 盐值AI「**统一视频入口**」协议(也认 `video_urls` / `audio_urls`) |
| `["image_refs"]` / `["image_refs(base64)"]` | OpenAI 兼容协议(默认),图片走内联 base64 |
| `["reference_images(上传文件)"]` | multipart 上传的文件 |
| `["metadata.start_frame"]` 等 | 图片藏在嵌套字段里 |

其余字段:`reference_images`(落库的公网 URL,最多 8 条)、`reference_images_uploaded`、
`reference_images_base64`、`reference_videos` / `reference_audios`(数量)、`seconds`、
`aspect_ratio`、`sudashui_mode`、`generate_audio`。

## 提交前的硬限制(插件直接拦掉,不烧上游额度)

- 参考图 ≤ 9、参考视频 ≤ 3、参考音频 ≤ 3
- 时长 4~15 秒(注意部分 720p 上限 12 秒)
- 提示词 ≤ 15000 字符
- 素材必须是**公网 URL**(上游服务端抓取),base64 / 本地文件会被拒
- 素材只收 jpg/png/webp、mp4/mov、mp3/wav(**不收 gif**)

## 模型清单(27 个按次视频模型,单价为上游人民币报价)

✅ = 已在参考渠道挂载的 6 个「最便宜 + 支持真人」档。

| 模型 | 单价 | 参考素材 / 时长 | 真人 |
|---|---|---|---|
| ✅ `sdas-pd-sd2.0-mini-903-480p` | ¥0.83 | 9图0视频3音频,5-15s | 支持 |
| ✅ `sdas-pd-sd2.0-mini-903-720p` | ¥0.85 | 9图0视频3音频,5-12s | 支持 |
| ✅ `sdas-wf-sd2.0-mini-933-480p` | ¥1.24 | 9图3视频3音频,4-15s | 支持 |
| ✅ `sdas-wf-sd2.0-mini-933-720p` | ¥1.24 | 9图3视频3音频,4-12s | 支持 |
| ✅ `sdas-xl-sd2.0-903-mini-480p` | ¥1.50 | 9图0视频3音频,15s | 支持 |
| ✅ `sdas-qd-seedance-2.0-mini-480p` | ¥1.50 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-mini-no-face-480p` | ¥1.50 | 同上 | 卡人 |
| `sdas-mj-minimax-h3-2k` | ¥1.80 | 海螺 h3,9图0视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-fast-480p` | ¥2.00 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-fast-no-face-480p` | ¥2.00 | 同上 | 卡人 |
| `sdas-qd-seedance-2.0-mini-720p` | ¥2.20 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-mini-no-face-720p` | ¥2.20 | 同上 | 卡人 |
| `sdas-qd-seedance-2.0-480p` | ¥2.50 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-no-face-480p` | ¥2.50 | 同上 | 卡人 |
| `sdas-qd-seedance-2.0-fast-720p` | ¥2.80 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-fast-no-face-720p` | ¥2.80 | 同上 | 卡人 |
| `sdas-hn-sd2.0-fast-720p` | ¥2.80 | 4图3视频1音频,5/10/15s | 支持 |
| `sdas-qd-seedance-2.0-720p` | ¥3.50 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-no-face-720p` | ¥3.50 | 同上 | 卡人 |
| `sdas-ll-sd2.5-pro-30s-720p` | ¥5.25 | 30图3视频,固定 30s | 支持 |
| `sdas-hn-sd2.0-933-720p` | ¥5.50 | — | 支持 |
| `sdas-qd-seedance-2.0-1080p` | ¥5.50 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-no-face-1080p` | ¥5.50 | 同上 | 卡人 |
| `sdas-xg-sd2.0-pro-933-2-720p` | ¥5.70 | — | 支持 |
| `sdas-hn-sd2.0-pro-933-720p` | ¥6.60 | 9图3视频3音频,15s | 支持 |
| `sdas-qd-seedance-2.0-4k` | ¥16.00 | 9图3视频3音频,4-15s | 支持 |
| `sdas-qd-seedance-2.0-no-face-4k` | ¥16.00 | 同上 | 卡人 |

上游「按量计费」那批(`sdas-mg-*` / `sdas-rd-*` 等,单位元/秒)与 6 个图片模型
(`jy-*`、`sdas-zh-gtp-img2`)**本插件不声明**,以匹配"只接按次"的计费口径。

## ⚠️ 部署提醒

- 该站提交前也要服务端抓取参考素材,**同样容易踩 CDN 15 秒应答超时(HTTP 524)** ——
  规则引擎里给 `/videos*`、`/v1/videos*`、`/video/generations*`、`/v1/video/generations*`
  补 `HTTPUpstreamTimeout → ResponseTimeout: 600`,**保存后记得发布**。
- 上游文档里的失败样例原文 `"fail_reason": "Real human faces are not supported."` ——
  带 `no-face` 的型号不要用来做真人脸;要真人选上表标「支持」的。
- 实测参考:480p 档提交仅 **986 ms**、出片约 20 分钟、扣费 $0.1137(¥0.83 档)——
  该站受理轻,基本不会触发 524。
