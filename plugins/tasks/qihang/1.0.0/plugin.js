/**
 * qihang (启航 统一 API) — NewAPI 任务插件 · 视频专用 · 按次计费
 * 上游: https://166683.xyz     文档: https://166683.xyz/docs/
 * OpenAPI: 2026-11-02 版（openapi.json 3.1.0）
 *
 * 上游协议 = 标准 OpenAI Videos,与宿主的 openai_video 协议几乎同构,
 * 因此本插件是「参数归一 + 透传」:不做协议转换,只把客户端各种别名
 * (duration / image_urls / ratio / @Image1)翻成上游字段。
 *
 * 对外路径(宿主 openai_video 协议):
 *   POST   /v1/videos                    创建任务
 *   GET    /v1/videos/:task_id           查询任务
 *   GET    /v1/videos/:task_id/content   下载视频
 * 插件自有路径(直连调试):
 *   POST   /qihang/v1/videos/generations
 *   GET    /qihang/v1/videos/tasks/:task_id
 *
 * 上游契约:
 *   POST /v1/videos
 *     { model, prompt, seconds, aspect_ratio, resolution?, images[]?, videos[]?, audios[]? }
 *     → VideoTask { id, object:"video", model, status, progress, created_at, completed_at, result_url, error }
 *   GET  /v1/videos/{id}          → 同上 VideoTask
 *   GET  /v1/videos/{id}/content  → video/mp4 二进制
 *   status ∈ queued | in_progress | completed | failed | unknown
 *   progress 是 0~100 的整数(不是 0~1 的小数)
 *
 * 模型清单(按用户指定,只声明这 2 个按次视频模型):
 *   seedance-2.0480p     $2.00/次  Seedance 2.0 Fast 480p,903,最长 15 秒,不卡人脸,
 *                                  最多 9 图 / 3 段音频
 *   Seedance-933-720p    $3.50/次  官渠可返官链,720P 原生过真人,4~15 秒,
 *                                  参考 9 图 / 0 视频 / 3 音频,提示词上限 15000 字,
 *                                  比例 9:16 / 16:9 / 1:1 / 4:3,平均 4~10 分钟
 *
 * 变更记录:
 *   1.0.0  首版:声明 2 个按次视频模型,标准 /v1/videos 透传 + 别名归一
 */

var DEFAULT_BASE_URL = "https://166683.xyz";

var MODELS = ["seedance-2.0480p", "Seedance-933-720p"];

var DURATION_MIN = 4;
var DURATION_MAX = 15;
var DURATION_DEFAULT = 5;
var IMAGE_MAX = 9;
var VIDEO_MAX = 0;
var AUDIO_MAX = 3;
var PROMPT_MAX = 15000;

var ASPECT_RATIOS = {
  "9:16": true,
  "16:9": true,
  "1:1": true,
  "4:3": true,
};

export const meta = {
  apiVersion: 1,
  key: "qihang",
  name: "启航 API",
  icon: "text:qh",
  description: {
    en: "Qihang unified API (166683.xyz) video generation, per-call models.",
    zh: "启航统一 API(166683.xyz)视频生成,仅按次计费模型。",
  },
  version: "1.0.0",
  author: { name: "Qihang API", url: "https://166683.xyz/docs/" },
  baseUrl: DEFAULT_BASE_URL,
  models: MODELS,
  fetchMode: "per_task",
  allowedHosts: ["166683.xyz"],
  protocols: [
    {
      name: "openai_video",
      models: MODELS,
    },
  ],
};

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function channelBaseUrl(ctx) {
  return stripTrailingSlash(trimmed(ctx && ctx.baseUrl) || DEFAULT_BASE_URL) || DEFAULT_BASE_URL;
}

function authorizationHeader(apiKey) {
  var key = trimmed(apiKey);
  if (!key) return {};
  return { Authorization: /^Bearer\s/i.test(key) ? key : "Bearer " + key };
}

function jsonHeaders(apiKey) {
  return Object.assign({ "Content-Type": "application/json" }, authorizationHeader(apiKey));
}

function isKnownModel(model) {
  var name = trimmed(model);
  if (!name) return false;
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === name.toLowerCase()) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 请求体解码(JSON / multipart)
 * ------------------------------------------------------------------ */

function decodeAnyObject(body) {
  if (!body || typeof body !== "object") return { req: {}, files: [] };
  if (body.kind === "multipart") {
    var fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    var req = {};
    var keys = Object.keys(fields);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var value = fields[key];
      req[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
    }
    return { req: req, files: Array.isArray(body.files) ? body.files : [] };
  }
  if (body.kind === "json") {
    return { req: body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value : {}, files: [] };
  }
  return { req: body.value && typeof body.value === "object" ? body.value : body, files: [] };
}

function decodeJsonObject(ctx) {
  return decodeAnyObject(ctx && ctx.body).req;
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
  var input = req && req.input;
  if (typeof input === "string") parts.push(input);
  return parts.filter(function (s) { return trimmed(s); }).join("\n").trim();
}

function clientPrompt(req) {
  var direct = trimmed(req && req.prompt) || trimmed(fieldOf(req, "prompt"));
  if (direct) return direct;
  return trimmed(requestTextParts(req));
}

/** 盐值AI 统一视频入口写 @Image1,上游认 @image1 —— 统一改小写 */
function normalizeReferences(prompt) {
  return prompt
    .replace(/@Image(\d+)/g, "@image$1")
    .replace(/@Video(\d+)/g, "@video$1")
    .replace(/@Audio(\d+)/g, "@audio$1");
}

/* ------------------------------------------------------------------ *
 * 素材
 * ------------------------------------------------------------------ */

function mediaUrl(value) {
  if (typeof value === "string") return trimmed(value);
  if (!value || typeof value !== "object") return "";
  var keys = ["url", "image_url", "video_url", "audio_url", "src", "uri", "file_url", "value"];
  for (var i = 0; i < keys.length; i += 1) {
    var candidate = value[keys[i]];
    if (typeof candidate === "string" && trimmed(candidate)) return trimmed(candidate);
    if (candidate && typeof candidate === "object" && typeof candidate.url === "string") return trimmed(candidate.url);
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

/**
 * 图片允许 http(s) URL 与 data: base64(上游 images 未限定 uri 格式);
 * 上传文件(__fileRef)拿不到内容,明确报错而不是静默丢弃。
 */
function checkImages(list) {
  var ok = [];
  var rejected = [];
  for (var i = 0; i < list.length; i += 1) {
    var item = list[i];
    if (/^https?:\/\//i.test(item) || /^data:image\//i.test(item)) ok.push(item);
    else if (item.indexOf("__file:") === 0) rejected.push("已上传文件");
    else rejected.push("非公网地址");
  }
  if (rejected.length) {
    var unique = rejected.filter(function (v, idx) { return rejected.indexOf(v) === idx; });
    throw new Error(
      "参考图片只接受公网 http(s) URL 或 data:image base64,本次收到:" + unique.join("、") +
      "。请在盐值AI「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 https://img.qlike.top/v1/files(本地文件会先转成公网直链),或改用图床 / OSS 地址后重试。"
    );
  }
  return ok;
}

/** videos / audios 上游明确要求 format: uri */
function requirePublicUrls(list, label) {
  var ok = [];
  var rejected = [];
  for (var i = 0; i < list.length; i += 1) {
    var item = list[i];
    if (/^https?:\/\//i.test(item)) ok.push(item);
    else if (item.indexOf("__file:") === 0) rejected.push("已上传文件");
    else rejected.push("非公网地址");
  }
  if (rejected.length) {
    var unique = rejected.filter(function (v, idx) { return rejected.indexOf(v) === idx; });
    throw new Error(
      "参考" + label + "必须是公网 http(s) URL,本次收到:" + unique.join("、") +
      "。请先用 img.qlike.top/v1/files 转成直链后重试。"
    );
  }
  return ok;
}

function limitOf(list, max, label) {
  if (list.length > max) {
    throw new Error("参考" + label + "最多 " + max + " 个,本次提交 " + list.length + " 个,请删减后重试");
  }
  return list;
}

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */

function pickSeconds(req) {
  var candidates = [req && req.seconds, req && req.duration, fieldOf(req, "seconds"), fieldOf(req, "duration")];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = Number(candidates[i]);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(value)));
    }
  }
  return DURATION_DEFAULT;
}

function resolveAspectRatio(req) {
  var raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (raw && ASPECT_RATIOS[raw]) return raw;
  if (/^\d{1,2}:\d{1,2}$/.test(raw)) return raw;
  return "16:9";
}

/**
 * 上游 body:标准 OpenAI Videos 形状,不做协议转换。
 * 返回 { body, plan } —— plan 供落库快照与排查。
 */
function buildVideoBody(ctx, req, model) {
  if (!trimmed(model)) throw new Error("model is required");

  var prompt = normalizeReferences(clientPrompt(req));
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > PROMPT_MAX) {
    throw new Error("提示词 " + prompt.length + " 字符,超过上游上限 " + PROMPT_MAX + " 字符,请精简后重试");
  }

  var images = collectMedia([
    req.image, req.images, req.image_urls, req.reference_images,
    fieldOf(req, "image"), fieldOf(req, "images"), fieldOf(req, "image_urls"),
  ]);
  var videos = collectMedia([
    req.videos, req.video_urls, req.reference_videos,
    fieldOf(req, "videos"), fieldOf(req, "video_urls"),
  ]);
  var audios = collectMedia([
    req.audios, req.audio_urls, req.audio_reference, req.audio_references,
    fieldOf(req, "audios"), fieldOf(req, "audio_urls"), fieldOf(req, "audio_reference"),
  ]);

  var publicImages = limitOf(checkImages(images), IMAGE_MAX, "图片");
  var publicVideos = limitOf(requirePublicUrls(videos, "视频"), VIDEO_MAX === 0 ? 0 : VIDEO_MAX, "视频");
  var publicAudios = limitOf(requirePublicUrls(audios, "音频"), AUDIO_MAX, "音频");

  var seconds = pickSeconds(req);
  var aspectRatio = resolveAspectRatio(req);

  var body = {
    model: model,
    prompt: prompt,
    seconds: seconds,
    aspect_ratio: aspectRatio,
  };
  if (publicImages.length) body.images = publicImages;
  if (publicVideos.length) body.videos = publicVideos;
  if (publicAudios.length) body.audios = publicAudios;

  var resolution = trimmed(req && req.resolution) || trimmed(fieldOf(req, "resolution"));
  if (resolution) body.resolution = resolution;

  return {
    body: body,
    plan: {
      prompt: prompt,
      seconds: seconds,
      aspectRatio: aspectRatio,
      imageCount: publicImages.length,
      videoCount: publicVideos.length,
      audioCount: publicAudios.length,
      images: publicImages,
      resolution: resolution,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 请求快照(写进 plugin_state,面板可回看)
 * ------------------------------------------------------------------ */

function scanClientImageFields(req) {
  var out = { urlCount: 0, uploaded: 0, base64: 0, fields: [] };
  var note = function (name) {
    if (name && out.fields.indexOf(name) < 0 && out.fields.length < 8) out.fields.push(name);
  };
  var consider = function (field, value) {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) consider(field, value[i]);
      return;
    }
    if (typeof value === "object") {
      if (value.__fileRef) { out.uploaded += 1; note(field + "(上传文件)"); return; }
      var nested = trimmed(value.url) || trimmed(value.uri) || trimmed(value.image_url) || trimmed(value.imageUrl) || trimmed(value.image);
      if (nested) {
        if (/^data:/i.test(nested)) { out.base64 += 1; note(field + "(base64)"); }
        else { out.urlCount += 1; note(field + "(URL)"); }
      }
      return;
    }
    var text = trimmed(value);
    if (!text) return;
    if (/^data:/i.test(text)) { out.base64 += 1; note(field + "(base64)"); }
    else if (/^https?:\/\//i.test(text)) { out.urlCount += 1; note(field + "(URL)"); }
  };
  var fields = ["image", "images", "image_urls", "reference_images", "first_frame_url", "start_frame", "last_frame_url", "end_frame"];
  for (var i = 0; i < fields.length; i += 1) {
    var field = fields[i];
    var direct = req && req[field] !== undefined ? req[field] : undefined;
    consider(field, direct !== undefined ? direct : fieldOf(req, field));
  }
  return out;
}

function requestSnapshot(ctx) {
  var req = decodeJsonObject(ctx);
  if (!req || Object.keys(req).length === 0) {
    // 宿主若没在 ctx.body 里给原始请求体，退回插件自己解析出的 requestBody
    var fallback = ctx && ctx.requestBody;
    if (fallback && typeof fallback === "object") req = fallback;
  }
  var images = scanClientImageFields(req);
  return {
    model: trimmed(ctx && ctx.model),
    upstream_model: trimmed(ctx && ctx.upstreamModel),
    prompt: trimmed(req && req.prompt).slice(0, 2000),
    seconds: pickSeconds(req),
    aspect_ratio: resolveAspectRatio(req),
    reference_images_sent: images.urlCount + images.uploaded + images.base64,
    reference_image_fields: images.fields,
    reference_images_uploaded: images.uploaded,
    reference_images_base64: images.base64,
    client_keys: Object.keys(req || {}).slice(0, 30),
  };
}

/**
 * 上游报文快照:复算 buildSubmitRequest 的 body,脱敏后写进 plugin_state.__outbound。
 * 五条硬要求:复算 / 绝不抛 / 脱敏 / 体积可控 / 只加字段。
 */
function outboundScalar(value) {
  if (typeof value === "string") {
    if (/^data:/i.test(value) || value.indexOf(";base64,") >= 0) return "<base64,约 " + Math.round(value.length / 1024) + "KB>";
    if (value.length > 900) return "<超长值,约 " + value.length + " 字符>";
    return value;
  }
  return value;
}

function outboundShrink(value, depth) {
  if (depth > 6) return "<深度截断>";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    var arr = [];
    for (var i = 0; i < value.length && i < 12; i += 1) arr.push(outboundShrink(value[i], depth + 1));
    if (value.length > 12) arr.push("<共 " + value.length + " 项>");
    return arr;
  }
  if (typeof value === "object") {
    var obj = {};
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length && k < 30; k += 1) {
      var key = keys[k];
      if (/key|token|secret|auth|password|cookie/i.test(key)) { obj[key] = "***"; continue; }
      obj[key] = outboundShrink(value[key], depth + 1);
    }
    if (keys.length > 30) obj.__more = "<共 " + keys.length + " 键>";
    return obj;
  }
  return outboundScalar(value);
}

function outboundSnapshot(ctx) {
  var desc;
  try {
    desc = buildSubmitRequest(ctx);
  } catch (e) {
    return { plugin: "qihang", version: "1.0.0", error: "未能复算上游报文:" + (e && e.message ? e.message : String(e)) };
  }
  var body = outboundShrink(desc.body, 0);
  var text = JSON.stringify(body);
  if (text && text.length > 16384) {
    var flat = {};
    var keys = Object.keys(desc.body || {});
    for (var i = 0; i < keys.length; i += 1) {
      var v = desc.body[keys[i]];
      if (typeof v === "object" && v !== null) flat[keys[i]] = "<已折叠,类型 " + (Array.isArray(v) ? "数组" + v.length : "对象") + ">";
      else flat[keys[i]] = outboundScalar(v);
    }
    return {
      plugin: "qihang", version: "1.0.0", url: desc.url, method: desc.method,
      body: flat, body_omitted: "报文整体超过 16KB,已降级为顶层标量字段",
      bytes: text.length,
    };
  }
  return {
    plugin: "qihang",
    version: "1.0.0",
    url: desc.url,
    method: desc.method,
    body: body,
    bytes: text ? text.length : 0,
  };
}

/* ------------------------------------------------------------------ *
 * 提交
 * ------------------------------------------------------------------ */

function submitIntent(ctx, action, requestBody) {
  return { kind: "submit", model: trimmed(ctx && ctx.model) || trimmed(requestBody && requestBody.model), action: action, requestBody: requestBody };
}

export function buildSubmitRequest(ctx) {
  var req = (ctx && ctx.requestBody) || {};
  var model = trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model) || trimmed(req.model);
  if (!model) throw new Error("model is required");
  if (!isKnownModel(model)) throw new Error("qihang 插件只声明了 " + MODELS.join(" / ") + ",收到:" + model);

  var built = buildVideoBody(ctx, req, model);
  return {
    url: channelBaseUrl(ctx) + "/v1/videos",
    method: "POST",
    headers: jsonHeaders(ctx && ctx.apiKey),
    body: built.body,
    action: "video",
  };
}

export function parseSubmitResponse(ctx, resp) {
  var root = (resp && resp.body) || {};
  var failure = upstreamError(root);
  if (failure) throw new Error(failure);

  var outer = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
  var taskId = trimmed(outer.id) || trimmed(root.id) || trimmed(outer.task_id) || trimmed(root.task_id);
  if (!taskId) {
    var message = trimmed(root.message) || trimmed(root.error && root.error.message);
    throw new Error(message || "missing task id in upstream response");
  }
  return {
    taskId: taskId,
    taskData: root,
    state: { request: requestSnapshot(ctx), __outbound: outboundSnapshot(ctx) },
  };
}

export function buildQueryRequest(ctx) {
  return {
    url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: authorizationHeader(ctx && ctx.apiKey),
  };
}

/* ------------------------------------------------------------------ *
 * 结果解析
 * ------------------------------------------------------------------ */

function upstreamError(root) {
  if (!root || typeof root !== "object") return "";
  var err = root.error;
  if (typeof err === "string" && trimmed(err)) return trimmed(err);
  if (err && typeof err === "object") {
    var msg = trimmed(err.message) || trimmed(err.code);
    if (msg) return msg;
  }
  if (root.success === false) return trimmed(root.message) || trimmed(root.msg) || "upstream error";
  var code = Number(root.code);
  if (Number.isFinite(code) && code !== 0 && code !== 200 && trimmed(root.message)) return trimmed(root.message);
  return "";
}

function layers(root) {
  var outer = root && root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : (root || {});
  var inner = outer && outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? outer.data : {};
  return { root: root || {}, outer: outer, inner: inner };
}

function mapStatus(raw) {
  var value = trimmed(raw).toUpperCase();
  if (!value) return "UNKNOWN";
  if (value === "QUEUED" || value === "QUEUEING" || value === "PENDING" || value === "SUBMITTED" || value === "CREATED" || value === "WAITING") return "QUEUED";
  if (value === "IN_PROGRESS" || value === "RUNNING" || value === "PROCESSING" || value === "GENERATING") return "IN_PROGRESS";
  if (value === "COMPLETED" || value === "SUCCESS" || value === "SUCCEEDED" || value === "DONE") return "SUCCESS";
  if (value === "FAILED" || value === "FAILURE" || value === "ERROR" || value === "CANCELLED" || value === "CANCELED" || value === "TIMEOUT") return "FAILURE";
  return "UNKNOWN";
}

/** 上游 progress 是 0~100 整数,直接取,不做 ×100 猜测 */
function progressOf(outer, inner) {
  var raw = outer.progress !== undefined ? outer.progress : inner.progress;
  if (raw === undefined || raw === null || raw === "") return "";
  var pct = Number(String(raw).replace("%", ""));
  if (!Number.isFinite(pct) || pct < 0) return "";
  return String(Math.min(100, Math.round(pct))) + "%";
}

function failureReason(root, outer, inner) {
  var err = outer.error || inner.error;
  if (err && typeof err === "object") {
    var m = trimmed(err.message) || trimmed(err.code);
    if (m) return m;
  }
  if (typeof err === "string" && trimmed(err)) return trimmed(err);
  var candidates = [outer.fail_reason, inner.fail_reason, inner.message, outer.message];
  for (var i = 0; i < candidates.length; i += 1) {
    var text = trimmed(candidates[i]);
    if (text && !/^https?:\/\//i.test(text)) return text;
  }
  return trimmed(root && root.message) || "";
}

function collectResultUrls(outer, inner) {
  var urls = [];
  var seen = {};
  var push = function (value) {
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) push(value[i]);
      return;
    }
    if (value && typeof value === "object") { push(mediaUrl(value)); return; }
    var url = trimmed(value);
    if (!url || !/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;
    urls.push(url);
  };
  push(outer.result_url);
  push(outer.result_urls);
  push(outer.url);
  push(inner.result_url);
  push(inner.url);
  push(inner.output);
  push(inner.creations);
  return urls;
}

export function parseTaskResult(ctx, body) {
  var root = body && typeof body === "object" ? body : {};
  var parts = layers(root);
  var outer = parts.outer;
  var inner = parts.inner;

  var rawStatus = trimmed(outer.status) || trimmed(inner.status) || trimmed(outer.state) || trimmed(inner.state);
  var status = mapStatus(rawStatus);

  if (status === "UNKNOWN") {
    var failure = upstreamError(root);
    if (failure) return { status: "FAILURE", reason: failure };
    if (!rawStatus) return { status: "UNKNOWN", reason: "upstream returned no status" };
    return { status: "UNKNOWN", reason: "unknown task status: " + rawStatus };
  }

  var result = { status: status };
  var progress = progressOf(outer, inner);
  if (progress) result.progress = progress;
  if (status === "FAILURE") result.reason = failureReason(root, outer, inner) || "task failed";
  if (status === "SUCCESS") {
    var urls = collectResultUrls(outer, inner);
    if (urls.length) result.url = urls[0];
  }
  return result;
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  var parts = layers((task && task.data) || {});
  var urls = collectResultUrls(parts.outer, parts.inner);
  return urls.length ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  var task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  var parts = layers((task && task.data) || {});
  var urls = collectResultUrls(parts.outer, parts.inner);
  // 上游成品优先返回无需 Key 的直链
  if (urls.length) return { url: urls[0], method: "GET", credentialless: true };
  var taskId = trimmed(ctx && ctx.taskId) || trimmed(task && task.task_id);
  if (taskId) {
    return {
      url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(taskId) + "/content",
      method: "GET",
      headers: authorizationHeader(ctx && ctx.apiKey),
    };
  }
  throw new Error("artifact_not_found");
}

/* ------------------------------------------------------------------ *
 * 插件自有路径呈现 + 宿主 openai_video 协议
 * ------------------------------------------------------------------ */

export const native = {
  decodeVideoSubmit: function (ctx) {
    return protocols.openai_video.decodeRequest(ctx);
  },
  taskCreated: function (ctx, task) {
    return protocols.openai_video.render(ctx, task);
  },
  taskStatus: function (_ctx, task) {
    var parts = layers((task && task.data) || {});
    var output = {
      task_id: task && task.task_id,
      model: trimmed(parts.inner.model) || trimmed(parts.outer.model),
      status: task && task.status,
      progress: (task && task.progress) || "0%",
    };
    if (task && task.status === "SUCCESS") {
      var urls = collectResultUrls(parts.outer, parts.inner);
      if (urls.length) output.result_url = urls[0];
    }
    if (task && task.status === "FAILURE") {
      output.fail_reason = trimmed(task.fail_reason) || trimmed(parts.outer.fail_reason) || "task failed";
    }
    return output;
  },
  error: function (_ctx, error) {
    return { code: trimmed(error && error.code) || "upstream_error", message: trimmed(error && error.message) };
  },
};

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      var decoded = decodeAnyObject(ctx && ctx.body);
      var req = decoded.req;
      var files = decoded.files || [];
      var model = trimmed(ctx && ctx.model);
      if (!model) throw new Error("model is required");
      if (files.length) {
        throw new Error(
          "qihang 上游按公网 URL 取素材,不支持直接上传文件;请在盐值AI「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 https://img.qlike.top/v1/files 转成公网直链后重试"
        );
      }

      var prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");
      req.prompt = prompt;
      req.seconds = pickSeconds(req);

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
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      var data = (task && task.data) || {};
      var parts = layers(data);
      var output = {
        id: task && task.task_id,
        object: "video",
        model: trimmed(parts.inner.model) || trimmed(parts.outer.model),
        status: statusMap[trimmed(task && task.status).toUpperCase()] || "queued",
        progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      };
      if (task && task.status === "SUCCESS") {
        var urls = collectResultUrls(parts.outer, parts.inner);
        if (urls.length) output.result_url = urls[0];
      }
      if (task && task.status === "FAILURE") {
        output.error = {
          message: trimmed(task.fail_reason) || trimmed(parts.outer.fail_reason) || "task failed",
          code: "",
        };
      }
      return output;
    },
  },
};
