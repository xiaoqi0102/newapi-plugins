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

| 对外中文名 | 上游模型 id |
| --- | --- |
| `官转-Sd-2.5-flash-支持人脸` | `hm-video-sd-2.5-flash-gz` |
| `官转-Sd-2.0-fast-支持人脸` | `hm-video-sd-2.0-fast-gz` |

英文真实 id 照旧可用。上游新增中文名时在 `MODEL_ALIASES` 里追加并 +1 版本。

## 变更记录

- **1.0.3** 中文别名同时写进 `meta.models` / `protocols.models`。宿主的 `is not served by this plugin` 校验只认插件声明列表，别名不在列表里会在 `decodeRequest` 之后被宿主拦下（`/v1/models` 能看到中文名但调用报 not served）。
- **1.0.2** 支持中文模型别名（`MODEL_ALIASES`）：渠道 `model_mapping` 对任务插件不生效，中文名须在插件侧翻译成上游 id。

- **1.0.1** 素材/参数解析广谱兼容：OpenAI Videos 标准面 `input_reference` + `size`（1280x720 → 16:9 / 720p）、
  首尾帧别名（`first_frame_url` / `last_frame_url` / `start_frame` / `end_frame`）、
  `image_url` / `image_list` / `material_urls` 等客户端别名；`16x9` 这类分隔符归一为 `16:9`；
  **检测到 `asset_keys` 等上游直传键且无公网 URL 时明确报错**（此前会静默按无图提交，客户拿到与参考图无关的视频）。
- **1.0.0** 首版：声明 20 个视频模型；原生 `generations` 面 + 严格字段白名单 + 每次新幂等键 +
  https-only 素材校验 + 直链/本站入口双形态下载；`plugin_state.__outbound` 上游报文快照。
