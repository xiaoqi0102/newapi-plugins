# aicost API · NewAPI 任务插件(纯视频)

把 [aicost.me](https://www.aicost.me/) 的**视频生成**接成 NewAPI 的上游。

- 插件 key:`aicost` · 版本:`1.0.6` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:**按次**(插件不声明按秒用量钩子,单价配在网关「模型定价」里)
- 上游地址:https://www.aicost.me (允许域:`www.aicost.me`、`aicost.me`)
- 声明模型:**5 个视频模型**(图片功能已于 1.0.6 全部移除)

## 路径

| 方向 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 下游标准 | POST | `/v1/videos` | 视频创建(盐值AI「统一视频入口」走这条) |
| 下游标准 | GET | `/v1/videos/{task_id}` | 查询 |
| 下游标准 | GET | `/v1/videos/{task_id}/content` | 下载成片 |

> 1.0.6 起插件**不再声明任何自有路由**(原来的 4 条 `/aicost/v1/...` 都是图片路由)。
> 视频一律走宿主提供的标准 `/v1/videos` 三件套。

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件** → **绑定插件** `aicost`
2. **Base URL**:`https://www.aicost.me`
3. **密钥**:aicost 的 API Key —— ⚠ **48 位、不带 `sk-` 前缀**,带 `sk-` 反而鉴权失败
4. **模型**:按 Key 勾选(插件声明 5 个视频模型)

## 模型与参考单价

| 模型 | 单价 | 备注 |
|---|---|---|
| `seedance2.0-900-3` | $1.05 | 视频 |
| `seedance2.0-480p` | $2.50 | 视频 |
| `seedance2.5-vid` | $3.00 | 视频 |
| `seedance2.0-720p` | $4.00 | 视频 |
| `seedance2.5-900` | $5.00 | 视频 |

## 视频能力

- **参考图 / 参考视频 / 参考音频**:`images` / `videos` / `audios`(统一视频入口的 `image_urls` / `video_urls` / `audio_urls` 也认)
- **MiniMax H3**(模型名 `minimax-h3*`):普通参考图走 `reference_images`;首尾帧走 `start_frame` / `end_frame`
  (与参考图**互斥**);不支持视频参考;音频参考必须搭配 `reference_images`
- 素材必须是**公网 URL**(上游服务端亲自抓取),base64 / 本地文件在提交前直接报错

## ⚠️ 部署必读:这是「摄取型」上游,必须放宽回源超时

aicost 在**受理前**要先完整下载并重托管所有参考图,素材多 / 图床慢时单次提交会超过 15 秒。
如果网关前面挂了 CDN(腾讯 EdgeOne 等),默认 15 秒「HTTP 应答超时」会把提交掐断成
**HTTP 524**,表现为:

- 提交请求**统一耗时 15.00 秒**失败,上游侧日志 `context canceled`
- 网关侧无异常(源码 `http.Server` 无读写超时),只有 CDN 在掐
- 素材越少越快:6 张免费图床图 ≈ 必踩线,2~3 张自有 OSS/COS 图 ≈ 3~11 秒通过

处理:站点级「回源配置 → 回源超时时间」调到 120 / 600 秒,或规则引擎给
`/videos*`、`/v1/videos*`、`/video/generations*`、`/v1/video/generations*` 加
`HTTPUpstreamTimeout → ResponseTimeout: 600`(**规则保存后必须发布才生效**)。

另一个常见失败:参考图放在免费临时图床(uguu 等,约 3 小时过期)时,上游抓取失败会返回
`media restage failed ... connection reset by peer` —— 换成自有 OSS/COS/R2 即可根除。

## 变更记录

| 版本 | 说明 |
|---|---|
| 1.0.6 | **纯视频化**:删除全部图片功能 —— 5 个图片模型、4 条图片路由(`/aicost/v1/images/generations`、`/images/edits`、`/gemini-images`、`/images/tasks/:id`)、`GEMINI_IMAGE_MODELS` / `IMAGE_MODELS` / `GEMINI_PREFIX` / `SIZE_TABLE` / `resolveSize` / `geminiImageRequest` / `gptImageBody` / 3 个图片 decode / `imageResult` / `imageTaskStatus` / `extractImages` / `collectImageUrls` / `extractImagesFromChoices` / `submitIntent`,以及产物与下载里的图片分支。视频链路(参考图 / 首尾帧 / H3 / 直链下载)完全保留。 |
| 1.0.5 | 图片 + 视频双面(本版起只保留视频) |
