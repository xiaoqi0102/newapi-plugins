# 佳速API · NewAPI 任务插件(纯视频)

把 [佳速API](https://ai.jiasuapi.com/) 的**视频生成**接成 NewAPI 的上游。

- 插件 key:`jiasuapi` · 版本:`1.0.10` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:**按次**。插件不声明按秒用量钩子,单价配在网关「模型定价」的固定单价里
- 上游地址:https://ai.jiasuapi.com (允许域:ai / ai1 / api / relay / m / media `.jiasuapi.com`)
- 声明模型:**10 个视频模型**(图片功能已于 1.0.10 全部移除)

## 路径

| 方向 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 下游标准 | POST | `/v1/videos` | 创建任务(盐值AI「统一视频入口」走这条) |
| 下游标准 | GET | `/v1/videos/{task_id}` | 查询任务 |
| 下游标准 | GET | `/v1/videos/{task_id}/content` | 下载成片 |
| 插件自有 | POST | `/jiasuapi/v1/videos/generations` | 视频创建(调试用) |
| 插件自有 | GET | `/jiasuapi/v1/videos/tasks/{task_id}` | 视频查询(调试用) |

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件**
2. **绑定插件** `jiasuapi`
3. **Base URL 可留空**(插件默认 `https://ai.jiasuapi.com`,也允许填 ai1/api/relay/m/media 域名)
4. **密钥**:佳速的 Bearer API Key(`sk-…`)
5. **模型**:按 Key 实际可用的勾选(插件已声明 10 个视频模型)

> ⚠️ 任务插件的模型名**必须在插件的 `meta` 里声明过**(`models` + `protocols[].models` + `routes[].models` + 内部 `VIDEO_MODELS`)。
> 上游新上架、而插件没声明的模型名,光在渠道里勾选也没用,调用会直接 `503 No available channel`。

## 模型与参考单价

单价为本仓库维护时所用网关的「模型定价」固定单价(按次);上游价目表见
`https://ai.jiasuapi.com/api/pricing`(单位与本站 `ModelPrice` 同为**美元/次**,1:1 照抄)。

| 模型 | 单价 | 备注 |
|---|---|---|
| `seedance-2.0-900` | $0.70 | 视频 |
| `seedance-2.5-900` | $0.80 | 视频 |
| `seedance2.0-mini-A` | $1.00 | 视频 |
| `seedance-2.0-933` | $1.30 | 视频 |
| `seedance-2.5-101010` | $1.80 | 视频 |
| `seedance-2.5-301010` | $2.00 | 视频 |
| `sd-2.0-933-720-fast-原生真人` | $2.60 | 视频,**原生真人脸** |
| `sd-2.0-933-720-满血原生真人` | $5.50 | 视频,**原生真人脸** |

已声明但本机未挂渠道:`sd-2.0-720`、`sd-2.0-720-fast`。

上游还有但**本仓库未声明**的:`minimax-h3`($1.00,按次)、`seedance2.0-720-满血真人`($5.50,疑似
`sd-2.0-933-720-满血原生真人` 的改名版)、`seedance2.5-全参真人`($1.10,**按量计费 quota_type=2**,不进按次渠道)、
以及 9 个 `gpt-image-2*` 图片模型。

## 实现要点

- 下游字段:`images` / `videos` / `audios`(顶层),`ratio` 优先、`aspect_ratio` 兜底,
  `seconds` → 上游 `duration`
- 素材必须是**公网 URL**;base64 / 本地文件在提交前直接报错
- 上游**没有** `generate_audio` 字段,不转发该参数
- 上游受理较轻(实测 3~12 秒),一般不会踩回源超时
- 上游模型按**分组隔离**:外部用不带 prompt 的探针**无法判断**某个模型是否已下架
  (探针返回 `503 No available channel` 只说明「当前这把 Key 的分组里没挂到」),要验证只能真跑一次

## 变更记录

| 版本 | 说明 |
|---|---|
| 1.0.10 | **纯视频化**:删除全部图片功能 —— 3 个图片模型、`/jiasuapi/v1/images/create` 与 `/jiasuapi/v1/images/tasks/:id` 两条路由、`IMAGE_MODELS` / `isImageModel` / `inferAction` / `decodeImageSubmit` / `buildImageBody` / `artifactIsImage` / `QUALITIES` / `outboundQuality`,以及查询路径与产物下载里的图片分支。视频链路完全保留。 |
| 1.0.9 | 移除 5 个 `-不重试` 变体声明(`seedance-2.0-900` / `-2.0-933` / `-2.5-900` / `-2.5-101010` / `-2.5-301010`) |
| 1.0.8 | 补声明上游新增 `seedance2.0-mini-A`($1.00/次);同步上游 2026-09-28 起的价目口径 |
| 1.0.7 | 声明 5 个 `-不重试` 变体(已于 1.0.9 移除) |
