# aicost API · NewAPI 任务插件(纯视频 · 单模型)

把 [aicost.me](https://www.aicost.me/) 的 **seedance2.0-900-fast** 接成 NewAPI 的上游。

- 插件 key:`aicost` · 版本:`1.0.7` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:**按次**(单价配在网关「模型定价」的固定单价里)
- 上游地址:https://www.aicost.me (允许域:`www.aicost.me`、`aicost.me`)
- 声明模型:**仅 1 个** —— `seedance2.0-900-fast`

## 唯一的模型

| 模型 | 参考单价 | 规格 |
|---|---|---|
| `seedance2.0-900-fast` | **$1.80 / 次** | 固定 **15 秒**、**720P**、**fast** 档,最多 **9 张参考图** |

## 路径

| 方向 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 下游标准 | POST | `/v1/videos` | 创建任务(盐值AI「统一视频入口」走这条) |
| 下游标准 | GET | `/v1/videos/{task_id}` | 查询任务 |
| 下游标准 | GET | `/v1/videos/{task_id}/content` | 下载成片 |

> 插件不声明任何自有路由,视频一律走宿主提供的标准 `/v1/videos` 三件套。

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件** → **绑定插件** `aicost`
2. **Base URL**:`https://www.aicost.me`
3. **密钥**:aicost 的 API Key —— ⚠ **48 位、不带 `sk-` 前缀**,带 `sk-` 反而鉴权失败
4. **模型**:只勾 `seedance2.0-900-fast`

## 视频能力

- 参考图:`images`(也认统一视频入口的 `image_urls`),公网 URL,最多 9 张
- 也支持参考视频 `videos` / 参考音频 `audios`
- 素材必须是**公网 URL**(上游服务端亲自抓取),base64 / 本地文件在提交前直接报错
- 代码里仍保留 MiniMax H3(首尾帧 `start_frame` / `end_frame`、`reference_images`)的分支逻辑,
  但 **1.0.7 未声明任何 H3 模型**,`/v1/videos` 不接受 `minimax-h3*`

## ⚠️ 部署必读:这是「摄取型」上游,必须放宽回源超时

aicost 在**受理前**要先完整下载并重托管所有参考图,9 张图时单次提交很容易超过 15 秒。
如果网关前面挂了 CDN(腾讯 EdgeOne 等),默认 15 秒「HTTP 应答超时」会把提交掐断成
**HTTP 524**:

- 提交请求**统一耗时 15.00 秒**失败,上游侧日志 `context canceled`
- 网关侧无异常(源码 `http.Server` 无读写超时),只有 CDN 在掐

处理:站点级「回源配置 → 回源超时时间」调到 120 / 600 秒,或规则引擎给
`/videos*`、`/v1/videos*`、`/video/generations*`、`/v1/video/generations*` 加
`HTTPUpstreamTimeout → ResponseTimeout: 600`(**规则保存后必须发布才生效**)。

另一个常见失败:参考图放在免费临时图床(uguu 等,约 3 小时过期)时,上游抓取失败会返回
`media restage failed ... connection reset by peer` —— 换成自有 OSS/COS/R2 即可根除。

## 变更记录

| 版本 | 说明 |
|---|---|
| 1.0.7 | **单一模型化**:只保留 `seedance2.0-900-fast`(固定 15 秒 / 720P / fast,最多 9 张参考图)。原 5 个模型(`seedance2.0-900-3` / `seedance2.5-vid` / `seedance2.0-480p` / `seedance2.0-720p` / `seedance2.5-900`)从 `meta.models`、`protocols[].models`、内部 `VIDEO_MODELS` 三处声明中移除。视频链路代码(参考图 / 首尾帧 / H3 分支 / 直链下载)保留。 |
| 1.0.6 | 纯视频化:删除全部图片功能(5 个图片模型、4 条图片路由及全套图片代码) |
| 1.0.5 | 图片 + 视频双面 |
