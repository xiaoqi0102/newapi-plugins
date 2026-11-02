# 佳速API · NewAPI 任务插件(纯视频)

把 [佳速API](https://ai.jiasuapi.com/) 的**视频生成**接成 NewAPI 的上游。

- 插件 key:`jiasuapi` · 版本:`1.0.17` · 类型:任务插件(Task Plugin,渠道 61)
- 协议:`openai_video`(下游标准 `/v1/videos`)
- 计费:分两种 ——
  - **按次**:其余模型,单价配在「模型定价」的固定单价(`ModelPrice`)里
  - **按秒**:`minimax-h3`,插件通过 `meta.usageSchema` 暴露 `seconds`,网关侧用表达式
    `tier("base", u("seconds") * 0.05)` 结算(站点报价 0.05/秒)。
    **`duration` 必填**(5~30 秒),缺参/非数字/越界一律本地 400,不做隐式默认(避免客户端不知情被预扣)。
    校验在 `openai_video.decodeRequest` 里完成,客户端拿到的 400 是干净中文,不带 hook 名与源码堆栈
- 上游地址:https://ai.jiasuapi.com (允许域:ai / ai1 / api / relay / m / media `.jiasuapi.com`)
- 声明模型:**10 个**(9 个按次 + `minimax-h3-jiasu` 按秒)

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
5. **模型**:按下表勾选(插件已声明 10 个)

> ⚠️ 任务插件的模型名**必须在插件的 `meta` 里声明过**(`models` + `protocols[].models` + `routes[].models` + 内部 `VIDEO_MODELS`)。
> 上游新上架、而插件没声明的模型名,光在渠道里勾选也没用,调用会直接 `503 No available channel`。

### ⚠️ `minimax-h3` 为什么要写成 `minimax-h3-jiasu`

New API 对**插件声明的模型名做全平台唯一校验(大小写不敏感)**,而 `minimax-h3` 已被
g-aisc 插件的 `MiniMax-H3` 占用(安装时报 `plugin jiasuapi model "minimax-h3" conflicts with plugin gaisc model "MiniMax-H3"`)。
所以本站点用**站点专属别名** `minimax-h3-jiasu` 声明,提交上游前由插件内的 `MODEL_ALIASES`
翻回真名 `minimax-h3`。

渠道侧对外名照旧用「短名-价格」,`model_mapping` 指向本插件的声明名:

```json
{"minimax-h3-0.05每秒": "minimax-h3-jiasu"}
```

对外名**故意不以数字结尾**,避免「按次定价审计脚本」把 0.05 误判成一次 0.05 美元。

### minimax-h3 规格(1.0.17,按秒版)

| 项 | 值 |
|---|---|
| 时长 `duration` | **必填**,5~30 秒整数;缺参/非数字/越界 → 本地 400(不默认、不收敛) |
| 分辨率 `resolution` | 固定 `768p`(站点 768 自部署) |
| 比例 `ratio` | `9:16` `1:1` `3:4` `4:3` `16:9`,其它值按 `16:9` |
| 参考图 | ≤9 |
| 参考视频 | ≤3,`duration_seconds` 不传按 5 秒 |
| 参考音频 | ≤3 |
| 素材总数 | 图片+视频+音频 ≤10 |
| 音视频合计时长 | ≤15 秒(超限本地报中文错,不打上游、不计费) |
| 计价 | 0.05/秒(表达式 `tier("base", u("seconds") * 0.05)`),预扣 = `duration × 0.05` |

## 变更记录

### 1.0.17

- `duration` 必填校验前移到 **`openai_video.decodeRequest`**(标准 `/v1/videos` 路径):
  400 文案干净,不再出现 `hook buildSubmitRequest failed … jiasuapi.js:365`
- `extractUsage` 不抛错(非法时长由 decode 兜底),避免宿主把它包成提交失败
- 修正 `__outbound` 快照里写死的 `version: "1.0.12"`(改用 `meta.version`)

### 1.0.15

- `minimax-h3` 的 `duration` 改为**必填**:缺参 / 非数字 / 不在 5~30 秒一律本地 400 中文报错,
  不再隐式默认 30 秒(那会让客户端在不知情时被预扣 1.5 美元),也不再静默收敛越界值

### 1.0.14

- 重新声明 `minimax-h3`(站点已改为**按秒计费**,0.05/秒,768 自部署)
- 规格更新:768p 固定、5~30 秒、9 图 3 视频 3 音频、素材合计 ≤10、音视频合计 ≤15 秒
- 新增 `meta.usageSchema.seconds` + `extractUsage()`,供宿主按秒计费

### 1.0.13

- 模型声明对齐上游 2026-10 在售清单(9 个按次模型),下线 `minimax-h3-jiasu` 等旧声明
