# vinted（Seedance 聚合 · vinted.cam）1.0.0

NewAPI **任务插件（渠道类型 61）**，纯视频、按次计费。上游 <https://vinted.cam>，「Seedance 聚合」接口：
一步提交 `POST /v1/videos/generations`，轮询 `GET /v1/videos/{id}`，下载 `GET /v1/videos/{id}/file`（带 Bearer 直接回 MP4）。

## 声明模型

三个对外名都对应上游同一个 `seedance-2.5-plus`，差别只在分辨率口径，方便分别定价：
 
| 对外模型名 | 分辨率口径 | 上游积分/次 |
|---|---|---|
| `seedance-2.5-plus` | 客户端自选 480p / 720p，缺省 720p | 480p 15 / 720p 20 |
| `seedance-2.5-plus-480p` | **下限** 480p（客户端传 720p 仍按 720p） | 同左 |
| `seedance-2.5-plus-720p` | **下限** 720p（客户端传 480p 会被抬到 720p） | 同左 |

> 模型名里的分辨率只做**下限**，绝不把客户端明确指定的 720p 压成 480p —— 与「模型名分辨率高于客户端时以模型名为准」的既有口径一致。

能力（上游 `/v1/catalog` 实测）：时长 4–30 秒整数；画幅 `16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9`；提示词 ≤30,000 字符；
参考图 ≤30 张、参考视频 ≤10 段、参考音频 ≤10 段，三类合计 ≤50；单图 ≤50 MiB、参考总体积 ≤300 MiB、视/音累计时长各 ≤30 秒；零水印、原生立体声；失败自动退积分。

## 素材

上游**服务端自己抓素材**，所以参考图/视频/音频必须是**公网 https 地址**：

- `images` / `videos` / `audios`（也认 `image_urls`、`reference_images`、`input_reference`、`video_urls`、`audio_urls` 等别名）
- `data:` base64、直接上传的文件、`http://` 明文一律在网关侧拦下并给中文提示，指路素材中转 `https://img.qlike.top/v1/files`
- 客户端只传 `size`（如 `1280x720`）时，插件会反推画幅与分辨率；显式 `ratio` / `resolution` 优先
- 提示词里的 `@图片1` / `@Image1` / `参考图1` 自动改写成上游认的 `图1`

## 建渠道（面板）

渠道 → 新建 → 类型「任务插件」→ 绑定 `vinted` → Base URL `https://vinted.cam` → 密钥填上游 `sk-` Key →
模型勾选要卖的对外名 → 到「模型定价」按**按次**配单价（USD）。

只勾**已配价**的模型：任务模型没配 `ModelPrice` 会静默按 token 估算，一条视频可能只记几美分。

## 失败与退款

`status=failed` 时读 `error` / `error_code` / `progress.message` 三种形态，原文透出到 `fail_reason`；
`refunded=true` 会附「上游已退回积分」。历史失败后上游补交原片（`recovered_artifact.available=true` + `has_file=true`）
按成功交付，不重开新单。

## 变更记录

- 1.0.0（2026-11-23）首版：三档分辨率命名、字段白名单重建、公网素材校验、失败原因三形态、鉴权下载。