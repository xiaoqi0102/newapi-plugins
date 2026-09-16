/**
 * sudashui (SdAS API) — NewAPI 任务插件 · 视频专用 · 按次计费
 * 上游: https://api.sudashuiapi.com   (SdAS API,本身是一个 New API 实例)
 * 文档: https://api-docs.sudashuiapi.com/    素材站: https://files.sudashuiapi.com
 *
 * 只做视频(该站无图片模型)。模型计费口径 = 按次,价格配在网关「模型定价」的固定单价里,
 * 因此本插件**不声明 usageSchema**、不导出用量钩子(与 aicost 插件同款做法)。
 *
 * 对外路径(下游调用):
 *   视频(宿主 openai_video 协议,标准路径,盐值AI 走这条):
 *     POST   /v1/videos                    创建任务
 *     GET    /v1/videos/:task_id           查询任务
 *     GET    /v1/videos/:task_id/content   下载视频
 *   插件自有路径(直连调试用):
 *     POST   /sudashui/v1/videos/generations
 *     GET    /sudashui/v1/videos/tasks/:task_id
 *
 * 上游路径与请求体(逐字对齐官方文档):
 *   POST /v1/video/generations
 *     { model, prompt, duration, metadata: { payload: "<JSON 字符串>" } }
 *     payload 内只允许: aspectRatio(必填) / mode(必填 references|frames) /
 *                       imageUrls[] / videoUrls[] / audioUrls[] /
 *                       firstFrameUrl, lastFrameUrl(frames 模式必填)
 *     ⚠ payload 内禁止 model / resolution / duration / prompt
 *     ⚠ 外层禁止 images / imageUrls / videoUrls / audioUrls / firstFrameUrl /
 *        lastFrameUrl / aspectRatio / mode / resolution(分辨率由模型名决定)
 *     ⚠ 素材必须是**公网 URL** —— 上游由服务端去抓取,base64 / 本地文件一律不收
 *   GET  /v1/video/generations/{task_id}
 *     外层 status: SUBMITTED | IN_PROGRESS | SUCCESS | FAILURE
 *     内层 data.data.state: queueing | processing | success | failed
 *     成功取 data.result_url 或 data.data.creations[0].url
 *     ⚠ 失败时 data.result_url 里放的是**错误文本**而非链接,不可当直链用
 *
 * 提示词引用: @image1 / @audio1 / @video1(小写,编号即数组下标+1)。
 *   盐值AI「统一视频入口」会写成 @Image1,本插件统一改小写后再提交。
 *
 * 模型清单(v1.0.2 未变,共 27 个;已按 Key 的 /v1/models ∩ 上游 /api/pricing 同步):
 *   声明 27 个**按次(quota_type=1)视频模型** —— 按秒/按量模型一律不声明,从路由层堵死;
 *   图片模型(jy- 系列 / sdas-zh-gtp-img2)payload 结构与视频不同,暂不声明。
 *   ld-sdas-2-cvk 用户已明确不接(¥3.9/条),故不声明。
 *
 * 变更记录:
 *   1.0.2  请求快照补齐 reference_image_fields / reference_images_sent / _uploaded / _base64,
 *          用于事后判定客户端发图用的哪套字段名(统一视频入口 image_urls vs OpenAI 兼容 image_refs)
 *   1.0.1  声明 27 个按次视频模型;修正块注释提前闭合 bug
 *   1.0.0  首版(视频专用 · 按次)
 *
 * 待办(v1.1):
 *   2. 可选:代理素材上传 POST /sudashui/v1/files → files.sudashuiapi.com,
 *      配合盐值AI「设置 → 视频 → 参考素材中转 → 自定义上传接口」,
 *      可直接把素材落到上游自托管文件站,绕开免费图床过期/拉取慢的问题。
 */
export const meta = {
  apiVersion: 1,
  key: "sudashui",
  name: "SdAS API",
  icon: "text:sdas",
  description: {
    en: "SdAS API (sudashuiapi.com) video generation, per-call models.",
    zh: "SdAS API(sudashuiapi)视频生成,仅按次计费模型。",
  },
  version: "1.0.2",
  author: { name: "SdAS API", url: "https://api-docs.sudashuiapi.com/" },
  baseUrl: "https://api.sudashuiapi.com",
  models: [
    "sdas-mj-minimax-h3-2k",
    "sdas-xl-sd2.0-903-mini-480p",
    "sdas-qd-seedance-2.0-fast-480p",
    "sdas-qd-seedance-2.0-no-face-720p",
    "sdas-wf-sd2.0-mini-933-480p",
    "sdas-hn-sd2.0-933-720p",
    "sdas-hn-sd2.0-pro-933-720p",
    "sdas-qd-seedance-2.0-480p",
    "sdas-qd-seedance-2.0-fast-720p",
    "sdas-qd-seedance-2.0-fast-no-face-720p",
    "sdas-wf-sd2.0-mini-933-720p",
    "sdas-hn-sd2.0-fast-720p",
    "sdas-qd-seedance-2.0-1080p",
    "sdas-qd-seedance-2.0-fast-no-face-480p",
    "sdas-pd-sd2.0-mini-903-720p",
    "sdas-qd-seedance-2.0-mini-no-face-480p",
    "sdas-qd-seedance-2.0-no-face-1080p",
    "sdas-xg-sd2.0-pro-933-2-720p",
    "sdas-qd-seedance-2.0-no-face-4k",
    "sdas-ll-sd2.5-pro-30s-720p",
    "sdas-qd-seedance-2.0-4k",
    "sdas-qd-seedance-2.0-720p",
    "sdas-qd-seedance-2.0-mini-720p",
    "sdas-qd-seedance-2.0-mini-480p",
    "sdas-pd-sd2.0-mini-903-480p",
    "sdas-qd-seedance-2.0-mini-no-face-720p",
    "sdas-qd-seedance-2.0-no-face-480p",
  ],
  fetchMode: "per_task",
  allowedHosts: ["api.sudashuiapi.com", "files.sudashuiapi.com", "www.sudashuiapi.com"],
  protocols: [
    {
      name: "openai_video",
      models: [
    "sdas-mj-minimax-h3-2k",
    "sdas-xl-sd2.0-903-mini-480p",
    "sdas-qd-seedance-2.0-fast-480p",
    "sdas-qd-seedance-2.0-no-face-720p",
    "sdas-wf-sd2.0-mini-933-480p",
    "sdas-hn-sd2.0-933-720p",
    "sdas-hn-sd2.0-pro-933-720p",
    "sdas-qd-seedance-2.0-480p",
    "sdas-qd-seedance-2.0-fast-720p",
    "sdas-qd-seedance-2.0-fast-no-face-720p",
    "sdas-wf-sd2.0-mini-933-720p",
    "sdas-hn-sd2.0-fast-720p",
    "sdas-qd-seedance-2.0-1080p",
    "sdas-qd-seedance-2.0-fast-no-face-480p",
    "sdas-pd-sd2.0-mini-903-720p",
    "sdas-qd-seedance-2.0-mini-no-face-480p",
    "sdas-qd-seedance-2.0-no-face-1080p",
    "sdas-xg-sd2.0-pro-933-2-720p",
    "sdas-qd-seedance-2.0-no-face-4k",
    "sdas-ll-sd2.5-pro-30s-720p",
    "sdas-qd-seedance-2.0-4k",
    "sdas-qd-seedance-2.0-720p",
    "sdas-qd-seedance-2.0-mini-720p",
    "sdas-qd-seedance-2.0-mini-480p",
    "sdas-pd-sd2.0-mini-903-480p",
    "sdas-qd-seedance-2.0-mini-no-face-720p",
    "sdas-qd-seedance-2.0-no-face-480p",
  ],
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/sudashui/v1/videos/generations",
      type: "submit",
      action: "video",
      decode: "decodeVideoSubmit",
      render: "taskCreated",
    },
    {
      method: "GET",
      path: "/sudashui/v1/videos/tasks/:task_id",
      type: "query",
      render: "taskStatus",
    },
  ],
};

const DEFAULT_BASE_URL = "https://api.sudashuiapi.com";

/** 上游硬限制(取自模型说明:9 图 / 3 音频 / 3 视频、4-15 秒、提示词 ≤15000 字符) */
const IMAGE_MAX = 9;
const VIDEO_MAX = 3;
const AUDIO_MAX = 3;
const DURATION_MIN = 4;
const DURATION_MAX = 15;
const PROMPT_MAX = 15000;
const ASPECT_RATIOS = {
  "1:1": true,
  "3:4": true,
  "4:3": true,
  "9:16": true,
  "16:9": true,
  "21:9": true,
  adaptive: true,
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
  const key = trimmed(apiKey);
  if (!key) return {};
  return { Authorization: /^Bearer\s/i.test(key) ? key : "Bearer " + key };
}

function jsonHeaders(apiKey) {
  const headers = Object.assign({ "Content-Type": "application/json" }, authorizationHeader(apiKey));
  return headers;
}

function authHeaders(apiKey) {
  return authorizationHeader(apiKey);
}

function isVideoModel(model) {
  return Boolean(trimmed(model));
}

/* ------------------------------------------------------------------ *
 * 请求体解码(JSON / multipart)
 * ------------------------------------------------------------------ */

function decodeAnyObject(body) {
  if (!body || typeof body !== "object") return { req: {}, files: [] };
  if (body.kind === "multipart") {
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    const req = {};
    for (const key of Object.keys(fields)) {
      const value = fields[key];
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
  const metadata = req.metadata;
  if (metadata && typeof metadata === "object" && metadata[key] !== undefined && metadata[key] !== null) {
    return metadata[key];
  }
  const extra = req.extra_body;
  if (extra && typeof extra === "object" && extra[key] !== undefined && extra[key] !== null) return extra[key];
  return undefined;
}

function requestTextParts(req) {
  const parts = [];
  const messages = req && req.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const content = message && message.content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const item of content) {
          if (typeof item === "string") parts.push(item);
          else if (item && typeof item === "object" && typeof item.text === "string") parts.push(item.text);
        }
      }
    }
  }
  const input = req && req.input;
  if (typeof input === "string") parts.push(input);
  return parts.filter(function (item) { return trimmed(item); }).join("\n").trim();
}

function clientPrompt(req) {
  const direct = trimmed(req && req.prompt) || trimmed(fieldOf(req, "prompt"));
  if (direct) return direct;
  return trimmed(requestTextParts(req));
}

/* ------------------------------------------------------------------ *
 * 素材收集:一律公网 URL
 * ------------------------------------------------------------------ */

function mediaUrl(value) {
  if (typeof value === "string") return trimmed(value);
  if (!value || typeof value !== "object") return "";
  for (const key of ["url", "image_url", "video_url", "audio_url", "src", "uri", "file_url", "value"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && trimmed(candidate)) return trimmed(candidate);
    if (candidate && typeof candidate === "object" && typeof candidate.url === "string") return trimmed(candidate.url);
  }
  if (value.__fileRef) return "__file:" + trimmed(value.__fileRef);
  return "";
}

function collectMedia(values) {
  const out = [];
  const walk = function (value) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      const url = mediaUrl(value);
      if (url && out.indexOf(url) < 0) out.push(url);
      return;
    }
    const text = trimmed(value);
    if (text && out.indexOf(text) < 0) out.push(text);
  };
  values.forEach(walk);
  return out;
}

/** 只认公网 http(s) URL —— 上游服务端亲自去拉素材,base64 / 上传文件都会失败 */
function requirePublicUrls(list, label) {
  const rejected = [];
  const ok = [];
  for (const item of list) {
    if (/^https?:\/\//i.test(item)) ok.push(item);
    else if (item.indexOf("__file:") === 0) rejected.push("已上传文件");
    else if (/^data:/i.test(item)) rejected.push("base64/data URL");
    else rejected.push("非公网地址");
  }
  if (rejected.length) {
    const unique = rejected.filter(function (item, index) { return rejected.indexOf(item) === index; });
    throw new Error(
      "参考" + label + "必须是公网 http(s) URL(sudashui 上游由服务端抓取素材,不接受 base64 或本地文件);" +
      "本次收到:" + unique.join("、") + "。请在盐值AI「设置 → 视频 → 参考素材中转」里选用图床/OSS 等公网地址后重试。"
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
  const candidates = [
    req && req.seconds,
    req && req.duration,
    fieldOf(req, "seconds"),
    fieldOf(req, "duration"),
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(value)));
    }
  }
  return DURATION_MIN;
}

function resolveAspectRatio(req) {
  const raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (raw && ASPECT_RATIOS[raw]) return raw;
  if (/^\d{1,2}:\d{1,2}$/.test(raw)) return raw;
  return "16:9";
}

/** 盐值AI 统一视频入口写 @Image1,上游认 @image1 —— 统一改小写 */
function normalizeReferences(prompt) {
  return prompt
    .replace(/@Image(\d+)/g, "@image$1")
    .replace(/@Video(\d+)/g, "@video$1")
    .replace(/@Audio(\d+)/g, "@audio$1");
}

function firstFrameOf(req) {
  return trimmed(req && req.first_frame_url) || trimmed(fieldOf(req, "first_frame_url")) ||
    trimmed(req && req.start_frame) || trimmed(fieldOf(req, "start_frame")) ||
    trimmed(req && req.firstFrameUrl) || trimmed(fieldOf(req, "firstFrameUrl"));
}

function lastFrameOf(req) {
  return trimmed(req && req.last_frame_url) || trimmed(fieldOf(req, "last_frame_url")) ||
    trimmed(req && req.end_frame) || trimmed(fieldOf(req, "end_frame")) ||
    trimmed(req && req.lastFrameUrl) || trimmed(fieldOf(req, "lastFrameUrl"));
}

/**
 * 把「统一视频入口 / OpenAI 兼容」请求体翻译成上游 body。
 * 返回 { body, plan } —— plan 供落库快照与排查用。
 */
function buildVideoBody(ctx, req, model) {
  if (!trimmed(model)) throw new Error("model is required");

  const prompt = normalizeReferences(clientPrompt(req));
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > PROMPT_MAX) {
    throw new Error("提示词 " + prompt.length + " 字符,超过上游上限 " + PROMPT_MAX + " 字符,请精简后重试");
  }

  const images = collectMedia([
    req.image, req.images, req.image_urls, req.reference_images,
    fieldOf(req, "image"), fieldOf(req, "images"), fieldOf(req, "image_urls"),
  ]);
  const videos = collectMedia([
    req.videos, req.video_urls, req.reference_videos,
    fieldOf(req, "videos"), fieldOf(req, "video_urls"),
  ]);
  const audios = collectMedia([
    req.audios, req.audio_urls, req.audio_reference, req.audio_references,
    fieldOf(req, "audios"), fieldOf(req, "audio_urls"), fieldOf(req, "audio_reference"),
  ]);
  const firstFrame = firstFrameOf(req);
  const lastFrame = lastFrameOf(req);

  const duration = pickSeconds(req);
  const aspectRatio = resolveAspectRatio(req);

  const payload = { aspectRatio: aspectRatio, mode: "references" };
  let mode = "references";

  if (firstFrame && lastFrame) {
    mode = "frames";
    payload.mode = "frames";
    payload.firstFrameUrl = requirePublicUrls([firstFrame], "首帧图")[0];
    payload.lastFrameUrl = requirePublicUrls([lastFrame], "尾帧图")[0];
  } else {
    // 只给了单张首帧/尾帧时,按参考图处理(上游 frames 模式要求首尾帧成对)
    if (firstFrame) images.unshift(firstFrame);
    if (lastFrame) images.push(lastFrame);
    const publicImages = limitOf(requirePublicUrls(images, "图片"), IMAGE_MAX, "图片");
    const publicVideos = limitOf(requirePublicUrls(videos, "视频"), VIDEO_MAX, "视频");
    const publicAudios = limitOf(requirePublicUrls(audios, "音频"), AUDIO_MAX, "音频");
    if (publicImages.length) payload.imageUrls = publicImages;
    if (publicVideos.length) payload.videoUrls = publicVideos;
    if (publicAudios.length) payload.audioUrls = publicAudios;
  }

  const body = {
    model: model,
    prompt: prompt,
    duration: duration,
    metadata: { payload: JSON.stringify(payload) },
  };

  return {
    body: body,
    plan: {
      prompt: prompt,
      duration: duration,
      aspectRatio: aspectRatio,
      mode: mode,
      imageCount: (payload.imageUrls || []).length,
      videoCount: (payload.videoUrls || []).length,
      audioCount: (payload.audioUrls || []).length,
      images: payload.imageUrls || [],
      ignoredResolution: trimmed(req.resolution) || trimmed(fieldOf(req, "resolution")),
    },
  };
}

function submitIntent(ctx, action, requestBody) {
  return { kind: "submit", model: trimmed(ctx && ctx.model) || trimmed(requestBody && requestBody.model), action: action, requestBody: requestBody };
}

function decodeVideoSubmit(ctx) {
  const req = decodeJsonObject(ctx);
  const model = trimmed(ctx && ctx.model) || trimmed(req.model);
  if (!model) throw new Error("model is required");
  const prompt = clientPrompt(req);
  if (!prompt) throw new Error("prompt is required");
  return submitIntent(ctx, "video", Object.assign({}, req, { model: model, prompt: prompt }));
}

/* ------------------------------------------------------------------ *
 * 上游请求
 * ------------------------------------------------------------------ */

export function buildSubmitRequest(ctx) {
  const req = (ctx && ctx.requestBody) || {};
  const model = trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model) || trimmed(req.model);
  if (!model) throw new Error("model is required");
  if (!isVideoModel(model)) throw new Error("sudashui 只支持视频模型,收到:" + model);

  const built = buildVideoBody(ctx, req, model);
  return {
    url: channelBaseUrl(ctx) + "/v1/video/generations",
    method: "POST",
    headers: jsonHeaders(ctx.apiKey),
    body: built.body,
    action: "video",
  };
}

/** 扫描客户端请求体里所有与图片相关的字段,区分 公网URL / 上传文件 / base64,并记下字段名 */
function scanClientImageFields(req) {
  const out = { urlCount: 0, uploaded: 0, base64: 0, fields: [] };
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

function requestSnapshot(ctx) {
  const req = (ctx && ctx.requestBody) || {};
  const snap = {};
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model)) || trimmed(req.model);
  if (model) snap.model = model;
  let plan = null;
  try {
    plan = buildVideoBody(ctx, req, model || "snapshot").plan;
  } catch (error) {
    plan = null;
  }
  const prompt = plan ? plan.prompt : normalizeReferences(clientPrompt(req));
  if (prompt) snap.prompt = prompt;
  if (plan) {
    snap.seconds = plan.duration;
    snap.aspect_ratio = plan.aspectRatio;
    snap.sudashui_mode = plan.mode;
    if (plan.images.length) snap.reference_images = plan.images;
    snap.reference_images_count = plan.imageCount;
    if (plan.videoCount) snap.reference_videos = plan.videoCount;
    if (plan.audioCount) snap.reference_audios = plan.audioCount;
    if (plan.ignoredResolution) snap.resolution_ignored = plan.ignoredResolution;
  } else {
    const seconds = pickSeconds(req);
    if (seconds) snap.seconds = seconds;
  }
  // 客户端到底用哪个字段名发图(统一视频入口 image_urls / OpenAI 兼容 image_refs),事后可判定
  const scan = scanClientImageFields(req);
  if (scan.total) snap.reference_images_sent = scan.total;
  if (scan.uploaded) snap.reference_images_uploaded = scan.uploaded;
  if (scan.base64) snap.reference_images_base64 = scan.base64;
  if (scan.fields.length) snap.reference_image_fields = scan.fields;
  if (req && req.generate_audio !== undefined) snap.generate_audio = req.generate_audio;
  if (plan && plan.mode === "frames") snap.frames = "first+last";
  return snap;
}

function upstreamError(root) {
  if (!root || typeof root !== "object") return "";
  if (root.error) {
    return typeof root.error === "string" ? root.error : trimmed(root.error.message) || "upstream error";
  }
  if (root.success === false) return trimmed(root.message) || "upstream error";
  return "";
}

export function parseSubmitResponse(ctx, resp) {
  const root = (resp && resp.body) || {};
  const failure = upstreamError(root);
  if (failure) throw new Error(failure);

  const outer = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model));
  const state = { request: requestSnapshot(ctx) };

  const taskId = trimmed(outer.task_id) || trimmed(root.task_id) || trimmed(outer.id) || trimmed(root.id);
  if (!taskId) {
    const code = trimmed(root.code).toLowerCase();
    const message = trimmed(root.message);
    if (code && code !== "success" && code !== "ok") throw new Error(message || "upstream error: " + code);
    throw new Error(message || "missing task_id in upstream response");
  }
  return { taskId: taskId, taskData: root, state: state };
}

export function buildQueryRequest(ctx) {
  return {
    url: channelBaseUrl(ctx) + "/v1/video/generations/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: authHeaders(ctx.apiKey),
  };
}

/* ------------------------------------------------------------------ *
 * 上游响应解析
 * ------------------------------------------------------------------ */

function mapStatus(raw) {
  const value = trimmed(raw).toUpperCase();
  if (!value) return "UNKNOWN";
  if (value === "NOT_START" || value === "SUBMITTED" || value === "QUEUED" || value === "QUEUEING" ||
    value === "PENDING" || value === "CREATED" || value === "WAITING") return "QUEUED";
  if (value === "IN_PROGRESS" || value === "RUNNING" || value === "PROCESSING" || value === "GENERATING") return "IN_PROGRESS";
  if (value === "SUCCESS" || value === "SUCCEEDED" || value === "COMPLETED" || value === "DONE") return "SUCCESS";
  if (value === "FAILURE" || value === "FAILED" || value === "ERROR" || value === "CANCELLED" ||
    value === "CANCELED" || value === "TIMEOUT") return "FAILURE";
  return "UNKNOWN";
}

function layers(root) {
  const outer = root && root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : (root || {});
  const inner = outer && outer.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? outer.data : {};
  return { root: root || {}, outer: outer, inner: inner };
}

function progressOf(outer, inner) {
  const raw = outer.progress !== undefined ? outer.progress : inner.progress;
  if (raw === undefined || raw === null || raw === "") return "";
  const hasPercent = String(raw).indexOf("%") >= 0;
  let pct = Number(String(raw).replace("%", ""));
  if (!Number.isFinite(pct) || pct < 0) return "";
  if (!hasPercent && pct <= 1) pct = pct * 100;
  return String(Math.min(100, Math.round(pct))) + "%";
}

function failureReason(root, outer, inner) {
  const candidates = [outer.fail_reason, inner.fail_reason, inner.message, outer.message];
  for (const candidate of candidates) {
    const text = trimmed(candidate);
    if (text && !/^https?:\/\//i.test(text)) return text;
  }
  // 上游失败时会把错误文本塞进 result_url(不是链接)
  const ru = trimmed(outer.result_url);
  if (ru && !/^https?:\/\//i.test(ru)) return ru;
  const iru = trimmed(inner.result_url);
  if (iru && !/^https?:\/\//i.test(iru)) return iru;
  const code = trimmed(outer.err_code) || trimmed(inner.err_code);
  if (code && !/^https?:\/\//i.test(code)) return code;
  return trimmed(root && root.message) || "";
}

function collectResultUrls(outer, inner) {
  const urls = [];
  const seen = {};
  const push = function (value) {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value && typeof value === "object") {
      push(mediaUrl(value));
      return;
    }
    const url = trimmed(value);
    if (!url || !/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;
    urls.push(url);
  };
  push(inner.creations);
  push(outer.result_url);
  push(outer.result_urls);
  push(inner.url);
  push(inner.result_url);
  return urls;
}

export function parseTaskResult(ctx, body) {
  const root = body && typeof body === "object" ? body : {};
  const parts = layers(root);
  const outer = parts.outer;
  const inner = parts.inner;

  const failure = upstreamError(root);
  if (failure && !outer.status && !inner.state) return { status: "FAILURE", reason: failure };

  const rawStatus = trimmed(outer.status) || trimmed(inner.state) || trimmed(inner.status) || trimmed(outer.state);
  const status = mapStatus(rawStatus);
  if (status === "UNKNOWN") {
    const code = trimmed(root.code).toLowerCase();
    if (code && code !== "success" && code !== "ok") {
      return { status: "FAILURE", reason: trimmed(root.message) || "upstream error: " + code };
    }
    return { status: "UNKNOWN", reason: "unknown task status: " + rawStatus };
  }

  const result = { status: status };
  const progress = progressOf(outer, inner);
  if (progress) result.progress = progress;
  if (status === "FAILURE") result.reason = failureReason(root, outer, inner) || "";
  if (status === "SUCCESS") {
    const urls = collectResultUrls(outer, inner);
    if (urls.length) result.url = urls[0];
  }
  return result;
}

function artifactData(task) {
  const data = (task && task.data) || {};
  const parts = layers(data);
  return parts.inner && Object.keys(parts.inner).length ? parts.inner : parts.outer;
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const parts = layers((task && task.data) || {});
  const urls = collectResultUrls(parts.outer, parts.inner);
  return urls.length ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  const task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  const parts = layers((task && task.data) || {});
  const urls = collectResultUrls(parts.outer, parts.inner);
  if (urls.length) return { url: urls[0], method: "GET", credentialless: true };
  throw new Error("artifact_not_found");
}

/* ------------------------------------------------------------------ *
 * 插件自有路径的呈现层
 * ------------------------------------------------------------------ */

export const native = {
  decodeVideoSubmit: function (ctx) {
    return protocols.openai_video.decodeRequest(ctx);
  },
  taskCreated: function (ctx, task) {
    return protocols.openai_video.render(ctx, task);
  },
  taskStatus: function (_ctx, task) {
    const parts = layers((task && task.data) || {});
    const output = {
      task_id: task && task.task_id,
      model: trimmed(parts.inner.model) || trimmed(parts.outer.model),
      status: task && task.status,
      progress: (task && task.progress) || "0%",
    };
    if (task && task.status === "SUCCESS") {
      const urls = collectResultUrls(parts.outer, parts.inner);
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

/* ------------------------------------------------------------------ *
 * 宿主 openai_video 协议(标准 /v1/videos)
 * ------------------------------------------------------------------ */

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      const decoded = decodeAnyObject(ctx && ctx.body);
      const req = decoded.req;
      const files = decoded.files || [];
      const model = trimmed(ctx && ctx.model);
      if (!model) throw new Error("model is required");
      if (files.length) {
        throw new Error(
          "sudashui 上游只接受公网 URL 素材,不支持直接上传文件;" +
          "请在盐值AI「设置 → 视频 → 参考素材中转」中选择图床/OSS 等公网地址后重试"
        );
      }

      const prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");
      req.prompt = prompt;

      const duration = pickSeconds(req);
      req.seconds = duration;

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
      const parts = layers(data);
      const output = {
        id: task && task.task_id,
        object: "video",
        model: trimmed(parts.inner.model) || trimmed(parts.outer.model),
        status: statusMap[trimmed(task && task.status).toUpperCase()] || "queued",
        progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      };
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
