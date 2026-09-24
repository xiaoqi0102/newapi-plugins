# g-aisc API · NewAPI 任务插件

把 [g-aisc.xyz](https://g-aisc.xyz) 的**视频生成**接成 NewAPI 的上游。

- 插件 key:`gaisc` · 版本:`1.0.1` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:**按次**(插件不声明按秒用量钩子,单价配在网关「模型定价」里)
- 上游地址:https://g-aisc.xyz (允许域:`g-aisc.xyz`)
- 声明模型:**7 个** —— Doubao Seedance 2.5 / 2.0、MiniMax-H3、Google Veo 3.1 fast、HappyHorse t2v / i2v / r2v

## 路径

| 方向 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 下游标准 | POST | `/v1/videos` | 视频创建(盐值AI「统一视频入口」走这条) |
| 下游标准 | GET | `/v1/videos/{task_id}` | 查询 |
| 下游标准 | GET | `/v1/videos/{task_id}/content` | 下载成片 |
| 插件自有 | POST | `/gaisc/v1/videos/generations` | 视频创建(直连调试) |
| 插件自有 | GET | `/gaisc/v1/videos/tasks/{task_id}` | 查询(直连调试) |

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件** → **绑定插件** `gaisc`
2. **Base URL**:`https://g-aisc.xyz`
3. **密钥**:g-aisc 的 API Key(**带 `sk-` 前缀**,照抄站点给的那串即可)
4. **模型**:按 Key 的分组勾选子集(7 个都可勾)

> 上游是异步任务型:提交拿 `task_id` → 轮询 `GET /v1/videos/{id}` → 完成后响应里带 `url`。
> 轮询间隔建议 **10 秒**,总超时建议 **≥ 1800 秒**(1080p / 5s 常要 5~9 分钟)。

## 模型规格(插件按模型白名单校验,超限直接报中文错)

| 模型 | 时长(秒) | 分辨率 | 比例 | 参考图上限 | 首帧 | 尾帧 |
|---|---|---|---|---|---|---|
| `doubao-seedance-2-5-260628` | 4 ~ 30 | 480p / 720p / 1080p | 16:9 9:16 4:3 3:4 1:1 | 9 | ✅ | ✅ |
| `doubao-seedance-2-0-260128` | 4 ~ 15 | 480p / 720p / 1080p | 16:9 9:16 4:3 3:4 1:1 | 9 | ✅ | ✅ |
| `MiniMax-H3` | 4 ~ 15 | 720p / 1080p | 16:9 9:16 1:1 4:3 3:4 | 9 | ✅ | ✅ |
| `veo-3.1-fast-generate-001` | **只能 4 / 6 / 8** | 720p / 1080p | 16:9 9:16 | 1(只支持首帧) | ✅ | ❌ |
| `happyhorse-1.0-t2v` | 3 ~ 15 | 720p / 1080p | 16:9 9:16 4:3 3:4 1:1 | **不要传图** | — | — |
| `happyhorse-1.0-i2v` | 3 ~ 15 | 720p / 1080p | 16:9 9:16 4:3 3:4 1:1 | 1(首帧) | ✅ | ❌ |
| `happyhorse-1.0-r2v` | 3 ~ 15 | 720p / 1080p | 16:9 9:16 4:3 3:4 1:1 | 9 | ✅ | ❌ |

选型建议:要长视频 / 最高画质 → `doubao-seedance-2-5-260628`;要多图参考(人物 + 服装 + 场景) → 2.5 或 `happyhorse-1.0-r2v`;
要首尾帧精确控制 → 2.5 / 2.0 / MiniMax-H3;要 Veo 质感 → `veo-3.1-fast-generate-001`(时长只能 4/6/8、比例只能 16:9 / 9:16)。

## 插件把下游请求翻译成上游 body

```json
{
  "model": "doubao-seedance-2-5-260628",
  "prompt": "让 @image1 里的人物穿着 @image2 中的服装走进 @image3 的场景",
  "seconds": "5",
  "metadata": { "resolution": "720p", "ratio": "16:9" },
  "images": ["https://图床/actor.png", "https://图床/cloth.png", "https://图床/scene.png"]
}
```

首尾帧(与参考图**不能同时用**,插件会提前拦掉):

```json
{
  "model": "doubao-seedance-2-5-260628",
  "prompt": "镜头从这只猫缓缓拉远",
  "seconds": "5",
  "metadata": {
    "resolution": "1080p",
    "ratio": "16:9",
    "content": [
      { "type": "image_url", "role": "first_frame", "image_url": { "url": "https://图床/start.png" } },
      { "type": "image_url", "role": "last_frame",  "image_url": { "url": "https://图床/end.png" } }
    ]
  }
}
```

下游字段兼容(插件都认):

| 语义 | 下游可用的写法 |
|---|---|
| 提示词 | `prompt` / `metadata.prompt` / `extra_body.prompt` / `messages[].content` / `input` |
| 时长 | `seconds` / `duration`(★插件统一转成**字符串**再提交,数字上游会 400) |
| 分辨率 | `resolution` / `size`(`1280x720` 这类宽高写法会映射到 720p) |
| 比例 | `ratio` / `aspect_ratio` / `metadata.ratio`;`adaptive` / `auto` 视为 16:9 |
| 参考图 | `images` / `image` / `image_urls` / `reference_images` / `image_refs`(数组顺序 = `@image1`~`@image9`) |
| 首帧 | `first_frame_url` / `first_frame` / `start_frame`,或 `metadata.content` 里 `role: first_frame` |
| 尾帧 | `last_frame_url` / `last_frame` / `end_frame`,或 `metadata.content` 里 `role: last_frame` |
| multipart 文件 | `input_reference` / `first_frame` / `start_frame` / `last_frame` / `end_frame` / `image` / `images` / `reference_image` / `reference_images` |

- 提示词引用:`@Image1`(盐值AI 统一视频入口写法)会被插件改写成上游文档的 `@image1`
- **时长按模型夹取 / 吸附**:区间模型夹到 `[min, max]`,veo 吸附到最近的 4 / 6 / 8(等距取大,不悄悄砍短)
- **比例不在模型白名单内直接报错**(上游会返回 `plugin_usage_invalid`,本地报错信息更清楚)

## 素材形态(与同仓库其它插件不同!)

g-aisc 上游**同时支持三种**,所以本插件**不强制公网 URL**:

| 方式 | 怎么写 |
|---|---|
| 公网 URL(推荐,最省带宽) | `"images": ["https://你的图床/a.png"]` |
| data URI | `"images": ["data:image/png;base64,iVBORw0KGgo..."]` |
| 纯 base64 | `"images": ["iVBORw0KGgo..."]`(不用带前缀) |
| multipart 上传文件 | `-F "input_reference=@本地.png"`,插件转成 `{__fileRef}` 占位,由宿主内联成 data URL 提交 |

> 上游建议上传图片压到 **10MB 以内**:多张参考图会先托管到 CDN 再提交,图越大首次提交越慢。

## ⚠️ 五个必读的坑

1. **成片只保留 1 小时**。过期后 `url`、`content_url`、`/videos/{id}/content` 全部失效 ——
   查到 `completed` 请立刻转存(走 `/v1/videos/{task_id}/content` 或直接下响应里的直链)。
2. **`seconds` 上游只吃字符串**。除 doubao 外其余模型传数字直接 400 —— 插件已统一转字符串,不用管。
3. **`resolution` / `ratio` 必须放 `metadata` 里**,放顶层不生效(会按默认值出片)—— 插件已按上游形状组装。
4. **首尾帧和参考图不能同时用**(上游会把参考图丢掉)。插件在提交前直接报错,让你二选一,避免拿到「参数没错但图没生效」的结果。
5. **参考视频 / 参考音频不支持**(g-aisc 的 JSON 视频接口只有 `images` 图片数组)。下游传了 `videos` / `audios` 插件会明确报错,不会静默丢。

另外两个容易踩的:

- **状态词是 `in_progress`(下划线)**,不是 `processing`;`url` 只在 `completed` 时出现,别拿它判断是否还在跑。插件已归一。
- **慢提交 + CDN**:若网关前面挂了腾讯 EdgeOne 等,默认 15 秒「HTTP 应答超时」可能把提交掐成 **HTTP 524**
  —— 处理:站点级「回源配置 → 回源超时时间」调到 120 / 600 秒,或给 `/videos*`、`/v1/videos*` 补 `HTTPUpstreamTimeout: 600`。

## 计费

插件**不声明** `usageSchema`(与同仓库 aicost / sudashui / meaicc 一致),按次计费:
在网关「模型定价」里给每个模型配一个固定单价即可。上游实时价目见 [g-aisc.xyz](https://g-aisc.xyz)。

## 变更记录

| 版本 | 说明 |
|---|---|
| 1.0.1 | 修复**插件自有路由**(`/gaisc/v1/videos/generations`)取不到 `model` 的问题:宿主协议路径会把 `model` 放进 `ctx`,自有路由的 `ctx` 里没有该字段,需回落到 `body.model`。协议路径(`/v1/videos`)不受影响。 |
| 1.0.0 | 首版:视频专用 · 按次 · 7 模型;按模型校验时长 / 分辨率 / 比例 / 参考图上限 / 首尾帧能力;`@Image1 → @image1` 引用改写;首尾帧与参考图冲突提前拦;`seconds` 强制字符串;参考视频 / 音频明确报错;下载优先走上游直链(credentialless),回落 `/v1/videos/{id}/content` 带鉴权 |
