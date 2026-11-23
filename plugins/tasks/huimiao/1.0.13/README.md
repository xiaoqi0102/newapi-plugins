# Huimiao AI（慧喵）视频任务插件

上游：[huimiaovip.com](https://huimiaovip.com) · 官方文档 <https://huimiaovip.com/docs/api-guide.md>

把 Huimiao AI 的**原生视频生成接口**接进 New API 的任务插件（渠道类型 61）。

## 一、和标准 OpenAI Videos 的差异（本插件替你翻译）

| 环节 | 上游原生 | 插件对外 |
|---|---|---|
| 创建 | `POST /v1/videos/generations`（**必须带 `Idempotency-Key`**，成功 202） | 标准 `POST /v1/videos` |
| 查询 | `GET /v1/videos/generations/{id}` | `GET /v1/videos/{id}` |
| 下载 | `GET /v1/videos/{id}/content` | `GET /v1/videos/{id}/content` |
| 比例 | `ratio`（推荐）/ `aspect_ratio` | `ratio` / `aspect_ratio` / `size` 都认 |
| 时长 | `duration`（整数秒） | `duration` / `seconds` 都认，越界自动吸附到模型区间 |
| 参考图 | `image_urls[]`（**只收公网 https**） | `image` / `images` / `image_urls` / **`input_reference`** / `image_url` / `first_frame_url` / `last_frame_url` / `start_frame` / `end_frame` / `reference_images` |
| 尺寸 | `ratio` + `resolution` | `ratio` / `aspect_ratio` / `aspectRatio` / **`size`（"1280x720" 自动推断）** |
| 参考音频 | `audio_urls[]`（MP3/WAV） | `audios` / `audio_urls` |
| 参考视频 | `video_urls[]`（MP4/MOV） | `videos` / `video_urls` |

## 二、三个必须知道的硬约束

0. **客户端格式兼容（1.0.1 起）**：OpenAI Videos 标准面常用的 `input_reference`（单图）、
   `size: "1280x720"`、首尾帧字段都能正确识别，不会被当成"没有参考图"。
   `asset_keys` / `audio_asset_keys` / `video_asset_keys`（上游直传对象键）在网关链路上**无法跨账户使用**，
   插件会明确报错并指路 `/v1/files`，而不是静默丢素材生成一段无关视频。
1. **上游严格解析 JSON**，出现任何未声明字段直接 `400 unsupported_field`。
   所以本插件**逐字段重建**提交体，客户端多带的 `size` / `quality` / `output_compression` / `metadata`
   之类**一律丢弃**，不会被透传上去（实测：多带一个 `quality` 就 400）。
2. **参考图只接受公网 https 地址**。`data:image/...base64` 和直接上传的文件都会被拒（上游在冻结积分前校验）。
   本插件在这种情况下**明确报错并指路** `https://img.qlike.top/v1/files`，不会静默丢图让你以为成功。
3. **幂等键每次新生成**。上游对「同键同参数」返回原任务且不重复扣费 —— 那会让用户重复提交同一提示词
   永远拿到同一个视频，所以插件每次提交都用新键（`hm_<时间戳>_<12位随机>`，格式符合上游 8~80 位限制）。

## 三、模型（20 个，来自上游 `GET /v1/models` 实测）

| 模型 id | 时长 | 分辨率 | 计费方式 | 积分 |
|---|---|---|---|---|
| `hm-video-wan3.0-gf` | 2–30s | 480p / 720p / 1080p | 按秒 | 1.6 / 3 / 6.5 |
| `hm-video-wan3.0-prime-gf` | 2–30s | 480p / 720p / 1080p | 按秒 | 3.3 / 6.5 / 13 |
| `hm-video-wan3.0-deal-mm` | 5–30s | 720p / 480p / 1080p | 按条 | 30 / 18 / 35 |
| `hm-wan3.0-prime-deal-mc` | 5–30s | 1080p | 按条 | 75 |
| `hm-video-sd-2.5-flash-gz` | 5–30s | 480p / 720p | 按条 | 15 / 25 |
| `hm-video-sd-2.5-full-gz` | 5–30s | 480p / 720p | 按秒 | 1.5 / 3.5 |
| `hm-video-sd-2.5-deal-persecond` | 4–30s | 720p / 480p | 按秒 | 2.3 / 2.3 |
| `hm-video-sd-2.0-mini-gz` | 4–15s | 480p / 720p | 按条 | 4 / 6 |
| `hm-video-sd-2.0-fast-gz` | 4–15s | 480p / 720p | 按条 | 6 / 8 |
| `hm-video-sd-2.0-full-gz` | 4–15s | 480p / 720p | 按条 | 10 / 20 |
| `hm-sd-2.5-30-0-10-m` | 4–30s | 720p | 按秒 | 4 |
| `hm-sd-2.5-30-0-10-mm` | 4–30s | 720p | 按秒 | 5.6 |
| `hm-sd-2.5-30-0-10-gz-persecond-ll` | 4–30s | 480p | 按秒 | 4.3 |
| `hm-sd-2.5-30-0-10-720-gz-persecond-ll` | 4–30s | 720p | 按秒 | 6 |
| `hm-sd-2.0-mini-gz` | 4–15s | 480p / 720p | 按秒 | 1.1 / 2 |
| `hm-sd-2.0-fast-gz` | 4–15s | 480p / 720p | 按秒 | 2.1 / 3.8 |
| `hm-video-vidu-q4-mm` | 2–16s | 720p / 1080p / 480p | 按条 | 14 / 16 / 12 |
| `hm-video-h3-768-gz-jj` | 4–15s | 768p | 按条 | 15 |
| `hm-video-h3-2k-gz-jj` | 4–15s | 2k | 按条 | 25 |
| `hm-video-heygen-nn` | 15s（固定） | 720p | 按条 | 13 |

> 上游只提供「积分」计价（`unit=credit`），积分与货币的换算由你自己定；本插件不参与计费，
> 价格在 New API 渠道侧（`ModelPrice` 按次 / 计费表达式按秒）配置。

## 四、素材能力（每模型不同，插件内已按目录写死）

- 图片上限 9–30 张、音频 3–10 段、视频 0–10 段（`maxImages` / `maxAudios` / `maxVideos`）。
- 提示词上限 7000–20000 字符。
- 比例支持 `21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16`（各模型是其中子集）。
- `hm-video-sd-2.5-flash-gz`、`hm-video-sd-2.0-*`、`hm-video-sd-2.5-full-gz` 等**不支持纯文生视频**，
  必须至少 1 张参考图（插件会在提交前就报错，不会打上游）。

## 五、可用性验证（零成本）

上游要求严格字段，所以「字段集是否合法」可以用**空提示词**探针零成本验证：

```bash
curl -X POST https://huimiaovip.com/v1/videos/generations \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json; charset=utf-8" \
  -H "Idempotency-Key: probe_$(date +%s)" \
  -d '{"model":"hm-video-wan3.0-gf","prompt":"","task_type":"text_to_video","ratio":"16:9","duration":5,"resolution":"720p"}'
# → 400 "该模型提示词不能为空且不能超过 20000 个字符"  = 字段全合法（只是 prompt 空）
```

## 中文模型名

New API 的渠道 `model_mapping` 对**任务插件这条路不生效**（插件拿到的 `ctx.model` 还是客户端传来的原名），
所以要用中文模型名，必须在插件侧翻译。1.0.2 起插件内置别名表：

| 对外模型名 | 上游模型 id | 分辨率规则（1.0.9） |
| --- | --- | --- |
| `官转-Sd-2.0-满血-支持人脸-2.40` | `hm-video-sd-2.0-full-gz` | 客户端传参，未传默认 480p（固定 $2.40/条） |
| `特价MC-Sd-2.0-满血-CP-按条` | `hm-video-sd-2.0-full-mc` | 客户端传参 `480p`/`720p`（也可 `size:"1280x720"`），未传默认 **720p**；1080p/4k 暂不开放 |
| `特价N-Sd-2.5-30-10-10-720-支持人脸` | `hm-sd-2.5-30-10-deal-n` | 固定 **720p**，5–30 秒，30 图 / 10 音 / 10 视，16:9·4:3·1:1·3:4·9:16 五比例 |

**1.0.9 起不再按分辨率拆模型名。** 旧的 `特价MC-Sd-2.0-满血-CP-按条-480p-2.40` /
`-720p-3.52` / `-1080p-8.00` / `-4k-19.20` 四个名字已下线，客户端统一用
`特价MC-Sd-2.0-满血-CP-按条` + `resolution` 传画质；模型名后缀不再做任何「下限」抬升，
客户端传什么就出什么。

### 按实际分辨率计费

插件通过 `meta.usageSchema` 上报 `resolution` / `seconds`，宿主按档结算，一个模型名覆盖四档：

```
u("resolution") == "4k" ? tier("4k", 19.20)
  : u("resolution") == "1080p" ? tier("1080p", 8.00)
  : u("resolution") == "720p" ? tier("720p", 3.52)
  : tier("480p", 2.40)
```

表达式写进 `billing_setting.billing_expr`（键 = 对外模型名）+ `billing_setting.billing_mode` =
`tiered_expr`；`/api/pricing` 里出现 `billing_mode:"tiered_expr"` + `billing_expr` + `billing_usage_schema`
即为生效。没配表达式的模型名走 `ModelPrice` 固定价（`官转-...-2.40` 就是固定 $2.40/条）。

英文真实 id 照旧可用。上游新增中文名时在 `MODEL_ALIASES` 里追加并 +1 版本。

## 变更记录

- **1.0.10** 新增「特价N-Sd-2.5-30-10-10-720-支持人脸」（上游 `hm-sd-2.5-30-10-deal-n`）：
  720p、5–30 秒、30 图 / 10 音 / 10 视、提示词 15000 字、按条 25 积分、不排队。
  同时把 MC 单模型收窄到 480p/720p —— 单一名只有一个按次价，卖不到 1080p/4k 的成本档。
- **1.0.9** 不再按分辨率拆模型名：MC 只保留「特价MC-Sd-2.0-满血-CP-按条」一个对外名，
  画质完全由客户端 `resolution` / `size` 决定（未传默认 720p），去掉 1.0.8 的名字下限逻辑。
  旧的四个带后缀名字下线，改由按分辨率表达式计费（480p 2.40 / 720p 3.52 / 1080p 8.00 / 4k 19.20）。
- **1.0.8** 模型名后缀改为**分辨率下限**：实际档位 = `max(名字后缀, 客户端 resolution)`。
  名字 720p + 客户端 480p 仍出 720p；名字 480p + 客户端 720p/1080p/4k 按客户端升档并按实际档位计费。
  修 1.0.7 的语义偏差（客户端可无条件降档/越过所选模型档），同时保留「不降级」。
- **1.0.7** 分辨率改为**客户端 `resolution` 优先**（支持 `720p` 与 `1280x720` 两种写法），模型名后缀降级为兜底；
  新增 `meta.usageSchema`（`resolution` 枚举 + `seconds`）与 `extractUsage()`，宿主可按实际出片分辨率计费；
  修 1.0.6 的问题：客户端传 720p 时仍被 `-480p` 模型名强制压成 480p。`plugin_state.request.resolution` 现在记录实际选中档位。
- **1.0.6** 对外模型名带价格后缀（`-2.40` / `-3.52` / `-8.00` / `-19.20`），分辨率改为从名字后缀用正则判读，替代原来的枚举表。
- **1.0.5** 上架「官转-Sd-2.0-满血-支持人脸」($2.40) 与「特价MC-Sd-2.0-满血-CP-按条」四档 ($2.40/$3.52/$8.00/$19.20)；新增 `MODEL_RESOLUTION` 按对外名钉死分辨率；下线 flash / fast 两个别名。
- **1.0.4** `decodeRequest` 的 `model` 与 `requestBody.model` 保留客户端原名（含中文别名），真名只在 `buildSubmitRequest` 里翻译。宿主 `is not served by this plugin` 校验比对的是「渠道 models 里的名字」，提前翻译会被拦下。
- **1.0.3** 中文别名同时写进 `meta.models` / `protocols.models`。宿主的 `is not served by this plugin` 校验只认插件声明列表，别名不在列表里会在 `decodeRequest` 之后被宿主拦下（`/v1/models` 能看到中文名但调用报 not served）。
- **1.0.2** 支持中文模型别名（`MODEL_ALIASES`）：渠道 `model_mapping` 对任务插件不生效，中文名须在插件侧翻译成上游 id。

- **1.0.1** 素材/参数解析广谱兼容：OpenAI Videos 标准面 `input_reference` + `size`（1280x720 → 16:9 / 720p）、
  首尾帧别名（`first_frame_url` / `last_frame_url` / `start_frame` / `end_frame`）、
  `image_url` / `image_list` / `material_urls` 等客户端别名；`16x9` 这类分隔符归一为 `16:9`；
  **检测到 `asset_keys` 等上游直传键且无公网 URL 时明确报错**（此前会静默按无图提交，客户拿到与参考图无关的视频）。
- **1.0.0** 首版：声明 20 个视频模型；原生 `generations` 面 + 严格字段白名单 + 每次新幂等键 +
  https-only 素材校验 + 直链/本站入口双形态下载；`plugin_state.__outbound` 上游报文快照。

## 1.0.12 — 透传上游阶段文案

查询响应（`GET /v1/videos/{id}` 与插件自有查询路由）额外返回：

```json
{"progress": 60, "progress_text": "排队中 · 提交后已等待 211.5 秒", "message": "排队中 · 提交后已等待 211.5 秒"}
```

- `progress` 仍是数值百分比，老客户端不受影响；
- 优先取上游 `progress.message` / `status_text` / `message` 原文；没有文案时按 `provider_state`
  或 `status` 映射中文（排队中 / 生成中 / 核对中 / 已完成 / 已失败）；
- 客户端（小琪AI 等）可直接展示 `progress_text`，无需自己维护状态字典。
