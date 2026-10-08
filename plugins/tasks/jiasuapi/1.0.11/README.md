# 佳速API · NewAPI 任务插件(纯视频)

把 [佳速API](https://ai.jiasuapi.com/) 的**视频生成**接成 NewAPI 的上游。

- 插件 key:`jiasuapi` · 版本:`1.0.11` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:**按次**。插件不声明按秒用量钩子,单价配在网关「模型定价」的固定单价里
- 上游地址:https://ai.jiasuapi.com (允许域:ai / ai1 / api / relay / m / media `.jiasuapi.com`)
- 声明模型:**7 个** —— 1.0.11 起与站点在售清单对齐(图片功能已于 1.0.10 全部移除)

## 路径

| 方向 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 下游标准 | POST | `/v1/videos` | 创建任务(盐值AI「统一视频入口」走这条) |
| 下游标准 | GET | `/v1/videos/{task_id}` | 查询任务 |
| 下游标准 | GET | `/v1/videos/{task_id}/content` | 下载成片 |
| 插件自有 | POST | `/jiasuapi/v1/videos/generations` | 视频创建(调试用) |
| 插件自有 | GET | `/jiasuapi/v1/videos/tasks/{task_id}` | 视频查询(调试用) |

上游侧走站点文档的 `POST /v1/video/generations` + `GET /v1/videos/tasks/{task_id}`(扁平结构,无 `code/data` 外层)。

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件**
2. **绑定插件** `jiasuapi`
3. **Base URL 可留空**(插件默认 `https://ai.jiasuapi.com`,也允许填 ai1/api/relay/m/media 域名)
4. **密钥**:佳速的 Bearer API Key(`sk-…`)
5. **模型**:按下表勾选(插件已声明 7 个)

> ⚠️ 任务插件的模型名**必须在插件的 `meta` 里声明过**(`models` + `protocols[].models` + `routes[].models` + 内部 `VIDEO_MODELS`)。
> 上游新上架、而插件没声明的模型名,光在渠道里勾选也没用,调用会直接 `503 No available channel`。

### ⚠️ `minimax-h3` 为什么要写成 `minimax-h3-jiasu`

New API 对**插件声明的模型名做全平台唯一校验(大小写不敏感)**,而 `minimax-h3` 已被
g-aisc 插件的 `MiniMax-H3` 占用(安装时报 `plugin jiasuapi model "minimax-h3" conflicts with plugin gaisc model "MiniMax-H3"`)。
所以本站点用**站点专属别名** `minimax-h3-jiasu` 声明,提交上游前由插件内的 `MODEL_ALIASES`
翻回真名 `minimax-h3`。

渠道侧照旧用「别名-价格」写法:`minimax-h3-jiasu-1`(client 看到的名字)→ `model_mapping`
指到声明的 `minimax-h3-jiasu` → 插件出站时再翻成 `minimax-h3`。**client 看到的名字由渠道决定,不受影响。**

## 模型与参考单价(站点在售清单)

单价口径:**站点 `/api/pricing` 的展示价(元/次)**,渠道别名里「短名-价格」的 `-价格` 部分照抄。

| 声明模型名 | 站点原名 | 单价 | 计费 | 备注 |
|---|---|---|---|---|
| `seedance-2.0-900` | seedance-2.0-900 | ¥0.7/次 | 按次 | 4-15s、480p/720p、最多 9 图、后台过人脸 |
| `seedance-2.5-900` | seedance-2.5-900 | ¥0.8/次 | 按次 | 4-30s、480p/720p、最多 9 图 |
| `seedance-2.5-101010` | seedance-2.5-101010 | ¥1.8/次 | 按次 | 4-30s、720p、最多 10 图 10 音频、不参考视频 |
| `seedance-2.5-301010` | seedance-2.5-301010 | ¥2/次 | **站点标「按量计费」** | 4-30s、480p/720p、最多 30 图 10 音频 |
| `sd-2.0-933-720-fast-原生真人` | 同左 | ¥2.6/次 | 按次 | 4-15s、720p、9 图 3 视频 3 音频、原生真人 |
| `dola-sd-2.0-933` | dola-sd-2.0-933 | ¥1.3/次 | 按次 | dola 后台过真人,9 图 3 音频 |
| `minimax-h3-jiasu` | **minimax-h3** | ¥1/次 | 按次 | **2K 固定**、9 图 3 视频 3 音频、原生过真人 |

> `seedance-2.5-301010` 站点标的是**按量计费**,而本插件是**按次**计费 —— 上架前请自行确认
> 该模型的真实扣费口径,必要时用网关「模型定价」单独给它配单价,或先不上架。

1.0.11 **下线声明**的模型(站点已不在售清单里):`sd-2.0-720`、`sd-2.0-720-fast`、
`sd-2.0-933-720-满血原生真人`、`seedance-2.0-933`、`seedance2.0-mini-A`。

## minimax-h3 专用规格(1.0.11)

站点《接口文档》「H3 创建任务」节,接口与通用视频创建相同(`POST /v1/video/generations`),差异如下 ——
插件已按文档在提交前把参数收敛成上游形状,不用客户端自己算:

| 字段 | 规格 | 插件行为 |
|---|---|---|
| `duration` | 4 ~ 15 的整数,默认 15 | 不传 / 越界 → 按 **15**;区间内取整 |
| `resolution` | **固定 `2k`** | 无论客户端传什么都不带别的,统一 `2k` |
| `ratio` | `9:16` / `1:1` / `3:4` / `4:3` / `16:9` | 不传或传其它值 → 按 **`16:9`** |
| `images` | 最多 **9** 张 | 超限本地报中文错 |
| `videos` | 最多 **3** 个,可写 `{url, duration_seconds?, mime?}` | 超限本地报中文错;`duration_seconds` 原样透传(不传上游按 5 秒计) |
| `audios` | 最多 **3** 个,可写 `{url, mime?}` | 超限本地报中文错 |
| `materials` | 混合写法 `[{type, url, duration_seconds?}]`(type=image/video/audio) | 原样透传 |
| `attachments` | 混合写法 `[{type, url, mime?, duration_seconds?}]` | **与 images/videos/audios/materials 互斥**,同时传本地报错 |

## 实现要点

- 下游字段:`images` / `videos` / `audios`(顶层),`ratio` 优先、`aspect_ratio` 兜底,
  `seconds` → 上游 `duration`;`video_urls` / `audio_urls`(盐值AI 老写法)也认
- 素材必须是**公网 URL**;base64 / 本地文件在提交前直接报错
- 上游**没有** `generate_audio` 字段,不转发该参数
- `face` 只透传 `{enabled, mode: light|heavy}`,其它键忽略
- 参考视频/音频对象的 `duration_seconds` / `mime` 会原样带上(1.0.11 起;此前会被丢掉)
- `MODEL_ALIASES` 只做「插件声明名 → 上游真名」的翻译,目前只有 `minimax-h3-jiasu → minimax-h3` 一条
- 上游受理较轻(实测 3~12 秒),一般不会踩回源超时
- 上游模型按**分组隔离**:外部用不带 prompt 的探针**无法判断**某个模型是否已下架
  (探针返回 `503 No available channel` 只说明「当前这把 Key 的分组里没挂到」),要验证只能真跑一次

## 变更记录

| 版本 | 说明 |
|---|---|
| 1.0.11 | 与站点在售清单对齐:声明收敛为 **7 个**模型(下线 `sd-2.0-720` / `sd-2.0-720-fast` / `sd-2.0-933-720-满血原生真人` / `seedance-2.0-933` / `seedance2.0-mini-A`),新增 `dola-sd-2.0-933`;新增 **minimax-h3**(因平台模型名唯一限制,以别名 `minimax-h3-jiasu` 声明 + `MODEL_ALIASES` 翻回真名);minimax-h3 专用规格(4~15s 默认 15、分辨率固定 2k、比例白名单、图 ≤9 / 视频 ≤3 / 音频 ≤3);参考视频/音频保留 `duration_seconds` 与 `mime`;新增 `attachments` 混合字段并与 images/videos/audios/materials 互斥。 |
| 1.0.10 | **纯视频化**:删除全部图片功能(3 个图片模型、`/jiasuapi/v1/images/create` 与 `/jiasuapi/v1/images/tasks/:id` 两条路由、`IMAGE_MODELS` / `isImageModel` / `inferAction` / `decodeImageSubmit` / `buildImageBody` / `artifactIsImage` / `QUALITIES` / `outboundQuality`,以及查询路径与产物下载里的图片分支)。视频链路完全保留。 |
| 1.0.9 | 移除 5 个 `-不重试` 变体声明 |
| 1.0.8 | 补声明上游新增 `seedance2.0-mini-A`;同步上游 2026-09-28 起的价目口径 |
| 1.0.7 | 声明 5 个 `-不重试` 变体(已于 1.0.9 移除) |
