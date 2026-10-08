/**
 * aicost API — NewAPI Task Plugin(纯视频)
 * Upstream: https://www.aicost.me  (New API relay: Seedance / MiniMax H3 视频)
 *
 * 只接「按次」计费的**视频**模型(按秒的 hs-/lec-/100% 系列不收;图片模型已于 1.0.6 移除)。
 *
 * 对外路径(下游调用方式):
 *   视频(宿主 openai_video 协议,标准路径):
 *     POST   /v1/videos                    创建任务
 *     GET    /v1/videos/:task_id           查询任务
 *     GET    /v1/videos/:task_id/content   下载视频
 *
 * 上游路径:
 *   POST /v1/videos                        创建视频任务
 *   GET  /v1/videos/{id}                   查询
 *   GET  /v1/videos/{id}/content           下载
 *
 * 变更记录:
 *   1.0.7  单一模型化:只保留 seedance2.0-900-fast(固定 15 秒 / 720P / fast,最多 9 张参考图)。
 *          原 5 个模型(seedance2.0-900-3 / seedance2.5-vid / seedance2.0-480p / seedance2.0-720p /
 *          seedance2.5-900)从声明中移除。视频链路(参考图 / 首尾帧 / H3 分支 / 直链下载)代码保留。
 *   1.0.6  纯视频化:删除全部图片功能(5 个图片模型 / 4 条图片路由 / GEMINI_IMAGE_MODELS / IMAGE_MODELS /
 *          isImageModel / isGeminiImageModel / GEMINI_PREFIX / SIZE_TABLE / resolveSize /
 *          geminiImageRequest / gptImageBody / decodeImageSubmit / decodeGeminiImageSubmit /
 *          decodeImageEditSubmit / imageResult / imageTaskStatus / extractImages / collectImageUrls /
 *          extractImagesFromChoices / submitIntent,以及产物与下载里的图片分支)。
 *          视频链路(参考图 / 首尾帧 / H3 / 下载)完全保留。
 */export const meta = {
  apiVersion: 1,
  key: "aicost",
  name: "aicost API",
  icon: "text:aicost",
  description: {
    en: "aicost.me relay: Seedance / MiniMax H3 video, per-call models only (video only).",
    zh: "aicost.me 中转:Seedance / MiniMax H3 视频,仅按次计费模型(纯视频)。",
  },
  version: "1.0.8",
  author: { name: "aicost API", url: "https://www.aicost.me/" },
  baseUrl: "https://www.aicost.me",
  models: ["seedance2.0-900-fast"],
  fetchMode: "per_task",
  allowedHosts: ["www.aicost.me", "aicost.me"],
  protocols: [
    {
      name: "openai_video",
      models: ["seedance2.0-900-fast"],
    },
  ],
  routes: [],
};

const DEFAULT_BASE_URL = "https://www.aicost.me";

const VIDEO_MODELS = {
  "seedance2.0-900-fast": true,
};

const H3_PREFIX = /^minimax-h3/i;

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function channelBaseUrl(ctx) {
  const base = stripTrailingSlash(ctx && ctx.baseUrl);
  return base || DEFAULT_BASE_URL;
}

function authorizationHeader(apiKey) {
  const key = trimmed(apiKey);
  if (!key) throw new Error("api key is required");
  if (/^Bearer\s+/i.test(key)) return key;
  return "Bearer " + key;
}

function jsonHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: authorizationHeader(apiKey),
  };
}

function authHeaders(apiKey) {
  return { Accept: "application/json", Authorization: authorizationHeader(apiKey) };
}

function isVideoModel(model) {
  const m = trimmed(model);
  return Boolean(VIDEO_MODELS[m]) || /^seedance/i.test(m) || /^sora-/i.test(m) || H3_PREFIX.test(m);
}

function isH3VideoModel(model) {
  return H3_PREFIX.test(trimmed(model));
}

/* ------------------------------------------------------------------ *
 * 通用取值
 * ------------------------------------------------------------------ */

function decodeJsonObject(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const body = ctx.body.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
  return body;
}

/** JSON 或 multipart 都要能吃:multipart 时文件用 {__fileRef} 占位,由宿主内联成 base64 */
function decodeAnyObject(body) {
  if (!body) throw new Error("request body is required");
  if (body.kind === "json") {
    const value = body.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request body must be an object");
    return { req: Object.assign({}, value), files: [] };
  }
  if (body.kind === "form" || body.kind === "multipart") {
    const req = {};
    const fields = body.fields || {};
    for (const name of Object.keys(fields)) {
      const values = fields[name] || [];
      req[name] = values.length > 1 ? values.slice() : values[0];
    }
    if (typeof req.metadata === "string") {
      try {
        req.metadata = JSON.parse(req.metadata);
      } catch (e) {
        throw new Error("metadata must be a JSON object string");
      }
    }
    for (const name of ["n", "seconds", "duration"]) {
      if (req[name] !== undefined && req[name] !== "") req[name] = Number(req[name]);
    }
    return { req: req, files: body.files || [] };
  }
  throw new Error("JSON or multipart body required");
}

function clientPrompt(req) {
  if (!req || req.prompt === undefined || req.prompt === null) return "";
  return String(req.prompt).trim();
}

function pickDuration(req) {
  if (!req || typeof req !== "object") return undefined;
  const raw = req.seconds !== undefined && req.seconds !== null && req.seconds !== "" ? req.seconds : req.duration;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function fieldOf(req, key) {
  const m = (req && req.metadata) || {};
  return req && req[key] !== undefined && req[key] !== null && req[key] !== "" ? req[key] : m[key];
}

function mediaUrl(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.__fileRef) return null;
    return trimmed(value.url) || trimmed(value.uri) || trimmed(value.image_url) || trimmed(value.imageUrl);
  }
  return trimmed(value);
}

/** 统一收集 URL/base64 素材,保留 {__fileRef} 占位 */
function collectMedia(values) {
  const out = [];
  const seen = {};
  const walk = function (value) {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      if (value.__fileRef) {
        out.push(value);
        return;
      }
      const url = mediaUrl(value);
      if (!url) return;
      if (seen[url]) return;
      seen[url] = true;
      out.push(url);
      return;
    }
    const url = trimmed(value);
    if (!url || seen[url]) return;
    seen[url] = true;
    out.push(url);
  };
  walk(values);
  return out;
}

function requestImages(req) {
  return collectMedia([req.image, req.images, req.image_url, req.image_urls, fieldOf(req, "image"), fieldOf(req, "images")]);
}

function requestTextParts(req) {
  const out = [];
  const push = function (v) {
    const s = trimmed(v);
    if (s) out.push(s);
  };
  push(fieldOf(req, "prompt"));
  if (!out.length && req.messages && Array.isArray(req.messages)) {
    for (const message of req.messages) {
      const content = message && message.content;
      if (typeof content === "string") push(content);
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (part && typeof part === "object" && part.type === "text") push(part.text);
        }
      }
    }
  }
  return out;
}

function resolveAspectRatio(req) {
  return trimmed(req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) || trimmed(req.ratio) || trimmed(fieldOf(req, "ratio"));
}

/* ------------------------------------------------------------------ *
 * native 钩子(插件自有路由)
 * ------------------------------------------------------------------ */

export const native = {
  decodeVideoSubmit: function (ctx) { return protocols.openai_video.decodeRequest(ctx); },
  renderVideo: function (ctx, task) { return protocols.openai_video.render(ctx, task); },
  taskCreated: function (ctx, task) { return protocols.openai_video.render(ctx, task); },
  taskStatus: function (ctx, task) { return protocols.openai_video.render(ctx, task); },
  error: function (_ctx, error) {
    return { error: { message: (error && error.message) || "request failed", type: "upstream_error", code: (error && error.code) || "" } };
  },
};

/* ------------------------------------------------------------------ *
 * 上游请求构造
 * ------------------------------------------------------------------ */

export function buildSubmitRequest(ctx) {
  const req = (ctx && ctx.requestBody) || {};
  const model = trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model) || trimmed(req.model);

  const body = buildVideoBody(ctx, req, model);
  return {
    url: channelBaseUrl(ctx) + "/v1/videos",
    method: "POST",
    headers: jsonHeaders(ctx.apiKey),
    body: body,
    action: "video",
  };
}

function buildVideoBody(ctx, req, model) {
  if (!trimmed(model)) throw new Error("model is required");
  const prompt = clientPrompt(req);
  if (!prompt) throw new Error("prompt is required");

  const body = { model: model, prompt: prompt };
  const duration = pickDuration(req);
  if (duration !== undefined) body.seconds = duration;

  const ratio = resolveAspectRatio(req);
  if (ratio) body.aspect_ratio = ratio;

  const resolution = trimmed(req.resolution) || trimmed(fieldOf(req, "resolution")) || trimmed(req.video_resolution);
  if (resolution) body.resolution = resolution;

  const size = trimmed(req.size) || trimmed(fieldOf(req, "size"));
  if (size) body.size = size;

  // 盐值AI「统一视频入口」协议:video_urls / audio_urls;老协议:videos / audios / videos_url 等兼容字段也认
  const images = collectMedia([req.image, req.images, req.image_urls, fieldOf(req, "image"), fieldOf(req, "images")]);
  const videos = collectMedia([req.videos, req.video_urls, fieldOf(req, "videos"), fieldOf(req, "video_urls")]);
  const audios = collectMedia([req.audios, req.audio_urls, fieldOf(req, "audios"), fieldOf(req, "audio_urls")]);
  const startFrame = trimmed(req.start_frame) || trimmed(fieldOf(req, "start_frame"));
  const endFrame = trimmed(req.end_frame) || trimmed(fieldOf(req, "end_frame"));
  const audioReference = collectMedia([req.audio_reference, req.audio_references, fieldOf(req, "audio_reference")]);

  if (isH3VideoModel(model)) {
    // MiniMax H3:普通图片参考字段是 reference_images;首尾帧与普通参考图互斥
    if (startFrame || endFrame) {
      if (startFrame) body.start_frame = startFrame;
      if (endFrame) body.end_frame = endFrame;
    } else if (images.length) {
      body.reference_images = images;
    }
    if (audioReference.length && body.reference_images) body.audio_reference = audioReference;
    if (req.audio !== undefined) body.audio = req.audio;
    if (videos.length) throw new Error("minimax-h3 不支持视频参考");
  } else {
    if (images.length) body.images = images;
    if (videos.length) body.videos = videos;
    if (audios.length) body.audios = audios;
  }
  return body;
}

/* ------------------------------------------------------------------ *
 * 上游响应解析
 * ------------------------------------------------------------------ */

/** 扫描整个请求体里所有与图片相关的字段,区分 公网URL / 上传文件 / base64,并记下字段名 */
function scanImageFields(req) {
  const out = { urls: [], urlCount: 0, uploaded: 0, base64: 0, fields: [] };
  const note = function (name) {
    if (name && out.fields.indexOf(name) < 0 && out.fields.length < 8) out.fields.push(name);
  };
  const consider = function (field, value) {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      for (const item of value) consider(field, item);
      return;
    }
    if (typeof value === "object") {
      if (value.__fileRef) {
        out.uploaded += 1;
        note(field + "(上传文件)");
        return;
      }
      const nested = trimmed(value.url) || trimmed(value.uri) || trimmed(value.image_url) || trimmed(value.imageUrl) || trimmed(value.image);
      if (!nested) return;
      consider(field, nested);
      return;
    }
    const text = String(value);
    if (/^https?:\/\//i.test(text)) {
      out.urlCount += 1;
      if (out.urls.length < 8) out.urls.push(text.length > 300 ? text.slice(0, 300) : text);
      note(field);
      return;
    }
    if (/^data:image\//i.test(text) || (text.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(text))) {
      out.base64 += 1;
      note(field + "(base64)");
    }
  };
  const walk = function (prefix, obj, depth) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 2) return;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const name = prefix ? prefix + "." + key : key;
      if (/image|img|reference|frame|mask|material|photo|picture/i.test(key)) {
        consider(name, value);
      } else if (value && typeof value === "object") {
        walk(name, value, depth + 1);
      }
    }
  };
  walk("", req, 0);
  const uploaded = (req && req.__uploaded) || [];
  for (const item of uploaded) {
    out.uploaded += 1;
    note((item && item.key ? item.key : "image") + "(上传文件)");
  }
  out.total = out.urlCount + out.uploaded + out.base64;
  return out;
}

/** 请求快照:写入 plugin_state,便于事后用 SQL 取回提示词与参数(不参与计费) */
function requestSnapshot(ctx) {
  const req = (ctx && ctx.requestBody) || {};
  const snap = {};
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model)) || trimmed(req.model);
  if (model) snap.model = model;
  const prompt = clientPrompt(req);
  if (prompt) snap.prompt = prompt;
  const secs = pickDuration(req);
  if (secs !== undefined) snap.seconds = secs;
  const ratio = resolveAspectRatio(req);
  if (ratio) snap.aspect_ratio = ratio;
  for (const key of ["resolution", "size", "quality", "output_format", "n"]) {
    const value = trimmed(req[key]) || trimmed(fieldOf(req, key));
    if (value) snap[key] = value;
  }
  const scan = scanImageFields(req);
  if (scan.urls.length) snap.reference_images = scan.urls;
  if (scan.total) snap.reference_images_count = scan.total;
  if (scan.uploaded) snap.reference_images_uploaded = scan.uploaded;
  if (scan.base64) snap.reference_images_base64 = scan.base64;
  if (scan.fields.length) snap.reference_image_fields = scan.fields;

  if (collectMedia([req.videos, req.video_urls, fieldOf(req, "videos"), fieldOf(req, "video_urls")]).length) snap.reference_videos = collectMedia([req.videos, req.video_urls, fieldOf(req, "videos"), fieldOf(req, "video_urls")]).length;
  if (collectMedia([req.audios, req.audio_urls, fieldOf(req, "audios"), fieldOf(req, "audio_urls")]).length) snap.reference_audios = collectMedia([req.audios, req.audio_urls, fieldOf(req, "audios"), fieldOf(req, "audio_urls")]).length;
  if (req && req.generate_audio !== undefined) snap.generate_audio = req.generate_audio;
  return snap;
}

/* ------------------------------------------------------------------ *
 * 上游报文快照(v3.21「生成日志」):把「将要发给上游的报文」复算一份脱敏副本,
 * 写进 plugin_state.__outbound。New API 只落插件写入的 plugin_state,不落上游报文体,
 * 面板「生成日志 → 视频详情」靠这份副本才能还原真实请求。
 * 只加字段:不参与计费、不改提交逻辑;复算失败只记 error,绝不抛。
 * ------------------------------------------------------------------ */
const OUTBOUND_MAX_CHARS = 16384;

function outboundScalar(value) {
  if (typeof value !== "string") return value;
  if (value.indexOf("data:") === 0 || value.indexOf(";base64,") >= 0) {
    return "<base64,约 " + Math.max(1, Math.round((value.length * 3) / 4 / 1024)) + "KB>";
  }
  if (value.length > 900) return "<超长值,约 " + value.length + " 字符>";
  return value;
}

function outboundShrink(value, depth) {
  if (depth > 6) return "<层级过深,已省略>";
  if (typeof value === "string") return outboundScalar(value);
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length && i < 12; i++) out.push(outboundShrink(value[i], depth + 1));
    if (value.length > 12) out.push("<其余 " + (value.length - 12) + " 项已省略>");
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length && i < 30; i++) {
      const k = keys[i];
      if (/key|token|secret|auth|password|cookie|apikey/i.test(k)) {
        out[k] = "***";
        continue;
      }
      out[k] = outboundShrink(value[k], depth + 1);
    }
    return out;
  }
  return value;
}

function outboundSnapshot(ctx) {
  const snap = { plugin: "aicost", version: "1.0.8" };
  let desc;
  try {
    desc = buildSubmitRequest(ctx);
  } catch (e) {
    snap.error = "未能复算上游报文:" + ((e && e.message) || String(e));
    return snap;
  }
  if (!desc) {
    snap.error = "未能复算上游报文";
    return snap;
  }
  if (desc.url) snap.url = String(desc.url);
  if (desc.method) snap.method = String(desc.method);
  if (desc.action) snap.action = String(desc.action);
  const body = desc.body !== undefined ? desc.body : desc.requestBody;
  const shrunk = outboundShrink(body, 0);
  let text = "";
  try {
    text = JSON.stringify(shrunk);
  } catch (e) {
    text = "";
  }
  if (!text || text.length > OUTBOUND_MAX_CHARS) {
    snap.body_omitted = "上游报文约 " + (text ? text.length : 0) + " 字符,超过 16KB 上限,已省略";
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const shallow = {};
      const keys = Object.keys(body);
      for (let i = 0; i < keys.length; i++) {
        const v = body[keys[i]];
        if (typeof v === "string") shallow[keys[i]] = outboundScalar(v);
        else if (typeof v === "number" || typeof v === "boolean") shallow[keys[i]] = v;
      }
      snap.body = shallow;
    }
  } else {
    snap.body = shrunk;
    snap.bytes = text.length;
  }
  return snap;
}

export function parseSubmitResponse(ctx, resp) {
  const root = (resp && resp.body) || {};
  if (root.error) {
    const message = typeof root.error === "string" ? root.error : trimmed(root.error.message) || "upstream error";
    throw new Error(message);
  }
  if (root.message && root.success === false) throw new Error(trimmed(root.message) || "upstream error");

  const taskId = trimmed(root.task_id) || trimmed(root.id);
  if (!taskId) throw new Error("missing task_id in upstream response");
  return { taskId: taskId, taskData: root, state: { request: requestSnapshot(ctx), __outbound: outboundSnapshot(ctx) } };
}

export function buildQueryRequest(ctx) {
  const base = channelBaseUrl(ctx);
  return {
    url: base + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: authHeaders(ctx.apiKey),
  };
}

function mapStatus(raw) {
  const value = trimmed(raw).toUpperCase();
  if (!value) return "UNKNOWN";
  if (value === "NOT_START" || value === "SUBMITTED" || value === "QUEUED" || value === "PENDING" || value === "CREATED") return "QUEUED";
  if (value === "IN_PROGRESS" || value === "RUNNING" || value === "PROCESSING") return "IN_PROGRESS";
  if (value === "SUCCESS" || value === "SUCCEEDED" || value === "COMPLETED") return "SUCCESS";
  if (value === "FAILURE" || value === "FAILED" || value === "ERROR" || value === "CANCELLED" || value === "CANCELED") return "FAILURE";
  return "UNKNOWN";
}

export function parseTaskResult(ctx, body) {
  const root = body && typeof body === "object" ? body : {};
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;

  if (data.error && !data.status && !data.task_id && !data.id) {
    const message = typeof data.error === "string" ? data.error : trimmed(data.error.message) || "upstream error";
    return { status: "FAILURE", reason: message };
  }

  const status = mapStatus(data.status || (data.task && data.task.status));
  if (status === "UNKNOWN") return { status: "UNKNOWN", reason: "unknown task status: " + trimmed(data.status) };

  const result = { status: status };
  const pct = Number(data.progress_pct !== undefined ? data.progress_pct : String(data.progress || "").replace("%", ""));
  if (Number.isFinite(pct) && pct >= 0) {
    const scaled = pct <= 1 && String(data.progress || "").indexOf("%") < 0 ? Math.round(pct * 100) : Math.round(pct);
    result.progress = String(Math.min(100, scaled)) + "%";
  }
  if (status === "FAILURE") {
    result.reason = trimmed(data.fail_reason) || trimmed(data.error_msg) || trimmed(data.error && data.error.message) || "";
  }
  if (status === "SUCCESS") {
    const urls = collectResultUrls(data);
    if (urls.length) result.url = urls[0];
  }
  return result;
}

function collectResultUrls(data) {
  const urls = [];
  const seen = {};
  const push = function (value) {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value && typeof value === "object") {
      const url = mediaUrl(value);
      if (url && /^https?:\/\//i.test(url)) push(url);
      return;
    }
    const url = trimmed(value);
    if (!url || !/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;
    urls.push(url);
  };
  if (data && typeof data === "object") {
    push(data.result_urls);
    push(data.result_url);
    push(data.url);
    push(data.video_url);
    push(data.content);
    push(data.output);
    if (data.data && typeof data.data === "object") {
      push(data.data.result_urls);
      push(data.data.result_url);
      push(data.data.url);
      push(data.data.video_url);
    }
  }
  return urls;
}

function artifactData(task) {
  const data = (task && task.data) || {};
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data) && (data.data.task_id || data.data.status)) {
    return data.data;
  }
  return data;
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const urls = collectResultUrls(artifactData(task));
  if (!urls.length) return [];
  return [{ key: "video", type: "video" }];
}

export function buildContentRequest(ctx) {
  const task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  const data = artifactData(task);

  const key = trimmed(ctx && ctx.artifactKey);
  if (key && key !== "video") throw new Error("artifact_not_found");

  const urls = collectResultUrls(data);
  if (urls.length) return { url: urls[0], method: "GET", credentialless: true };

  return {
    url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(ctx.taskId) + "/content",
    method: (ctx.clientRequest && ctx.clientRequest.method) || "GET",
    headers: authHeaders(ctx.apiKey),
  };
}

/* ------------------------------------------------------------------ *
 * 宿主 openai_video 协议(标准 /v1/videos)
 * ------------------------------------------------------------------ */

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      const decoded = decodeAnyObject(ctx.body);
      const req = decoded.req;
      const files = decoded.files || [];
      const model = trimmed(ctx.model);
      if (!model) throw new Error("model is required");

      const prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");
      req.prompt = prompt;

      const uploaded = [];
      for (const file of files) {
        const field = trimmed(file.field);
        if (field !== "input_reference" && field !== "image" && field !== "images") throw new Error("unexpected file field: " + field);
        uploaded.push({ key: "image", value: { __fileRef: "request_file:" + field, encoding: "dataUrl" } });
      }
      if (uploaded.length) {
        const existing = requestImages(req);
        req.image = existing.length ? existing.concat(uploaded.map(function (item) { return item.value; })) : uploaded.map(function (item) { return item.value; });
      }
      const duration = pickDuration(req);
      req.seconds = duration === undefined ? req.seconds : duration;

      return {
        kind: "submit",
        model: model,
        action: "video",
        requestBody: Object.assign({}, req, { model: model, prompt: prompt }),
      };
    },
    render: function (_ctx, task) {
      const statusMap = {
        NOT_START: "queued",
        SUBMITTED: "queued",
        QUEUED: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      const data = (task && task.data) || {};
      const output = {
        id: task && task.task_id,
        object: "video",
        model: trimmed(data.model),
        status: statusMap[trimmed(task && task.status).toUpperCase()] || "queued",
        progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      };
      if (task && task.status === "FAILURE") {
        output.error = { message: trimmed(task.fail_reason) || trimmed(data.fail_reason) || "task failed", code: "" };
      }
      return output;
    },
  },
};
