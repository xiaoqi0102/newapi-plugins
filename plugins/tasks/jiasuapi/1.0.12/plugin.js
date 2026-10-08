/**
 * 佳速API — NewAPI Task Plugin (market install for other NewAPI instances).
 * Official site: https://ai.jiasuapi.com/
 *
 * Calls public endpoints only:
 *   POST /v1/video/generations  +  GET /v1/videos/tasks/:id
 * Base URL and API key come from the Task Plugin channel (ctx.baseUrl / ctx.apiKey).
 *
 * 变更记录:
 *   1.0.11 对齐站点新版《接口文档》与站点在售模型清单:
 *          · 声明模型收敛为站点在售的 7 个:seedance-2.0-900 / 2.5-900 / 2.5-101010 / 2.5-301010 /
 *            sd-2.0-933-720-fast-原生真人 / dola-sd-2.0-933 / minimax-h3-jiasu
 *            (下线声明:sd-2.0-720、sd-2.0-720-fast、sd-2.0-933-720-满血原生真人、seedance-2.0-933、seedance2.0-mini-A)
 *          · 新增 minimax-h3(上游真名),因平台「插件声明模型名全平台唯一(大小写不敏感)」限制,
 *            plugin 侧改用别名 minimax-h3-jiasu 声明,提交前由 MODEL_ALIASES 翻回 minimax-h3
 *          · minimax-h3 专用规格:时长 4~15(不传或越界按 15)、分辨率固定 2k、比例仅 9:16/1:1/3:4/4:3/16:9(越界按 16:9);
 *            参考图 ≤9、参考视频 ≤3、参考音频 ≤3(超限本地报中文错)
 *          · 参考视频/音频对象保留 duration_seconds 与 mime(文档:videos[].duration_seconds 不传按 5 秒计);
 *            新增 attachments 混合字段(与 images/videos/audios/materials 互斥,同时传本地报错)
 *   1.0.10 纯视频化:删除全部图片功能(3 个图片模型 / /v1/images/create + /v1/images/tasks 两条路由 /
 *          IMAGE_MODELS / isImageModel / decodeImageSubmit / buildImageBody / artifactIsImage /
 *          图片产物下载分支 / QUALITIES 与 outboundQuality)
 *   1.0.9  移除 5 个「-不重试」变体声明(seedance-2.0-900 / -2.0-933 / -2.5-900 / -2.5-101010 / -2.5-301010),
 *          meta.models / protocols / routes / VIDEO_MODELS 四处同步清理
 *   1.0.8  上游新增 seedance2.0-mini-A($1/次),补进 meta.models / protocols / routes / VIDEO_MODELS
 *          (上游 2026-09-28 起报价口径:seedance-2.0-900 0.7、seedance-2.0-933 1.3、
 *           seedance-2.5-900 0.8、seedance-2.5-301010 2)
 */
export const meta = {
  apiVersion: 1,
  key: "jiasuapi",
  name: "佳速API",
  icon: "text:佳速",
  description: {
    en: "JiasuAPI video media platform (video only). Official site: https://ai.jiasuapi.com/",
    zh: "佳速API中转平台（纯视频，含 minimax-h3 视频）。官方地址：https://ai.jiasuapi.com/",
  },
  version: "1.0.12",
  author: { name: "佳速API", url: "https://ai.jiasuapi.com/" },
  models: [
    "seedance-2.0-900",
    "seedance-2.5-900",
    "seedance-2.5-101010",
    "seedance-2.5-301010",
    "sd-2.0-933-720-fast-原生真人",
    "dola-sd-2.0-933",
    "minimax-h3-jiasu",
  ],
  fetchMode: "per_task",
  allowedHosts: [
    "ai.jiasuapi.com",
    "ai1.jiasuapi.com",
    "api.jiasuapi.com",
    "relay.jiasuapi.com",
    "m.jiasuapi.com",
    "media.jiasuapi.com",
  ],
  protocols: [
    {
      name: "openai_video",
      models: [
        "seedance-2.0-900",
        "seedance-2.5-900",
        "seedance-2.5-101010",
        "seedance-2.5-301010",
        "sd-2.0-933-720-fast-原生真人",
        "dola-sd-2.0-933",
        "minimax-h3-jiasu",
      ],
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/jiasuapi/v1/videos/generations",
      type: "submit",
      action: "video",
      decode: "decodeVideoSubmit",
      render: "taskCreatedJsapi",
      models: [
        "seedance-2.0-900",
        "seedance-2.5-900",
        "seedance-2.5-101010",
        "seedance-2.5-301010",
        "sd-2.0-933-720-fast-原生真人",
        "dola-sd-2.0-933",
        "minimax-h3-jiasu",
      ],
    },
    {
      method: "GET",
      path: "/jiasuapi/v1/videos/tasks/:task_id",
      type: "query",
      render: "taskStatusJsapi",
    },
  ],
};

const DEFAULT_BASE_URL = "https://ai.jiasuapi.com";

/**
 * 模型别名 → 上游真名。
 *
 * New API 对「插件声明的模型名」做**全平台唯一校验(大小写不敏感)**,所以站点自己的
 * `minimax-h3` 不能直接声明(g-aisc 插件已占用 MiniMax-H3)。这里声明成站点专属别名
 * `minimax-h3-jiasu`,提交前再翻回上游真名 `minimax-h3`。
 * 渠道侧照旧用「别名-价格」写法(client 看到的名字),model_mapping 指到本插件的声明名。
 */
const MODEL_ALIASES = {
  "minimax-h3-jiasu": "minimax-h3",
};

/** 声明名 → 上游真名(没有别名就原样) */
function upstreamModelName(name) {
  const key = trimmed(name);
  return MODEL_ALIASES[key] || key;
}

const VIDEO_MODELS = {
  "seedance-2.0-900": true,
  "seedance-2.5-900": true,
  "seedance-2.5-101010": true,
  "seedance-2.5-301010": true,
  "sd-2.0-933-720-fast-原生真人": true,
  "dola-sd-2.0-933": true,
  "minimax-h3-jiasu": true,
};

function trimmed(value) {
  return String(value || "").trim();
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
  return {
    Accept: "application/json",
    Authorization: authorizationHeader(apiKey),
  };
}

function isVideoModel(model) {
  const m = trimmed(model);
  return Boolean(VIDEO_MODELS[m]) || /^seedance-/i.test(m) || /^sd-2\./i.test(m) || /^dola-/i.test(m) || /^minimax-/i.test(m);
}

function decodeJsonObject(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const body = ctx.body.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be an object");
  }
  return body;
}

function clientPrompt(req) {
  if (!req || req.prompt === undefined || req.prompt === null) return "";
  return String(req.prompt).trim();
}

function pickRequestDuration(req) {
  if (!req || typeof req !== "object") return undefined;
  const raw =
    req.duration !== undefined && req.duration !== null && req.duration !== ""
      ? req.duration
      : req.seconds;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return raw;
}

function mediaUrl(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.__fileRef) return null;
    return trimmed(value.url) || trimmed(value.uri);
  }
  return trimmed(value);
}

function normalizeImageType(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return trimmed(value.type).toLowerCase();
}

/** Pass through images as URL strings or {url,name?,type?} objects. */
function normalizeMediaList(values) {
  const out = [];
  const walk = function (value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.__fileRef) {
        out.push(value);
        return;
      }
      const url = mediaUrl(value);
      if (!url) return;
      const item = { url: url };
      const name = trimmed(value.name);
      if (name) item.name = name;
      // 文档 H3 节:videos[].duration_seconds(不传按 5 秒)、audios[].mime —— 原样带上,别丢
      const seconds = Number(value.duration_seconds);
      if (Number.isFinite(seconds) && seconds > 0) item.duration_seconds = seconds;
      const mime = trimmed(value.mime);
      if (mime) item.mime = mime;
      const typ = normalizeImageType(value);
      if (typ === "first_frame") item.type = "first_frame";
      else if (typ === "end_frame" || typ === "last_frame") item.type = "end_frame";
      out.push(item);
      return;
    }
    const url = trimmed(value);
    if (url) out.push(url);
  };
  walk(values);
  return out;
}

function normalizeMaterials(values) {
  const out = [];
  const walk = function (value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const url = mediaUrl(value);
    if (!url && !value.__fileRef) return;
    const item = {};
    const typ = trimmed(value.type).toLowerCase();
    if (typ) item.type = typ;
    if (url) item.url = url;
    else if (value.__fileRef) item.__fileRef = value.__fileRef;
    const name = trimmed(value.name);
    if (name) item.name = name;
    out.push(item);
  };
  walk(values);
  return out;
}

function normalizeFace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  if (value.enabled !== undefined) out.enabled = Boolean(value.enabled);
  const mode = trimmed(value.mode).toLowerCase();
  if (mode === "light" || mode === "heavy") out.mode = mode;
  return Object.keys(out).length ? out : null;
}

function normalizeAttachments(values) {
  const out = [];
  const walk = function (value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const url = mediaUrl(value);
    if (!url && !value.__fileRef) return;
    const item = {};
    const typ = trimmed(value.type).toLowerCase();
    if (typ) item.type = typ;
    if (url) item.url = url;
    else if (value.__fileRef) item.__fileRef = value.__fileRef;
    const mime = trimmed(value.mime);
    if (mime) item.mime = mime;
    const seconds = Number(value.duration_seconds);
    if (Number.isFinite(seconds) && seconds > 0) item.duration_seconds = seconds;
    out.push(item);
  };
  walk(values);
  return out;
}

/** minimax-h3 专用规格(站点《接口文档》「H3 创建任务」节) */
const MINIMAX_H3 = {
  model: "minimax-h3",
  minSeconds: 4,
  maxSeconds: 15,
  defaultSeconds: 15,
  resolution: "2k", // 文档:分辨率固定 2k
  ratios: ["9:16", "1:1", "3:4", "4:3", "16:9"],
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
};

/** minimax-h3:时长/比例越界按文档默认值收敛(不报错),素材数量超限才报中文错 */
function applyMinimaxH3(body) {
  const n = Number(body.duration);
  if (!Number.isFinite(n) || n < MINIMAX_H3.minSeconds || n > MINIMAX_H3.maxSeconds) {
    body.duration = MINIMAX_H3.defaultSeconds; // 文档:不传或超出范围按 15
  } else {
    body.duration = Math.round(n);
  }
  body.resolution = MINIMAX_H3.resolution;
  const ratio = trimmed(body.ratio);
  if (MINIMAX_H3.ratios.indexOf(ratio) < 0) body.ratio = "16:9"; // 文档:不传或传其它值按 16:9
  const guard = function (list, max, label) {
    if (Array.isArray(list) && list.length > max) {
      throw new Error("minimax-h3 的参考" + label + "最多 " + max + " 个,本次提交 " + list.length + " 个,请删减后重试");
    }
  };
  guard(body.images, MINIMAX_H3.maxImages, "图");
  guard(body.videos, MINIMAX_H3.maxVideos, "视频");
  guard(body.audios, MINIMAX_H3.maxAudios, "音频");
}

function decodeNativeVideoSubmit(ctx) {
  const body = decodeJsonObject(ctx);
  const model = trimmed(body.model);
  if (!model) throw new Error("model is required");
  const prompt = clientPrompt(body);
  if (!prompt) throw new Error("prompt is required");
  const requestBody = Object.assign({}, body, { model: model, prompt: prompt });
  const picked = pickRequestDuration(body);
  if (picked !== undefined) requestBody.duration = Number(picked);
  return { kind: "submit", model: model, action: "video", requestBody: requestBody };
}

function taskCreatedJsapi(_ctx, task) {
  return {
    id: task.task_id,
    task_id: task.task_id,
    status: "queued",
    model: (task.properties && task.properties.origin_model_name) || "",
  };
}

function taskStatusJsapi(_ctx, task) {
  const statusMap = {
    NOT_START: "queued",
    SUBMITTED: "queued",
    QUEUED: "queued",
    IN_PROGRESS: "running",
    SUCCESS: "succeeded",
    FAILURE: "failed",
  };
  const data = task.data && typeof task.data === "object" ? task.data : {};
  const out = {
    id: task.task_id,
    task_id: task.task_id,
    status: statusMap[task.status] || "queued",
    progress_pct: Number(String(task.progress || "0").replace("%", "")) || 0,
    fail_reason: task.fail_reason || data.fail_reason || "",
  };
  const urls = collectResultUrls(data);
  if (urls.length) out.result_urls = urls;
  if (data.model) out.model = data.model;
  return out;
}

export const native = {
  decodeVideoSubmit: decodeNativeVideoSubmit,
  taskCreatedJsapi: taskCreatedJsapi,
  taskStatusJsapi: taskStatusJsapi,
  taskCreated: taskCreatedJsapi,
  taskStatus: taskStatusJsapi,
  error: function (_ctx, error) {
    return { error: error.message || "request failed", code: error.code || "" };
  },
};

function buildVideoBody(ctx, req) {
  const declared = ctx.upstreamModel || ctx.model || req.model || "";
  if (!trimmed(declared)) throw new Error("model is required");
  const model = upstreamModelName(declared);
  const prompt = clientPrompt(req);
  if (!prompt) throw new Error("prompt is required");

  const body = {
    model: model,
    prompt: prompt,
  };

  const picked = pickRequestDuration(req);
  if (picked !== undefined) body.duration = Number(picked);

  const metadata = (req && req.metadata) || {};
  const ratio =
    trimmed(req.ratio) ||
    trimmed(metadata.ratio) ||
    trimmed(req.aspect_ratio) ||
    trimmed(metadata.aspect_ratio);
  if (ratio) body.ratio = ratio;

  const resolution =
    trimmed(req.resolution) ||
    trimmed(metadata.resolution) ||
    trimmed(req.video_resolution) ||
    trimmed(metadata.video_resolution);
  if (resolution) body.resolution = resolution;

  const images = normalizeMediaList([req.images, metadata.images, req.image_urls, metadata.image_urls]);
  const singleImage = mediaUrl(req.image) || mediaUrl(req.input_reference) || mediaUrl(metadata.image);
  if (singleImage) {
    let dup = false;
    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      const u = typeof item === "string" ? item : item && item.url;
      if (u === singleImage) {
        dup = true;
        break;
      }
    }
    if (!dup) images.push(singleImage);
  }
  if (images.length) body.images = images;

  // 盐值AI「统一视频入口」协议用 video_urls / audio_urls;老协议用 videos / audios —— 两种字段名都认
  const videos = normalizeMediaList([req.videos, req.video_urls, metadata.videos, metadata.video_urls]);
  if (videos.length) body.videos = videos;

  const audios = normalizeMediaList([req.audios, req.audio_urls, metadata.audios, metadata.audio_urls]);
  if (audios.length) body.audios = audios;

  const materials = normalizeMaterials([req.materials, metadata.materials]);
  if (materials.length) body.materials = materials;

  // 文档「创建任务」:attachments 是 images/videos/audios/materials 的混合替代写法,两者不能同时用
  const attachments = normalizeAttachments([req.attachments, metadata.attachments]);
  if (attachments.length) {
    if (body.images || body.videos || body.audios || body.materials) {
      throw new Error(
        "attachments 不能与 images / videos / audios / materials 同时传(上游文档明写),请二选一"
      );
    }
    body.attachments = attachments;
  }

  const face = normalizeFace(req.face) || normalizeFace(metadata.face);
  if (face) body.face = face;

  if (upstreamModelName(body.model) === MINIMAX_H3.model) applyMinimaxH3(body);

  return body;
}

export function buildSubmitRequest(ctx) {
  const req = ctx.requestBody || {};
  const base = channelBaseUrl(ctx);

  return {
    url: base + "/v1/video/generations",
    method: "POST",
    headers: jsonHeaders(ctx.apiKey),
    body: buildVideoBody(ctx, req),
    action: "video",
  };
}

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
  const metadata = (req && req.metadata) || {};
  const snap = {};
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model)) || trimmed(req.model);
  if (model) snap.model = model;
  const prompt = clientPrompt(req);
  if (prompt) snap.prompt = prompt;
  const secs = pickRequestDuration(req);
  if (secs !== undefined) snap.seconds = Number(secs);
  const ratio = trimmed(req.ratio) || trimmed(metadata.ratio) || trimmed(req.aspect_ratio) || trimmed(metadata.aspect_ratio);
  if (ratio) snap.aspect_ratio = ratio;
  for (const key of ["resolution", "size"]) {
    const value = trimmed(req[key]) || trimmed(metadata[key]);
    if (value) snap[key] = value;
  }
  const scan = scanImageFields(req);
  if (scan.urls.length) snap.reference_images = scan.urls;
  if (scan.total) snap.reference_images_count = scan.total;
  if (scan.uploaded) snap.reference_images_uploaded = scan.uploaded;
  if (scan.base64) snap.reference_images_base64 = scan.base64;
  if (scan.fields.length) snap.reference_image_fields = scan.fields;

  const videos = normalizeMediaList([req.videos, req.video_urls, metadata.videos, metadata.video_urls]);
  const audios = normalizeMediaList([req.audios, req.audio_urls, metadata.audios, metadata.audio_urls]);
  if (videos.length) snap.reference_videos = videos.length;
  if (audios.length) snap.reference_audios = audios.length;
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
  const snap = { plugin: "jiasuapi", version: "1.0.12" };
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
  const result = resp.body || {};
  if (result.error) {
    const msg =
      typeof result.error === "string"
        ? result.error
        : trimmed(result.error.message) || "submit failed";
    throw new Error(msg);
  }
  const taskId = trimmed(result.task_id) || trimmed(result.id);
  if (!taskId) throw new Error("missing task_id");
  return { taskId: taskId, taskData: result, state: { request: requestSnapshot(ctx), __outbound: outboundSnapshot(ctx) } };
}

export function buildQueryRequest(ctx) {
  const base = channelBaseUrl(ctx);
  return {
    url: base + "/v1/videos/tasks/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: authHeaders(ctx.apiKey),
  };
}

/** Unwrap TaskDto {code,data} or flat OpenAI-style poll payloads. */
function unwrapPollBody(body) {
  if (!body || typeof body !== "object") return {};
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    if (
      body.data.task_id ||
      body.data.status ||
      body.data.result_url ||
      body.data.result_urls ||
      (body.code !== undefined && body.data)
    ) {
      return body.data;
    }
  }
  return body;
}

function collectResultUrls(data) {
  const urls = [];
  const seen = {};
  const push = function (value) {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const url = trimmed(value);
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (seen[url]) return;
    seen[url] = true;
    urls.push(url);
  };

  if (!data || typeof data !== "object") return urls;
  push(data.result_urls);
  push(data.result_url);
  push(data.url);
  push(data.video_url);
  if (data.data && typeof data.data === "object") {
    push(data.data.result_urls);
    push(data.data.result_url);
    push(data.data.url);
  }
  return urls;
}

function mapPublicStatus(rawStatus) {
  const raw = trimmed(rawStatus);
  if (!raw) return { status: "UNKNOWN", reason: "missing task status" };

  const upper = raw.toUpperCase();
  if (upper === "NOT_START" || upper === "SUBMITTED") return { status: "SUBMITTED", reason: "" };
  if (upper === "QUEUED" || upper === "PENDING") return { status: "QUEUED", reason: "" };
  if (upper === "IN_PROGRESS" || upper === "RUNNING" || upper === "PROCESSING") {
    return { status: "IN_PROGRESS", reason: "" };
  }
  if (upper === "SUCCESS" || upper === "SUCCEEDED" || upper === "COMPLETED") {
    return { status: "SUCCESS", reason: "" };
  }
  if (upper === "FAILURE" || upper === "FAILED" || upper === "ERROR" || upper === "CANCELLED" || upper === "CANCELED") {
    return { status: "FAILURE", reason: "" };
  }
  if (upper === "EXPIRED") return { status: "FAILURE", reason: "task expired" };
  if (upper === "UNKNOWN") return { status: "UNKNOWN", reason: "unknown task status" };

  const lower = raw.toLowerCase();
  if (lower === "queued" || lower === "pending" || lower === "created") return { status: "QUEUED", reason: "" };
  if (lower === "in_progress" || lower === "running" || lower === "processing") {
    return { status: "IN_PROGRESS", reason: "" };
  }
  if (lower === "completed" || lower === "succeeded" || lower === "success") {
    return { status: "SUCCESS", reason: "" };
  }
  if (lower === "failed" || lower === "failure" || lower === "error") {
    return { status: "FAILURE", reason: "" };
  }

  return { status: "UNKNOWN", reason: "unknown task status: " + raw };
}

export function parseTaskResult(ctx, body) {
  const root = body && typeof body === "object" ? body : {};
  if (root.error && !root.status && !root.task_id && !root.id && !root.data) {
    const msg =
      typeof root.error === "string" ? root.error : trimmed(root.error.message) || "upstream error";
    return { status: "FAILURE", reason: msg };
  }

  const data = unwrapPollBody(root);
  if (data.error && !data.status && !data.task_id && !data.id) {
    const msg =
      typeof data.error === "string" ? data.error : trimmed(data.error.message) || "upstream error";
    return { status: "FAILURE", reason: msg };
  }

  const mapped = mapPublicStatus(data.status);
  if (mapped.status === "UNKNOWN") return mapped;

  const result = {
    status: mapped.status,
    reason:
      mapped.status === "FAILURE"
        ? mapped.reason ||
          trimmed(data.fail_reason) ||
          trimmed(data.error_msg) ||
          trimmed(data.error && data.error.message) ||
          ""
        : "",
  };

  const pct = Number(
    data.progress_pct !== undefined
      ? data.progress_pct
      : String(data.progress || "").replace("%", "")
  );
  if (Number.isFinite(pct) && pct >= 0) {
    const rawProgress = data.progress_pct !== undefined ? data.progress_pct : data.progress;
    const n =
      pct <= 1 && String(rawProgress || "").indexOf("%") < 0 ? Math.round(pct * 100) : Math.round(pct);
    result.progress = String(Math.min(100, n)) + "%";
  }

  if (mapped.status === "SUCCESS") {
    const urls = collectResultUrls(data);
    if (urls.length) result.url = urls[0];
  }
  return result;
}

function artifactData(ctx) {
  const data = (ctx && ctx.data) || {};
  if (
    data.data &&
    typeof data.data === "object" &&
    data.data.task_id &&
    Object.prototype.hasOwnProperty.call(data.data, "data")
  ) {
    return data.data.data || {};
  }
  return unwrapPollBody(data);
}

function artifactUrls(ctx) {
  return collectResultUrls(artifactData(ctx));
}

export function listArtifacts(task) {
  if (task.status !== "SUCCESS") return [];
  const urls = artifactUrls(task);
  if (!urls.length) return [];
  return [{ key: "video", type: "video" }];
}

export function buildContentRequest(ctx) {
  const urls = artifactUrls(ctx);
  if (!urls.length) throw new Error("artifact_not_found");
  const key = trimmed(ctx.artifactKey);
  if (key && key !== "video") throw new Error("artifact_not_found");
  const url = urls[0];
  if (!url) throw new Error("artifact_not_found");
  return {
    url: url,
    method: (ctx.clientRequest && ctx.clientRequest.method) || "GET",
    credentialless: true,
  };
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) {
        throw new Error("JSON or multipart body required");
      }
      let req;
      let hasInputReferenceFile = false;
      if (ctx.body.kind === "json") {
        if (!ctx.body.value || Array.isArray(ctx.body.value)) throw new Error("JSON object required");
        req = Object.assign({}, ctx.body.value);
      } else {
        const first = function (name) {
          const values = (ctx.body.fields || {})[name] || [];
          if (values.length > 1) throw new Error(name + " must be provided once");
          return values[0];
        };
        req = {};
        const fields = ctx.body.fields || {};
        for (const name of Object.keys(fields)) {
          req[name] = first(name);
        }
        for (const file of ctx.body.files || []) {
          if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
          if (hasInputReferenceFile) throw new Error("input_reference must be provided once");
          hasInputReferenceFile = true;
        }
        if (req.metadata !== undefined) {
          let parsed;
          try {
            parsed = JSON.parse(req.metadata);
          } catch (e) {
            throw new Error("metadata must be a JSON object string");
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("metadata must be a JSON object string");
          }
          req.metadata = parsed;
        }
        if (req.seconds !== undefined) req.seconds = Number(req.seconds);
        else if (req.duration !== undefined) req.seconds = Number(req.duration);
      }

      const model = ctx.model;
      if (!trimmed(model)) throw new Error("model is required");

      const prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");
      req.prompt = prompt;

      const picked = pickRequestDuration(req);
      if (picked !== undefined) req.duration = Number(picked);

      if (!hasInputReferenceFile) {
        const image = trimmed(req.input_reference || req.image);
        if (image) req.image = image;
      }

      return {
        kind: "submit",
        model: ctx.model,
        action: "video",
        requestBody: Object.assign({}, req, { model: ctx.model, prompt: prompt }),
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
      const data = task.data && typeof task.data === "object" ? task.data : {};
      const output = {
        id: task.task_id,
        object: "video",
        model: "",
        status: statusMap[task.status] || "unknown",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: task.created_at || 0,
      };
      if (task.updated_at) output.completed_at = task.updated_at;
      if (task.status === "FAILURE") {
        output.error = { message: task.fail_reason || data.fail_reason || "task failed", code: "" };
      }
      return output;
    },
  },
};


