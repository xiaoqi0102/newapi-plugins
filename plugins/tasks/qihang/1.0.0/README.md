# qihang（启航 统一 API）· NewAPI 任务插件

上游：`https://166683.xyz`　文档：`https://166683.xyz/docs/`
协议：标准 OpenAI Videos（与宿主 `openai_video` 同构，插件只做参数归一 + 透传）

## 模型（v1.0.0 只声明这 2 个按次视频模型）

| 对外模型名 | 按次价 | 能力 |
|---|---|---|
| `seedance-2.0480p` | $2.00 / 次 | Seedance 2.0 Fast 480p，903，最长 15 秒，不卡人脸，最多 9 图 / 3 段音频 |
| `Seedance-933-720p` | $3.50 / 次 | 官渠可返官链，720P 原生过真人，4~15 秒，参考 9 图 / 0 视频 / 3 音频，提示词 ≤15000 字，比例 9:16 / 16:9 / 1:1 / 4:3，平均 4~10 分钟 |

价格配在 New API「模型定价」的按次价（`ModelPrice`），插件**不声明 usageSchema**、不做按秒计费。

## 参数约束（插件侧硬校验，超了直接 400，不打上游不扣费）

- `seconds` ∈ [4, 15]，缺省 5；客户端写 `duration` 也认
- `aspect_ratio` ∈ {9:16, 16:9, 1:1, 4:3}，缺省 16:9；客户端写 `ratio` 也认
- `images` ≤ 9，接受公网 `http(s)://` 或 `data:image/...;base64`
  （上游 `images` 未限定 uri 格式；`videos` / `audios` 上游要求 `format: uri`，只收公网 URL）
- `videos` ≤ 0（该上游这两个型号都不支持视频参考）
- `audios` ≤ 3
- `prompt` ≤ 15000 字符；`@Image1` / `@Video1` / `@Audio1` 统一改小写（盐值AI 统一视频入口的写法）
- 客户端**直接上传文件**（multipart）会被明确拒绝：插件沙箱读不到文件内容。
  请把素材先转公网直链（`https://img.qlike.top/v1/files`）再提交。

## 上游契约

```
POST /v1/videos   { model, prompt, seconds, aspect_ratio, images[]?, videos[]?, audios[]? }  → VideoTask
GET  /v1/videos/{id}          → VideoTask
GET  /v1/videos/{id}/content  → video/mp4
```
`status ∈ queued | in_progress | completed | failed | unknown`，`progress` 是 **0~100 整数**（插件按整数取，不做 ×100 猜测），
成功结果优先取 `result_url`（免 Key 直链），没有则回退 `/v1/videos/{id}/content`。

## 变更记录

- **1.0.0** 首版：声明 2 个按次视频模型；标准 `/v1/videos` 透传 + 别名归一；
  `plugin_state` 写请求快照与 `__outbound` 上游报文（脱敏、>16KB 折叠）；progress 按 0~100 整数解析。
