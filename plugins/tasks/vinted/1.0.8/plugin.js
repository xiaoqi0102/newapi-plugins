/**
 * vinted（Seedance 聚合 · vinted.cam）— NewAPI 任务插件 · 视频专用
 * 上游: https://vinted.cam    文档: https://vinted.cam/developers
 *
 * 上游契约（官方接入指南 + 真实任务响应双向确认，2026-11-23）:
 *   POST /v1/videos/generations
 *     { model*, prompt*, duration*, resolution*, ratio*, images?:[url], videos?:[url], audios?:[url] }
 *   GET  /v1/videos/{id}           status ∈ queued | running | succeeded | failed
 *   GET  /v1/videos/{id}/file      带 Authorization 直接回 video/mp4
 *   GET  /v1/videos/{id}/signed_url  回 {url:"/v1/videos/{id}/file?exp=&sig=",...}（匿名可下，约 24h）
 *
 *   任务体关键字段: id / status / has_file / download_url / refunded / error /
 *   error_code / progress{state,message} / recovered_artifact / replacement_job_id
 *
 * 只声明一个模型 seedance-2.5-plus：画质由客户端传的 resolution / size 决定（缺省 720p），
 * 不按分辨率拆模型名，客户端（小琪AI 等）会自己把分辨率传下来。
 *
 * ⚠️ 必须翻译、不能透传的点:
 *   1. 提交路径是 /v1/videos/generations，查询是 /v1/videos/{id}，下载是 /v1/videos/{id}/file。
 *   2. 参考素材只收**公网 https 地址**（上游服务端自己抓取），base64 / 本地上传一律本地拦截。
 *   3. 画幅 6 种（含 21:9），分辨率只有 480p / 720p，时长 4–30 秒整数；提示词 ≤30000 字符。
 *   4. 素材上限 30 图 / 10 视频 / 10 音频、三类合计 ≤50；单图 ≤50 MiB、总体积 ≤300 MiB 由上游校验。
 *   5. 下载地址是短期签名链接，但带 Bearer 打 /file 也可直接拿到 MP4 —— 插件优先走鉴权下载，避免签名过期。
 *
 * 变更记录:
 *   1.0.0  首版：seedance-2.5-plus 三档命名（基准 + 480p/720p 下限）、字段白名单重建、
 *          素材公网地址校验、4–30s/6 画幅/30-10-10 上限、失败原因三形态提取、鉴权下载。
 *   1.0.1  按用户要求收敛为单一模型 seedance-2.5-plus：不按分辨率拆名，画质完全由客户端传参决定。
 *   1.0.8  放行 CDN 跳转域（cdn-video.vinted.cam）：/v1/videos/{id}/file 是 307 到 CDN，
 *          只写 vinted.cam 时宿主会判 artifact_request_rejected 502，客户端拿不到成片。
 *   1.0.7  查询入参兼容宿主直传上游 JSON（不包 {status, body}）—— 这是 vinted 任务长期停在
 *          「30% / 上游响应暂时异常」、上游早就 succeeded 也不完成的根因。
 *   1.0.6  插件自有提交路由（/vinted/v1/videos/generations）兼容原始 JSON 字符串 body，
 *          并用 requestBody.model 兜底 —— 否则该路由恒报 model is required（走前缀路由必踩）。
 *   1.0.5  对齐小琪AI 的轮询契约：插件自有查询路由（/vinted/v1/videos/tasks/{id}）返回**数值** progress、
 *          小写 status，并把失败原因写进 progress_text；“上游响应暂时异常”不再顶掉失败原因。
 *   1.0.4  提交改用「内容 + 10 分钟时间窗」派生的幂等键（不再是纯随机）：Cloudflare 504 / 网络超时后
 *          用同样参数重试会命中同一 Idempotency-Key，上游返回原任务、不重复扣费；504 的报错文案
 *          改成可读中文（不再把 Cloudflare 整段 JSON 抛给客户端）。
 *   1.0.3  把上游 progress.message（「核对中」/「排队中 · 已等待 X 秒」/「视频生成中」）透传给客户端：
 *          parseTaskResult 额外返回 message，native.taskStatus 与 openai_video.render 输出 message/progress_text；
 *          进度百分比语义不变（客户端读 progress 仍是 "10%"/"60%"）。
 *   1.0.2  ① 查询返回不可解析 / HTTP 0 / 5xx 时不再判失败，继续轮询（上游「核对中」阶段会短暂
 *          无有效响应，误判会让客户端直接报错）；② 去掉 extractUsageOnSubmit —— 宿主会把提交期
 *          用量当成计费参数，按「单价 × 秒数」预扣（30 秒单被扣 30 倍），改为只用 ModelPrice 按次。
 */

var DEFAULT_BASE_URL = "https://vinted.cam";
var UPSTREAM_MODEL = "seedance-2.5-plus";

var MODEL_SPECS = {
  "seedance-2.5-plus": { defaultResolution: "720p" },
};

var MODELS = Object.keys(MODEL_SPECS);
var RATIOS = ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"];
var RESOLUTIONS = ["480p", "720p"];
var DURATION_MIN = 4;
var DURATION_MAX = 30;
var MAX_IMAGES = 30;
var MAX_VIDEOS = 10;
var MAX_AUDIOS = 10;
var MAX_MIXED = 50;
var MAX_PROMPT = 30000;

export const meta = {
  apiVersion: 1,
  key: "vinted",
  name: "Seedance 聚合",
  icon: "text:VT",
  description: {
    en: "vinted.cam Seedance aggregation: seedance-2.5-plus (480p/720p, 4-30s, 21:9), per-call credits.",
    zh: "vinted.cam Seedance 聚合：seedance-2.5-plus 特价无限并发（480p/720p，4–30 秒，21:9 等 6 种画幅）。",
  },
  version: "1.0.8",
  author: { name: "vinted.cam", url: "https://vinted.cam/" },
  baseUrl: DEFAULT_BASE_URL,
  models: MODELS,
  fetchMode: "per_task",
  // 成片 /file 会 307 跳到 cdn-video.vinted.cam，宿主只放行 allowedHosts 内的跳转，
  // 只写 vinted.cam 会让 /content 报 502 artifact_request_rejected。
  allowedHosts: ["vinted.cam", "cdn-video.vinted.cam", "*.vinted.cam"],
  protocols: [
    {
      name: "openai_video",
      models: MODELS,
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/vinted/v1/videos/generations",
      type: "submit",
      action: "video",
      decode: "decodeVideoSubmit",
      render: "taskCreated",
      models: MODELS,
    },
    {
      method: "GET",
      path: "/vinted/v1/videos/tasks/:task_id",
      type: "query",
      render: "taskStatus",
    },
  ],
  usageSchema: {
    resolution: {
      enum: RESOLUTIONS,
      description: { en: "Resolution actually sent upstream", zh: "实际提交给上游的出片分辨率" },
      enumLabels: { "480p": "480p", "720p": "720p" },
    },
  },
  // ⚠️ 故意不声明 seconds：宿主会把数字型用量当作「单价 × 用量」预扣（30 秒单扣了 30 倍），
  // 本模型是按次计费，只保留 resolution 供展示。
  usageExamples: [
    { label: "480p", facts: { resolution: "480p" } },
    { label: "720p", facts: { resolution: "720p" } },
  ],
};

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

function unwrapQueryResult(res) {
  // 宿主把上游 JSON **直接**作为第二个参数传入（不是 {status, body} 包装）；老写法一律当包装处理会
  // 得到 payload=undefined → 落到兜底分支（vinted 表现为「30% + 上游响应暂时异常」，永远不完成）。
  if (res === null || res === undefined) return { payload: null, status: 0 };
  if (typeof res === "string") {
    try { return { payload: JSON.parse(res), status: 200 }; } catch (e) { return { payload: null, status: 0 }; }
  }
  if (typeof res === "object" && res.body !== undefined) {
    var inner = res.body;
    if (typeof inner === "string") {
      try { inner = JSON.parse(inner); } catch (e) { inner = null; }
    }
    return { payload: inner, status: Number(res.status) || 200 };
  }
  return { payload: res, status: 200 };
}

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function channelBaseUrl(ctx) {
  return stripTrailingSlash(trimmed(ctx && ctx.baseUrl) || DEFAULT_BASE_URL) || DEFAULT_BASE_URL;
}

function absoluteUrl(base, path) {
  var raw = trimmed(path);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.charAt(0) === "/") return stripTrailingSlash(base) + raw;
  return stripTrailingSlash(base) + "/" + raw;
}

function jsonHeaders(apiKey) {
  var key = trimmed(apiKey);
  var headers = { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" };
  if (key) headers.Authorization = /^Bearer\s/i.test(key) ? key : "Bearer " + key;
  return headers;
}

function specOf(model) {
  var name = trimmed(model);
  if (!name) return null;
  if (MODEL_SPECS[name]) return MODEL_SPECS[name];
  var lower = name.toLowerCase();
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === lower) return MODEL_SPECS[MODELS[i]];
  }
  return null;
}

function canonicalModel(model) {
  var name = trimmed(model);
  if (MODEL_SPECS[name]) return name;
  var lower = name.toLowerCase();
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === lower) return MODELS[i];
  }
  return name;
}

/* ------------------------------------------------------------------ *
 * 请求体解码
 * ------------------------------------------------------------------ */

function decodeAnyObject(body) {
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { return { req: {}, files: [] }; }
  }
  if (!body || typeof body !== "object") return { req: {}, files: [] };
  if (body.kind === "multipart") {
    var fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    var req = {};
    var keys = Object.keys(fields);
    for (var i = 0; i < keys.length; i += 1) {
      var value = fields[keys[i]];
      req[keys[i]] = Array.isArray(value) && value.length === 1 ? value[0] : value;
    }
    return { req: req, files: Array.isArray(body.files) ? body.files : [] };
  }
  if (body.kind === "json") {
    return {
      req: body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value : {},
      files: [],
    };
  }
  return { req: body.value && typeof body.value === "object" ? body.value : body, files: [] };
}

function fieldOf(req, key) {
  if (!req || typeof req !== "object") return undefined;
  if (req[key] !== undefined && req[key] !== null) return req[key];
  var metadata = req.metadata;
  if (metadata && typeof metadata === "object" && metadata[key] !== undefined && metadata[key] !== null) {
    return metadata[key];
  }
  var extra = req.extra_body;
  if (extra && typeof extra === "object" && extra[key] !== undefined && extra[key] !== null) return extra[key];
  return undefined;
}

function requestTextParts(req) {
  var parts = [];
  var messages = req && req.messages;
  if (Array.isArray(messages)) {
    for (var i = 0; i < messages.length; i += 1) {
      var content = messages[i] && messages[i].content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (var j = 0; j < content.length; j += 1) {
          var item = content[j];
          if (typeof item === "string") parts.push(item);
          else if (item && typeof item === "object" && typeof item.text === "string") parts.push(item.text);
        }
      }
    }
  }
  if (typeof (req && req.input) === "string") parts.push(req.input);
  return parts.filter(function (s) { return trimmed(s); }).join("\n").trim();
}

/** 上游提示词用 `图N` 引用第 N 张参考图；客户端常见 @Image1 / @image1 / @图片1 / 参考图1。 */
function normalizeReferences(text) {
  return String(text || "")
    .replace(/@(?:image|img|图片|Image|IMAGE)\s*(\d{1,2})/g, "图$1")
    .replace(/参考图\s*(\d{1,2})/g, "图$1");
}

function clientPrompt(req) {
  var direct = trimmed(req && req.prompt) || trimmed(fieldOf(req, "prompt"));
  var text = direct || trimmed(requestTextParts(req));
  return normalizeReferences(text);
}

/* ------------------------------------------------------------------ *
 * 素材
 * ------------------------------------------------------------------ */

function mediaUrl(value) {
  if (typeof value === "string") return trimmed(value);
  if (!value || typeof value !== "object") return "";
  var keys = ["url", "image_url", "src", "uri", "file_url", "value"];
  for (var i = 0; i < keys.length; i += 1) {
    var candidate = value[keys[i]];
    if (typeof candidate === "string" && trimmed(candidate)) return trimmed(candidate);
    if (candidate && typeof candidate === "object" && typeof candidate.url === "string") {
      return trimmed(candidate.url);
    }
  }
  if (value.__fileRef) return "__file:" + trimmed(value.__fileRef);
  return "";
}

function collectMedia(values) {
  var out = [];
  var walk = function (value) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) walk(value[i]);
      return;
    }
    if (typeof value === "object") {
      var url = mediaUrl(value);
      if (url && out.indexOf(url) < 0) out.push(url);
      return;
    }
    var text = trimmed(value);
    if (text && out.indexOf(text) < 0) out.push(text);
  };
  for (var i = 0; i < values.length; i += 1) walk(values[i]);
  return out;
}

function requireHttps(list, label, max) {
  var ok = [];
  var rejected = [];
  for (var i = 0; i < list.length; i += 1) {
    var item = list[i];
    if (/^https:\/\//i.test(item)) ok.push(item);
    else if (/^http:\/\//i.test(item)) rejected.push("http 明文地址");
    else if (/^data:/i.test(item)) rejected.push("base64");
    else if (item.indexOf("__file:") === 0) rejected.push("已上传文件");
    else rejected.push("非公网地址");
  }
  if (rejected.length) {
    var unique = rejected.filter(function (v, idx) { return rejected.indexOf(v) === idx; });
    throw new Error(
      "Seedance 聚合的参考" + label + "只接受公网 https 地址，本次收到：" + unique.join("、") +
      "。请先把本地文件/base64 经「设置 → 视频 → 参考素材中转 → 自定义上传接口」转成公网直链" +
      "（如 https://img.qlike.top/v1/files），或改用图床 / OSS 的 https 链接后重试。"
    );
  }
  if (max && ok.length > max) {
    throw new Error("Seedance 聚合参考" + label + "最多 " + max + " 个，本次提交 " + ok.length + " 个，请删减后重试");
  }
  return ok;
}

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

function gcd(a, b) {
  var x = Math.abs(a);
  var y = Math.abs(b);
  while (y) {
    var t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function sizeToRatio(req) {
  var size = trimmed(req && req.size) || trimmed(fieldOf(req, "size"));
  var m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(size);
  if (!m) return "";
  var w = Number(m[1]);
  var h = Number(m[2]);
  if (!w || !h) return "";
  var g = gcd(w, h);
  var derived = w / g + ":" + h / g;
  if (RATIOS.indexOf(derived) >= 0) return derived;
  if (Math.abs(w / h - 21 / 9) < 0.12) return "21:9";
  if (Math.abs(w / h - 16 / 9) < 0.12) return "16:9";
  if (Math.abs(w / h - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(w / h - 4 / 3) < 0.1) return "4:3";
  if (Math.abs(w / h - 3 / 4) < 0.1) return "3:4";
  if (Math.abs(w / h - 1) < 0.08) return "1:1";
  return "";
}

function pickRatio(req) {
  var raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio")) || trimmed(fieldOf(req, "aspect"));
  if (raw) {
    var norm = raw.replace(/\s*[x×*]\s*/i, ":");
    if (RATIOS.indexOf(norm) >= 0) return norm;
    throw new Error("Seedance 聚合支持的画幅是 " + RATIOS.join(" / ") + "，收到：" + raw);
  }
  return sizeToRatio(req) || "16:9";
}

function pickResolution(req, spec, explicitOnly) {
  var raw = trimmed(req && req.resolution) || trimmed(fieldOf(req, "resolution")) ||
    trimmed(req && req.quality) || trimmed(fieldOf(req, "quality"));
  var chosen = "";
  if (raw) {
    var norm = raw.toLowerCase().replace(/\s/g, "");
    if (RESOLUTIONS.indexOf(norm) < 0) {
      throw new Error("Seedance 2.5 Plus 只支持 480p / 720p，收到：" + raw);
    }
    chosen = norm;
  } else if (!explicitOnly) {
    // 客户端没传分辨率时，才允许用 size 短边兜底
    var size = trimmed(req && req.size) || trimmed(fieldOf(req, "size"));
    var m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(size);
    if (m) {
      var shortSide = Math.min(Number(m[1]) || 0, Number(m[2]) || 0);
      if (shortSide >= 700) chosen = "720p";
      else if (shortSide > 0) chosen = "480p";
    }
  }
  return chosen || spec.defaultResolution;
}

function pickDuration(req) {
  var candidates = [
    req && req.duration, req && req.durationSeconds, req && req.seconds,
    fieldOf(req, "duration"), fieldOf(req, "durationSeconds"), fieldOf(req, "seconds"),
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = Number(candidates[i]);
    if (Number.isFinite(value) && value > 0) {
      var rounded = Math.round(value);
      if (rounded < DURATION_MIN) return DURATION_MIN;
      if (rounded > DURATION_MAX) return DURATION_MAX;
      return rounded;
    }
  }
  return 5;
}

/* ------------------------------------------------------------------ *
 * 提交
 * ------------------------------------------------------------------ */

function buildVideoBody(ctx, req, model) {
  var spec = specOf(model);
  if (!spec) {
    throw new Error("vinted 插件只声明了 " + MODELS.join(" / ") + "，收到：" + model);
  }
  var prompt = clientPrompt(req);
  if (!prompt) {
    // 网关侧直接拒：0ms、不打上游、不扣积分
    throw new Error("提示词不能为空：请在请求里给出 prompt（或 messages）");
  }
  if (prompt.length > MAX_PROMPT) {
    throw new Error("提示词最多 " + MAX_PROMPT + " 字符，本次 " + prompt.length + " 字符，请精简后重试");
  }

  var images = requireHttps(collectMedia([
    req.images, req.image, req.image_urls, req.reference_images, req.reference_image,
    req.image_url, req.image_list, req.material_urls, req.input_reference, req.input_references,
    req.first_frame_url, req.first_frame, req.start_frame, req.last_frame_url, req.last_frame, req.end_frame,
    fieldOf(req, "images"), fieldOf(req, "image"), fieldOf(req, "image_urls"),
    fieldOf(req, "reference_images"), fieldOf(req, "input_reference"),
  ]), "图片", MAX_IMAGES);

  var videos = requireHttps(collectMedia([
    req.videos, req.video, req.video_urls, req.reference_videos, req.reference_video,
    fieldOf(req, "videos"), fieldOf(req, "video_urls"), fieldOf(req, "reference_videos"),
  ]), "视频", MAX_VIDEOS);

  var audios = requireHttps(collectMedia([
    req.audios, req.audio, req.audio_urls, req.reference_audios, req.reference_audio,
    fieldOf(req, "audios"), fieldOf(req, "audio_urls"), fieldOf(req, "reference_audios"),
  ]), "音频", MAX_AUDIOS);

  var mixed = images.length + videos.length + audios.length;
  if (mixed > MAX_MIXED) {
    throw new Error("参考素材三类合计最多 " + MAX_MIXED + " 个，本次提交 " + mixed + " 个，请删减后重试");
  }

  var body = {
    model: UPSTREAM_MODEL,
    prompt: prompt,
    duration: pickDuration(req),
    resolution: pickResolution(req, spec),
    ratio: pickRatio(req),
  };
  if (images.length) body.images = images;
  if (videos.length) body.videos = videos;
  if (audios.length) body.audios = audios;
  return body;
}

/** 同步 128 位指纹（FNV-1a 变体四路混合），用于幂等键，避免依赖异步 WebCrypto */
function contentHash(text) {
  var h1 = 0x811c9dc5, h2 = 0x1000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (var i = 0; i < text.length; i += 1) {
    var c = text.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 + c) * 2654435761) >>> 0;
    h3 = (((h3 << 5) + h3 + c) ^ (h3 >>> 11)) >>> 0;
    h4 = (((h4 ^ c) * 1103515245) + 12345) >>> 0;
  }
  return [h1, h2, h3, h4].map(function (h) { return ("00000000" + h.toString(16)).slice(-8); }).join("");
}

/** 幂等键 = 内容指纹 + 10 分钟时间窗：超时重试复用同一键，10 分钟后同提示词再点即为新任务 */
function idempotencyKeyFor(body) {
  var stamp = Math.floor(Date.now() / 600000).toString(36);
  return "vik_" + contentHash(JSON.stringify(body) + "|" + stamp).slice(0, 40);
}

function idempotencyKey() {
  var stamp = Date.now().toString(36);
  var rand = Math.random().toString(36).slice(2, 10);
  return "vt_" + stamp + "_" + rand;
}

export function buildSubmitRequest(ctx) {
  var req = decodeAnyObject(ctx && ctx.body).req;
  var model = canonicalModel(trimmed(ctx && ctx.model) || fieldOf(req, "model") ||
    trimmed(ctx && ctx.requestBody && ctx.requestBody.model));
  var body = buildVideoBody(ctx, req, model);
  var headers = jsonHeaders(ctx && ctx.apiKey);
  // 内容 + 10 分钟窗口派生：上游 504/超时后用同样参数重试 → 命中同一操作编号 → 返回原任务，不重复扣费
  headers["Idempotency-Key"] = idempotencyKeyFor(body);
  return {
    url: channelBaseUrl(ctx) + "/v1/videos/generations",
    method: "POST",
    headers: headers,
    body: body,
    model: model,
  };
}

/* ------------------------------------------------------------------ *
 * 响应解析
 * ------------------------------------------------------------------ */

function dig(object, paths) {
  for (var i = 0; i < paths.length; i += 1) {
    var path = paths[i];
    var cur = object;
    var parts = path.split(".");
    var ok = true;
    for (var j = 0; j < parts.length; j += 1) {
      if (cur === null || cur === undefined || typeof cur !== "object") { ok = false; break; }
      cur = cur[parts[j]];
    }
    if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

function pickTaskId(payload) {
  var id = dig(payload, ["id", "taskId", "task_id", "job_id", "jobId", "data.id"]);
  return id === undefined ? "" : trimmed(id);
}

function pickStatus(payload) {
  return trimmed(dig(payload, ["status", "state", "provider_state", "data.status"])).toLowerCase();
}

function pickDownloadPath(payload) {
  return trimmed(dig(payload, [
    "download_url", "video_url", "file", "data.download_url",
    "result.actual.download_url", "result.download_url",
  ]));
}

/** 从宿主保存的任务体里取上游进度文案（宿主会把查询响应写回 task.data） */
/** 插件自有路由用的小写状态（小琪AI 等客户端按 queued/in_progress/completed/failed 归一） */
function nativeStatus(status) {
  var map = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued",
              IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
  var key = trimmed(status).toUpperCase();
  return map[key] || trimmed(status).toLowerCase();
}

function upstreamProgressText(task) {
  var data = (task && task.data) || {};
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { data = {}; }
  }
  var text = trimmed(dig(data, ["progress.message", "provider_error.message", "message"]));
  if (text) return text;
  var ps = trimmed(dig(data, ["provider_state", "progress.state", "state", "status"])).toLowerCase();
  var map = { queued: "排队中", pending: "排队中", running: "生成中", processing: "生成中",
              generating: "生成中", in_progress: "生成中", unknown: "核对中", uncertain: "核对中",
              verifying: "核对中", polling: "核对中", succeeded: "已完成", completed: "已完成",
              success: "已完成", failed: "已失败", failure: "已失败", cancelled: "已取消" };
  return map[ps] || ps;
}

/** 上游进度文案：progress.message / progress.state / provider_state，给客户端展示用 */
function pickProgressMessage(payload) {
  var m = dig(payload, ["progress.message", "provider_error.message"]);
  var text = trimmed(typeof m === "string" ? m : "");
  if (text) return text;
  var ps = trimmed(dig(payload, ["provider_state", "progress.state"]));
  var map = { queued: "排队中", running: "生成中", unknown: "核对中", uncertain: "核对中",
              succeeded: "已完成", failed: "已失败" };
  return map[ps] || ps;
}

function pickErrorMessage(payload) {
  var m = dig(payload, [
    "error.message", "provider_error.message", "progress.message", "message",
    "errorMessage", "msg", "detail", "error", "data.message", "data.error",
  ]);
  var code = dig(payload, ["error.code", "error_code", "code", "data.code"]);
  var text = typeof m === "string" ? trimmed(m) : m && typeof m === "object" ? trimmed(m.message) : "";
  var c = trimmed(code);
  if (c && text && c !== text) return c + "：" + text;
  return text || c;
}

export function parseSubmitResponse(ctx, res) {
  var payload = res && res.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  var status = Number(res && res.status) || 0;
  if (status >= 400 || !payload || typeof payload !== "object") {
    var upstreamDown = status === 0 || status === 408 || status === 504 || status >= 500 ||
      (payload && typeof payload === "object" && payload.cloudflare_error === true);
    if (upstreamDown) {
      throw new Error("Seedance 聚合上游网关超时或暂时不可用（HTTP " + status + "）。" +
        "任务可能已在上游受理：用完全相同的参数重试会自动复用同一幂等键，上游返回原任务、不会重复扣费；" +
        "也可先在 vinted.cam 后台核对是否已有该任务。");
    }
    throw new Error("Seedance 聚合创建任务失败：" +
      (pickErrorMessage(payload) || ("上游返回 HTTP " + status)));
  }
  var taskId = pickTaskId(payload);
  if (!taskId) {
    throw new Error("Seedance 聚合创建任务的响应里取不到任务 ID（约定字段 id）。原始响应：" +
      JSON.stringify(payload).slice(0, 400));
  }
  return {
    taskId: taskId,
    taskData: payload,
    state: { __outbound: buildOutboundSnapshot(ctx, payload) },
  };
}

function buildOutboundSnapshot(ctx, payload) {
  try {
    var req = decodeAnyObject(ctx && ctx.body).req;
    var model = canonicalModel(trimmed(ctx && ctx.model) || fieldOf(req, "model"));
    var body = buildVideoBody(ctx, req, model);
    return {
      plugin: "vinted",
      version: "1.0.8",
      url: channelBaseUrl(ctx) + "/v1/videos/generations",
      method: "POST",
      body: body,
      bytes: JSON.stringify(body).length,
      responseId: pickTaskId(payload),
    };
  } catch (e) {
    return {
      plugin: "vinted",
      version: "1.0.8",
      error: "未能复算上游报文：" + (e && e.message ? e.message : String(e)),
    };
  }
}

/* ------------------------------------------------------------------ *
 * 查询 / 结果
 * ------------------------------------------------------------------ */

export function buildQueryRequest(ctx) {
  var taskId = trimmed(ctx && (ctx.taskId || ctx.upstreamTaskId || ctx.task_id));
  if (!taskId) throw new Error("Seedance 聚合查询任务缺少 taskId");
  return {
    url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(taskId),
    method: "GET",
    headers: jsonHeaders(ctx && ctx.apiKey),
  };
}

var FAILED = ["failed", "failure", "error", "cancelled", "canceled", "timeout", "rejected", "expired", "deleted"];
var RUNNING = ["queued", "pending", "running", "processing", "generating", "in_progress", "inprogress",
  "submitting", "recovering", "verifying", "checking", "reviewing", "auditing", "uncertain"];

export function parseTaskResult(ctx, res) {
  var unwrapped = unwrapQueryResult(res);
  var payload = unwrapped.payload;
  var httpStatus = unwrapped.status;
  // 上游「核对中」阶段会短暂返回空体 / 网关抽风给 0 / 5xx：这些都不是任务失败，
  // 让宿主继续轮询；只有明确的 4xx 业务错误才判失败。
  var transient = httpStatus === 0 || httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
  if (!payload || typeof payload !== "object") {
    if (transient || httpStatus < 400) return { status: "IN_PROGRESS", progress: "30%", message: "上游响应暂时异常，继续轮询" };
    return {
      status: "FAILURE",
      reason: "Seedance 聚合查询失败：" + (pickErrorMessage(payload) || ("上游返回 HTTP " + httpStatus)),
    };
  }
  if (httpStatus >= 400) {
    if (transient) return { status: "IN_PROGRESS", progress: "30%", message: "上游响应暂时异常，继续轮询" };
    return {
      status: "FAILURE",
      reason: "Seedance 聚合查询失败：" + (pickErrorMessage(payload) || ("上游返回 HTTP " + httpStatus)),
    };
  }

  var state = pickStatus(payload);
  var upstreamMessage = pickProgressMessage(payload);
  var path = pickDownloadPath(payload);
  var url = path ? absoluteUrl(channelBaseUrl(ctx), path) : "";

  // 失败但已补交原片（refunded=true + has_file=true）按成功交付，绝不能重开新单
  var recovered = payload.recovered_artifact && payload.recovered_artifact.available === true;
  if (state === "succeeded" || (FAILED.indexOf(state) >= 0 && payload.has_file === true && recovered)) {
    if (url) return { status: "SUCCESS", url: url, progress: "100%", message: upstreamMessage };
    return { status: "SUCCESS", progress: "100%", message: upstreamMessage };
  }
  if (FAILED.indexOf(state) >= 0) {
    var reason = pickErrorMessage(payload) || ("任务状态 " + state);
    if (payload.refunded === true) reason += "（上游已退回积分）";
    return { status: "FAILURE", reason: reason, message: upstreamMessage };
  }
  if (RUNNING.indexOf(state) >= 0) {
    var progress = state === "queued" || state === "pending" ? "10%" : "50%";
    if (state === "running" || state === "generating" || state === "in_progress") progress = "60%";
    return { status: state === "queued" || state === "pending" ? "QUEUED" : "IN_PROGRESS",
             progress: progress, message: upstreamMessage };
  }
  return { status: "IN_PROGRESS", progress: "30%", message: upstreamMessage };
}

/* ------------------------------------------------------------------ *
 * 宿主钩子
 * ------------------------------------------------------------------ */

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  return [{ key: "video", type: "video" }];
}

export function buildContentRequest(ctx) {
  var data = (ctx && ctx.data) || {};
  var taskId = trimmed(ctx && (ctx.upstreamTaskId || ctx.taskId)) || pickTaskId(data);
  if (!taskId) throw new Error("artifact_not_found");
  // 带 Bearer 直接打 /file 就能拿到 MP4（已实测 200 + video/mp4），不必依赖短期签名链接
  return {
    url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(taskId) + "/file",
    method: "GET",
    headers: jsonHeaders(ctx && ctx.apiKey),
  };
}

export function extractUsage(ctx) {
  try {
    var req = decodeAnyObject(ctx && ctx.requestBody).req;
    var model = canonicalModel(trimmed(ctx && ctx.model) || fieldOf(req, "model"));
    var spec = specOf(model) || MODEL_SPECS[MODELS[0]];
    return { resolution: pickResolution(req, spec) };
  } catch (e) {
    return null;
  }
}

export const native = {
  decodeVideoSubmit: function (ctx) {
    return protocols.openai_video.decodeRequest(ctx);
  },
  taskCreated: function (ctx, task) {
    return protocols.openai_video.render(ctx, task);
  },
  taskStatus: function (_ctx, task) {
    var data = (task && task.data) || {};
    var output = {
      task_id: task && task.task_id,
      model: trimmed(data.model || ""),
      status: nativeStatus(task && task.status),
      progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      progress_text: upstreamProgressText(task),
    };
    if (trimmed(task && task.status) === "FAILURE") {
      output.progress_text = trimmed(task && task.fail_reason) || output.progress_text;
    }
    output.message = output.progress_text;
    var path = pickDownloadPath(data);
    if (task && task.status === "SUCCESS" && path) {
      output.result_url = absoluteUrl(channelBaseUrl(_ctx), path);
    }
    if (task && task.status === "FAILURE") {
      output.fail_reason = trimmed(task.fail_reason) || "task failed";
    }
    return output;
  },
  error: function (_ctx, error) {
    return {
      code: trimmed(error && error.code) || "upstream_error",
      message: trimmed(error && error.message),
    };
  },
};

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      var decoded = decodeAnyObject(ctx && ctx.body);
      var req = decoded.req;
      var files = decoded.files || [];
      var model = canonicalModel(trimmed(ctx && ctx.model) || fieldOf(req, "model") ||
        trimmed(ctx && ctx.requestBody && ctx.requestBody.model));
      if (!model) throw new Error("model is required");
      if (!specOf(model)) {
        throw new Error("vinted 插件只声明了 " + MODELS.join(" / ") + "，收到：" + model);
      }
      if (files.length) {
        throw new Error(
          "Seedance 聚合按公网 https 地址取素材，不支持直接上传文件；请先在「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 https://img.qlike.top/v1/files 转成公网直链后重试"
        );
      }
      var prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");
      req.prompt = prompt;
      return {
        kind: "submit",
        model: model,
        action: "video",
        requestBody: Object.assign({}, req, { model: model, prompt: prompt }),
      };
    },
    render: function (_ctx, task) {
      var statusMap = {
        QUEUED: "queued",
        SUBMITTED: "queued",
        NOT_START: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      var data = (task && task.data) || {};
      var output = {
        id: task && task.task_id,
        object: "video",
        model: trimmed(data.model || ""),
        status: statusMap[trimmed(task && task.status).toUpperCase()] || "queued",
        progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      };
      // 上游阶段文案（「核对中」/「排队中 · 已等待 X 秒」/「视频生成中」），供客户端原样展示；
      // 失败时用失败原因，避免把上一轮的「排队中」当成失败原因展示
      var upstreamText = trimmed(task && task.status) === "FAILURE"
        ? (trimmed(task && task.fail_reason) || trimmed(dig(data, ["fail_reason"])) || upstreamProgressText(task))
        : upstreamProgressText(task);
      output.progress_text = upstreamText;
      output.message = upstreamText;
      var path = pickDownloadPath(data);
      if (task && task.status === "SUCCESS" && path) {
        output.url = absoluteUrl(channelBaseUrl(_ctx), path);
      }
      if (task && task.status === "FAILURE") {
        output.error = { message: trimmed(task.fail_reason) || "task failed", code: "" };
      }
      return output;
    },
  },
};