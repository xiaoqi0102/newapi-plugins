# MeAICC API · NewAPI 任务插件

把 [api.meaicc.com](https://api.meaicc.com/create/sd-2.html) 的 **Seedance 2.0 视频生成**接成 NewAPI 的上游。

- 插件 key:`meaicc` · 版本:`1.0.0` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:**按次**(插件不声明按秒用量钩子,单价配在网关「模型定价」里)
- 上游地址:https://api.meaicc.com (允许域:`api.meaicc.com`)
- 声明模型:`sd-2-c1`(该站视频接口目前只有这一个模型)

## 路径

| 方向 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 下游标准 | POST | `/v1/videos` | 视频创建(盐值AI「统一视频入口」走这条) |
| 下游标准 | GET | `/v1/videos/{task_id}` | 查询 |
| 下游标准 | GET | `/v1/videos/{task_id}/content` | 下载成片 |
| 插件自有 | POST | `/meaicc/v1/videos/generations` | 视频创建(直连调试) |
| 插件自有 | GET | `/meaicc/v1/videos/tasks/{task_id}` | 查询(直连调试) |

## 建渠道

1. 渠道 → 新建 → 类型选 **任务插件** → **绑定插件** `meaicc`
2. **Base URL**:`https://api.meaicc.com`
3. **密钥**:MeAICC 的 API Key(**带 `sk-` 前缀**,照抄官网给的那串即可)
4. **模型**:勾选 `sd-2-c1`

## 上游支持的四种生成方式

| 方式 | 怎么传 |
|---|---|
| 文生视频 | 只给 `prompt` |
| 图生视频 | `first_frame_url`(或 `image`/`images`) |
| 首尾帧 | `first_frame_url` + `last_frame_url` |
| 参考生视频 | `images` / `videos` / `audios`(或直接给上游形状的 `media: [{type,url}]`) |

插件把下游请求翻译成上游 body:

```json
{
  "model": "sd-2-c1",
  "input": { "prompt": "...", "media": [{ "type": "reference_image", "url": "https://..." }] },
  "parameters": { "duration": 10, "resolution": "720p", "ratio": "16:9" }
}
```

- `type` 取值:`first_frame` / `last_frame` / `reference_image` / `reference_voice` / `reference_video`
- 提示词里引用素材用 **`@图1` / `@视频1` / `@音频1`**(官方写法);
  盐值AI 统一视频入口写的是 `@Image1`,插件会**自动转成 `@图1`** 再提交
- `duration` **必填**(秒),不传默认 5;**输入视频 + 输出视频合计 ≤ 25 秒**
- `ratio` 只认 `1:1` / `16:9` / `9:16`,传其它值插件**不转发**(交给上游按素材自适应)
- `resolution` 默认 `720p`

## 上游限制(插件提交前已校验,超限直接报中文错)

| 项 | 上限 |
|---|---|
| 参考图片 | 9 张 |
| 参考视频 | 3 个 |
| 参考音频 | 3 个 |
| 时长 | 输入 + 输出合计 ≤ 25 秒 |
| 图片分辨率 | ≥ 300x300 |
| 素材形态 | **必须公网 http(s) URL** —— base64 / 本地文件 / 上传文件会被插件拦掉 |

## ⚠️ 三个必读的坑

1. **成片只缓存 10 小时**。上游生成结果 10 小时后清理,查询到 `SUCCEEDED` 后请尽快下载保存
   (走 `/v1/videos/{task_id}/content` 或直接存 `object` 里的直链)。
2. **失败信息拼在 `status` 字符串里**,形如 `"FAILED: 触发敏感词"`,不是独立字段。
   插件已做剥离,并把敏感词类失败附上可执行提示(避免违法/违规/涉政/色情/暴力/低俗/恶意引导,以及特定校名、地域名称)。
3. **提交是同步等待上游受理的**(返回 `task_id` 即完成提交),查询间隔官方建议 **≥ 20 秒**。
   若网关前面挂了 CDN(腾讯 EdgeOne 等),默认 15 秒「HTTP 应答超时」可能把慢提交掐成 **HTTP 524**
   —— 处理:站点级「回源配置 → 回源超时时间」调到 120 / 600 秒。

## 计费

插件**不声明** `usageSchema`(与同仓库 aicost / sudashui 一致),按次计费:
在网关「模型定价」里给 `sd-2-c1` 配一个固定单价即可。上游实时单价见
[api.meaicc.com/pricing](https://api.meaicc.com/pricing)。

## 变更记录

| 版本 | 说明 |
|---|---|
| 1.0.0 | 首版:视频专用 · 按次 · 单模型 `sd-2-c1`;支持文生/图生/首尾帧/参考生视频(9 图 + 3 视频 + 3 音频);`@Image1 → @图1` 引用改写;失败信息从 `status` 剥离 |
