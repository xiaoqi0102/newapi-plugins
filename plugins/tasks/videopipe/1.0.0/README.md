# VideoPipe（videopipe.cc）· NewAPI 任务插件

创作站视频生成的翻译型任务插件。对外是标准 OpenAI Videos 面，内部翻译到上游原生接口。

## 用法

渠道类型选「任务插件」→ 绑定 `videopipe` → Base URL `https://videopipe.cc` → 填 `sk_` 密钥 → 勾选 `videopipe-video`。

客户端调用：

```bash
curl -X POST 'https://<你的网关>/v1/videos' \
  -H 'Authorization: Bearer sk-<你的令牌>' \
  -H 'Content-Type: application/json' \
  -d '{"model":"videopipe-video","prompt":"一只猫在跳舞","size":"1280x720","seconds":5}'
```

查询：`GET /v1/videos/{id}`，完成后返回视频直链。

## 原生 vs 标准面

| | 本插件对外（OpenAI Videos） | 上游原生 |
|---|---|---|
| 创建 | `POST /v1/videos` | `POST /v1/videos/generations` |
| 查询 | `GET /v1/videos/{id}` | `GET /v1/tasks/{id}`（id 是**整数**，非 GUID） |
| 提示词 | `prompt` | `prompt` |
| 比例 | `size`（`1280x720`→`16:9`）或 `ratio` | `ratio`（如 `16:9`） |
| 时长 | `seconds` / `duration` | `durationSeconds` |
| 参考图 | `input_reference` / `images` / `first_frame_url` … | `images: [{ url }]` |
| 模型 | 任意对客名 | **无 model 参数**（站点默认档） |

## 三条硬约束

1. **参考图必须是 `[{url}]` 对象数组**。上游 DTO 是 `OpenMaterialInput`，传 `["https://..."]` 会被 ASP.NET 模型绑定直接 400（`The JSON value could not be converted to ... OpenMaterialInput`）。插件已自动包成对象。
2. **只收公网 https**。base64 / 本地文件在网关侧就报错并指路 `/v1/files` 中转，不打上游。
3. **空 prompt 网关侧直接拒**（0ms、不扣积分）。上游对空提示词回 `INVALID_TASK_PARAMETERS: 提示词不能为空`。

## 尚未确认的部分（诚实标注）

用零成本探针能确认的都确认了：路径、字段集、`images` 的对象结构、错误体格式、`/v1/tasks/{整数id}` 的路由、`/v1/balance` 返回 `{"points":N}`。

**但上游成功提交的响应体没拿到**（要真跑一条任务才会产生，会扣积分）。所以 `parseSubmitResponse` / `parseTaskResult` 是**宽容解析**：

- 任务 ID：`taskId` / `task_id` / `id` / `data.taskId` / `data.id` / `result.id`
- 状态：`status` / `state` / `taskStatus`
- 进度：`progress` / `percent` / `percentage`（0~1 自动归一为 0~100）
- 成片地址：`videoUrl` / `url` / `downloadUrl` / `outputUrl` / `data.url` / `outputs[0].url`

跑通一条真实任务后，可以把这些收窄成确定的字段名。

## 变更记录

- **1.0.0** 首版：零成本探针确认的契约；`images` 对象封装；size→ratio 反推；`durationSeconds` 别名兼容；宽容响应解析（不确定时明确报错，不静默成功）。
