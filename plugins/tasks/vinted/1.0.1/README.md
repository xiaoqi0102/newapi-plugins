# vinted（Seedance 聚合 · vinted.cam）1.0.1

NewAPI **任务插件（渠道类型 61）**，纯视频、按次计费。上游 <https://vinted.cam>，「Seedance 聚合」接口：
一步提交 `POST /v1/videos/generations`，轮询 `GET /v1/videos/{id}`，下载 `GET /v1/videos/{id}/file`（带 Bearer 直接回 MP4）。

## 声明模型

只声明 **一个** 模型：`seedance-2.5-plus`（特价无限并发 Seedance 2.5 Plus）。

画质**完全由客户端传参决定**：`resolution: "480p" | "720p"`（或 `size: "1280x720"`），没传时缺省 720p。
不按分辨率拆模型名 —— 客户端（小琪AI 等）自己会把分辨率传下来。

| 上游积分/次 | 480p 15 分 | 720p 20 分 |
|---|---|---|

> 一条渠道对一个模型名只能挂一个价，所以本站按 720p 档定价（$3.33/次，40% 毛利率）；客户端选 480p 时上游只扣 15 分，毛利更高。

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
- 1.0.1（2026-11-23）收敛为单一模型 `seedance-2.5-plus`：不按分辨率拆名，画质由客户端传参决定（缺省 720p）。