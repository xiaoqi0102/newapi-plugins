# VideoPipe 任务插件

VideoPipe · 创作站（`videopipe.cc`）视频生成接入 New API。**按积分计费，5 积分 / 任务，三档模式同价。**

- 插件 key：`videopipe`　协议：`openai_video`　当前版本：`1.0.2`
- 上游文档：<https://videopipe.cc/docs>
- 渠道类型：`task`（New API type 61），Base URL 填 `https://videopipe.cc`

## 一、模型（= 上游的三档 mode）

上游没有 `model` 参数，「模型」实际由 `mode` 决定。插件把三档映射成三个对外模型，方便在 New API 里分别定价：

| 对外模型 | 上游 `mode` | 可选时长 | 计价 |
| --- | --- | --- | --- |
| `videopipe-2.0` | `2.0`（默认档） | 5 / 10 / 15 秒 | 5 积分 / 任务 |
| `videopipe-dola2.0` | `dola2.0` | 固定 15 秒 | 5 积分 / 任务 |
| `videopipe-sd-20-10s` | `sd-20-10s` | 固定 10 秒 | 5 积分 / 任务 |

三档的 `ratio` 取值与 `images` 上限完全一样，只有时长和计价规则不同。

## 二、字段对照（客户端标准面 → 上游原生）

插件做逐字段翻译，客户端按 OpenAI Videos 习惯发即可：

| 客户端字段 | 上游字段 | 说明 |
| --- | --- | --- |
| `POST /v1/videos` | `POST /v1/videos/generations` | 路径不同 |
| `GET /v1/videos/{id}` | `GET /v1/tasks/{id}` | 路径不同 |
| `prompt` / `messages` | `prompt` | 必填；`messages` 会被拍平成一段文本 |
| `model` | `mode` | 三个模型对应三档 mode |
| `ratio` / `aspect_ratio` / `size` | `ratio` | 必填，只认 `21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16`；给 `size:"1280x720"` 会自动约分成 `16:9`；都不给默认 `16:9` |
| `durationSeconds` / `duration` / `seconds` | `durationSeconds` | 必填，取值随档位；给了不支持的数值会**吸附到最近一档**（12→10，5→15 等） |
| `images` / `reference_images` / `image_url` / `first_frame_url` 等 | `images: [{url}]` | 只收公网 **https**，最多 **10** 张，自动去重；多种素材字段名都认 |
| `skipFaceProcess` | `skipFaceProcess` | 可选，`false`/不传 = 会做人脸处理 |
| — | `mode` | 由模型名推导，客户端不用管 |

## 三、三条硬约束

1. **`images` 的元素是对象 `[{url}]`**，上游 DTO 是 `OpenMaterialInput`。传字符串数组（`["https://..."]`）会被 ASP.NET 模型绑定直接 `400`，插件已自动包装。
2. **参考图只收公网 https**。`http://` 明文、`data:` base64、本机/内网地址一律网关侧拒绝并给出改法，不会打到上游。要传本地文件，先在「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 `https://img.qlike.top/v1/files` 换直链。
3. **任务 `id` 是 long，但上游以字符串返回**。插件全程按字符串处理，不受 JS 安全整数限制；客户端也别用 `number` 接。

## 四、提示词引用参考图

上游用 `@图N` 引用第 N 张参考图。客户端写 `@Image1` / `@image1` / `@图片1` 都会被自动改写成 `@图1`，不用自己数。

## 五、任务状态

上游状态 → New API：

| 上游 `status` | 含义 | 插件行为 |
| --- | --- | --- |
| `pending` | 排队中 | `IN_PROGRESS`（进度 5%） |
| `processing` | 生成 / 后处理中，对外不区分 | `IN_PROGRESS`（进度 50%） |
| `succeeded` | 完成，`outputUrl` 有地址 | `SUCCESS` |
| `failed` | 失败，积分已全额退还 | `FAILURE` |
| `timeout` | 处理超时，积分已全额退还 | `FAILURE` |
| `cancelled` | 已取消，积分已全额退还 | `FAILURE` |

判定完成的唯一依据是 `status === "succeeded"`；其余状态 `outputUrl` 一律为 `null`，不存在「有地址但仍在处理」的中间态。`succeeded` 却拿不到 `outputUrl` 时按失败处理，并把原因写清。

## 六、产物地址会过期

`outputUrl` 来自第三方 CDN，带时间签名。**过期访问会 403**。插件在 `outputUrl` 为空时自动调用 `GET /v1/tasks/output-url/{id}` 取新地址；下载直链一律**不带本站 Key**（`credentialless`），避免触发防盗链。

## 七、轮询建议（上游要求）

- 创建后 **5 分钟内不要查** —— 只会有 `pending` / `processing`，白耗配额。
- 之后 10–30 秒一次，配合指数退避。
- 拿到终态立即停，把 `outputUrl` 落到自己的库里。
- 上游限流：提交突发 120 次 / 每秒恢复 2 次；查询突发 600 次 / 每秒恢复 10 次；取产物地址 30 次/分钟。触发 429 按 `Retry-After` 等待，别固定间隔重试。
- 也可以在「API 密钥」页配回调地址，走 `task.completed` webhook（Standard Webhooks 签名），就不用高频轮询。

## 八、错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 401 | `INVALID_API_KEY` | Key 无效或过期 |
| 400 | `INSUFFICIENT_POINTS` | 积分不足 |
| 400 | `INVALID_TASK_PARAMETERS` | 参数不合法（如提示词为空、时长不在档位内） |
| 404 | `TASK_NOT_FOUND` | 任务不存在 |
| 409 | `OUTPUT_URL_UNAVAILABLE` | 产物地址不可用且无法刷新（早期任务缺刷新凭证） |
| 503 | `QUOTA_EXCEEDED` | 该档位算力已满，稍后重试 |
| 503 | `QUOTA_NOT_CAPTURED` | 该档位产能采集未完成，稍后重试 |
| 429 | `RATE_LIMIT_EXCEEDED` | 频率超限 |

## 九、请求示例

```bash
curl -X POST "https://你的网关/v1/videos" \
  -H "Authorization: Bearer <本站Key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "videopipe-2.0",
    "prompt": "让 @Image1 里的人在雨夜街头慢动作走过霓虹灯",
    "ratio": "16:9",
    "durationSeconds": 10,
    "images": ["https://你的图床/ref.png"]
  }'
```

```bash
# 查任务
curl -H "Authorization: Bearer <本站Key>" "https://你的网关/v1/videos/<任务ID>"
```

## 变更记录

- **1.0.2** 拿到官方文档后按真实契约重写：三档 `mode` 映射成三个模型、`ratio`/`durationSeconds` 必填且校验吸附、`timeout` 归为失败、产物地址过期走 `output-url` 刷新、`@ImageN` 自动改写为 `@图N`。78 项单测全过。
- **1.0.1** 补齐宿主钩子 `listArtifacts` / `buildContentRequest` / `native` / `protocols`（New API rc.51 缺 `listArtifacts` 会整份拒装）。
- **1.0.0** 首版：零成本探针确认的路径与字段集，宽容响应解析。
