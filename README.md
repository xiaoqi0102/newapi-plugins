# NewAPI 任务插件市场源(自用合集)

面向 **NewAPI 实例** 的 GitHub 市场源。收录自用的图片 / 视频生成上游插件,按官方
[marketplace index v1 契约](https://github.com/QuantumNous/new-api-plugins/blob/main/docs/marketplace.md)
组织,**一个插件一个子目录**,既可作为市场源一键安装,也可单独下载 `plugin.js` 手动上传。

- 全部插件都是 **任务插件(Task Plugin,渠道类型 61)**,只声明 `openai_video` 协议
- 全部 **按次计费**(插件内不声明按秒用量钩子,价格配在网关「模型定价」的固定单价里)
- 素材一律要求 **公网 URL**(上游服务端抓取),base64 / 本地文件会被插件在提交前拦掉

## 插件一览

| 插件 key | 名称 | 上游 | 版本 | 声明模型 | 计费 |
|---|---|---|---|---|---|
| [`jiasuapi`](plugins/tasks/jiasuapi/1.0.7/README.md) | 佳速API | https://ai.jiasuapi.com | 1.0.7 | 17 | 按次 |
| [`aicost`](plugins/tasks/aicost/1.0.5/README.md) | aicost API | https://www.aicost.me | 1.0.5 | 10 | 按次 |
| [`sudashui`](plugins/tasks/sudashui/1.0.1/README.md) | SdAS API | https://api.sudashuiapi.com | 1.0.1 | 27 | 按次 |

声明模型数 ≥ 渠道实际挂载数:插件只声明"上游明确支持"的模型,每个渠道按自己的 Key 勾选子集。

## 作为市场源使用

市场源 URL(**推荐 jsDelivr,国内可直连**):

```text
https://cdn.jsdelivr.net/gh/xiaoqi0102/newapi-plugins@main/index.json
```

GitHub raw 备用(raw.githubusercontent.com 在部分网络环境不可达):

```text
https://raw.githubusercontent.com/xiaoqi0102/newapi-plugins/main/index.json
```

步骤:

1. 管理员登录你的 NewAPI 控制台
2. **任务插件 → 市场源 → 新增**,名称随意,URL 填上面任一条
3. 保存 → 刷新市场列表,应能看到本仓库的插件
4. 安装 → **激活**指定版本
5. **渠道 → 新建渠道 → 类型选「任务插件」→ 绑定插件 key**,填上游 Base URL 与 Key,勾选模型

> 市场索引是**浏览器**去拉的(不是服务端),所以要选你浏览器能打开的域名:
> jsDelivr 国内直连可用,`raw.githubusercontent.com` 可能被墙。安装时前端会校验
> `index.json` 里的 `sha256` 再上传,索引本身只是展示缓存,准入以网关重新编译的结果为准。

## 手动安装(不走市场)

```bash
# 1. 上传插件源码(自动编译校验)
python3 - <<'PY'
import json, urllib.request, os
src = open('plugins/tasks/sudashui/1.0.1/plugin.js', encoding='utf-8').read()
body = json.dumps({"source": src, "enabled": True}, ensure_ascii=False).encode()
req = urllib.request.Request(os.environ['GW'] + '/api/plugin/task', data=body, method='PUT',
    headers={'Authorization': 'Bearer ' + os.environ['GW_TOKEN'], 'New-Api-User': '1',
             'Content-Type': 'application/json'})
print(urllib.request.urlopen(req).read().decode())
PY

# 2. 激活版本
curl -sS -X POST "$GW/api/plugin/task/sudashui/activate" \
  -H "Authorization: Bearer $GW_TOKEN" -H 'New-Api-User: 1' \
  -H 'Content-Type: application/json' -d '{"version":"1.0.1"}'
```

## 目录结构

```text
index.json                              # 市场索引,由 tools/build-index.mjs 生成,勿手改
plugins/tasks/<key>/<version>/plugin.js # 插件本体(市场安装时按 index 里的 path 拉取)
plugins/tasks/<key>/<version>/README.md # 该插件的上游 / 模型 / 计费 / 建渠道说明
tools/build-index.mjs                   # 生成 + 校验 index.json
```

## 新增或升级一个插件

1. 把 `plugin.js` 放到 `plugins/tasks/<key>/<version>/`(目录名必须等于 `meta.key` / `meta.version`),同目录补 `README.md`
2. 跑 `node tools/build-index.mjs` 重新生成 `index.json`
3. 跑 `node tools/build-index.mjs --check` 确认一致(可挂到 CI)
4. commit + push

## 部署提醒:慢提交上游要放宽回源超时

本仓库的插件都是「提交 → 轮询 → 下载」型。若网关前面挂了 CDN(如腾讯 EdgeOne),
**默认 15 秒的「HTTP 应答超时」会把上游慢提交掐断成 HTTP 524**,现象是提交请求统一
耗时 15.00 秒、上游报 `context canceled`。处理办法二选一:

- 站点级「回源配置 → 回源超时时间」调到 120 / 600 秒
- 规则引擎给视频路径补 `HTTPUpstreamTimeout → ResponseTimeout: 600`
  (至少覆盖 `/videos*`、`/v1/videos*`、`/video/generations*`、`/v1/video/generations*`)

摄取型上游(受理前先下载并重托管参考图,如 aicost)最容易踩这个坑。
