/**
 * aicost API — NewAPI Task Plugin
 * Upstream: https://www.aicost.me  (New API relay: 图片 + Seedance / MiniMax H3 视频)
 *
 * 只接「按次」计费的模型(按秒的 hs-/lec-/100% 系列不收)。
 *
 * 对外路径(下游调用方式):
 *   视频(宿主 openai_video 协议,标准路径):
 *     POST   /v1/videos                    创建任务
 *     GET    /v1/videos/:task_id           查询任务
 *     GET    /v1/videos/:task_id/content   下载视频
 *   图片(插件自有路径):
 *     POST   /aicost/v1/images/generations 文生图(gpt-image-2 / 2.5)
 *     POST   /aicost/v1/images/edits       参考图生图 / 编辑(JSON 或 multipart)
 *     POST   /aicost/v1/gemini-images      Gemini 图片预览模型(原生 v1beta)
 *     GET    /aicost/v1/images/tasks/:task_id  异步图片任务查询(上游返回任务时)
 *
 * 上游路径:
 *   POST /v1/videos                        创建视频任务
 *   GET  /v1/videos/{id}                   查询
 *   GET  /v1/videos/{id}/content           下载
 *   POST /v1/images/generations            文生图(同步返回 b64/url,也可能返回 task_id)
 *   POST /v1/images/edits                  参考图生图
 *   GET  /v1/images/generations/{task_id}  异步图片任务查询
 *   POST /v1beta/models/{model}:generateContent  Gemini 原生图片
 */
export const meta = {
  apiVersion: 1,
  key: "aicost",
  name: "aicost API",
  icon: "text:aicost",
  description: {
    en: "aicost.me relay: Seedance / MiniMax H3 video and GPT-Image / Gemini image, per-call models only.",
    zh: "aicost.me 中转:Seedance / MiniMax H3 视频与 GPT-Image / Gemini 图片,仅按次计费模型。",
  },
  version: "1.0.5",
  author: { name: "aicost API", url: "https://www.aicost.me/" },
  baseUrl: "https://www.aicost.me",
  models: [
    "gpt-image-2",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
    "seedance2.0-900-3",
    "seedance2.5-vid",
    "seedance2.0-480p",
    "seedance2.0-720p",
    "seedance2.5-900",
  ],
  fetchMode: "per_task",
  allowedHosts: ["www.aicost.me", "aicost.me"],
  protocols: [
    {
      name: "openai_video",
      models: [
        "seedance2.0-900-3",
        "seedance2.5-vid",
        "seedance2.0-480p",
        "seedance2.0-720p",
        "seedance2.5-900",
      ],
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/aicost/v1/images/generations",
      type: "submit",
      action: "image",
      decode: "decodeImageSubmit",
      render: "imageResult",
      models: [
        "gpt-image-2",
        "gpt-image-2.5-flare",
        "gpt-image-2.5-sunburst",
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
      ],
    },
    {
      method: "POST",
      path: "/aicost/v1/images/edits",
      type: "submit",
      action: "image",
      decode: "decodeImageEditSubmit",
      render: "imageResult",
      models: [
        "gpt-image-2",
        "gpt-image-2.5-flare",
        "gpt-image-2.5-sunburst",
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
      ],
    },
    {
      method: "POST",
      path: "/aicost/v1/gemini-images",
      type: "submit",
      action: "image",
      decode: "decodeGeminiImageSubmit",
      render: "imageResult",
      models: ["gemini-3-pro-image-preview", "gemini-3.1-flash-image-preview"],
    },
    {
      method: "GET",
      path: "/aicost/v1/images/tasks/:task_id",
      type: "query",
      render: "imageTaskStatus",
    },
  ],
};

const DEFAULT_BASE_URL = "https://www.aicost.me";

const GEMINI_IMAGE_MODELS = {
  "gemini-3-pro-image-preview": true,
  "gemini-3.1-flash-image-preview": true,
};

const IMAGE_MODELS = {
  "gpt-image-2": true,
  "gpt-image-2.5-flare": true,
  "gpt-image-2.5-sunburst": true,
  "gemini-3-pro-image-preview": true,
  "gemini-3.1-flash-image-preview": true,
};

const VIDEO_MODELS = {
  "seedance2.0-900-3": true,
  "seedance2.5-vid": true,
  "seedance2.0-480p": true,
  "seedance2.0-720p": true,
  "seedance2.5-900": true,
};

const H3_PREFIX = /^minimax-h3/i;
const GEMINI_PREFIX = /^gemini-3/i;

/** aspect_ratio + image_size -> size(aicost 文档里的通用尺寸映射表) */
const SIZE_TABLE = {
  "1K": { "1:1": "1024x1024", "16:9": "1536x864", "9:16": "864x1536", "4:3": "1360x1024", "3:4": "1024x1360", "3:2": "1536x1024", "2:3": "1024x1536" },
  "2K": { "1:1": "2048x2048", "16:9": "3072x1728", "9:16": "1728x3072", "4:3": "2720x2048", "3:4": "2048x2720", "3:2": "3072x2048", "2:3": "2048x3072" },
  "4K": { "1:1": "2880x2880", "16:9": "3840x2160", "9:16": "2160x3840", "4:3": "3328x2496", "3:4": "2496x3328", "3:2": "3520x2336", "2:3": "2336x3520" },
};

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

function isImageModel(model) {
  const m = trimmed(model);
  return Boolean(IMAGE_MODELS[m]) || /^gpt-image-/i.test(m) || GEMINI_PREFIX.test(m);
}

function isGeminiImageModel(model) {
  return Boolean(GEMINI_IMAGE_MODELS[trimmed(model)]);
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

function resolveSize(req, defaultSize) {
  const direct = trimmed(req.size) || trimmed(fieldOf(req, "size"));
  if (direct) return direct;
  const ratio = trimmed(req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) || trimmed(req.ratio) || trimmed(fieldOf(req, "ratio"));
  const tier = (trimmed(req.image_size) || trimmed(fieldOf(req, "image_size")) || "").toUpperCase();
  if (ratio) {
    const t = SIZE_TABLE[tier] ? tier : "2K";
    const size = SIZE_TABLE[t][ratio];
    if (size) return size;
  }
  return defaultSize || "";
}

function resolveAspectRatio(req) {
  return trimmed(req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) || trimmed(req.ratio) || trimmed(fieldOf(req, "ratio"));
}

/* ------------------------------------------------------------------ *
 * native 钩子(插件自有路由)
 * ------------------------------------------------------------------ */

function submitIntent(ctx, action, requestBody) {
  const req = requestBody || {};
  const model = trimmed(req.model) || trimmed(ctx.model);
  if (!model) throw new Error("model is required");
  if (!clientPrompt(req)) throw new Error("prompt is required");
  return { kind: "submit", model: model, action: action, requestBody: Object.assign({}, req, { model: model, prompt: clientPrompt(req) }) };
}

function decodeImageSubmit(ctx) {
  const body = decodeJsonObject(ctx);
  return submitIntent(ctx, "image", body);
}

function decodeGeminiImageSubmit(ctx) {
  const body = decodeJsonObject(ctx);
  return submitIntent(ctx, "image", body);
}

function decodeImageEditSubmit(ctx) {
  const decoded = decodeAnyObject(ctx.body);
  const req = decoded.req;
  const placeholders = [];
  for (const file of decoded.files) {
    const field = trimmed(file.field);
    if (field !== "image" && field !== "images" && field !== "mask" && field !== "image[]") {
      throw new Error("unexpected file field: " + field);
    }
    placeholders.push({
      key: field === "mask" ? "mask" : "image",
      value: { __fileRef: "request_file:" + field, encoding: "dataUrl" },
    });
  }
  const intent = submitIntent(ctx, "image", req);
  intent.requestBody.__uploaded = placeholders;
  return intent;
}

/** 图片结果渲染:同步返回时 data 里就是图,异步时给出任务信息 */
function imageResult(_ctx, task) {
  const data = (task && task.data) || {};
  const status = trimmed(task && task.status).toUpperCase();
  if (status === "FAILURE" || status === "FAILED") {
    return { error: { message: trimmed(task.fail_reason) || trimmed(data.fail_reason) || "image generation failed", type: "upstream_error" } };
  }
  const images = extractImages(data);
  if (images.length) {
    const created = Number(task && (task.created_at || task.submit_time)) || Math.floor(Date.now() / 1000);
    return { created: created, data: images };
  }
  return {
    id: task && task.task_id,
    task_id: task && task.task_id,
    object: "image.generation",
    status: status === "SUCCESS" || status === "SUCCEEDED" ? "succeeded" : "processing",
    model: trimmed(data.model) || trimmed(task && task.model),
    progress: task && task.progress ? String(task.progress) : "0%",
  };
}

function imageTaskStatus(_ctx, task) {
  const data = (task && task.data) || {};
  const status = trimmed(task && task.status).toUpperCase();
  const out = {
    id: task && task.task_id,
    task_id: task && task.task_id,
    status: status === "SUCCESS" ? "succeeded" : status === "FAILURE" ? "failed" : "processing",
    progress: task && task.progress ? String(task.progress) : "0%",
    fail_reason: trimmed(task && task.fail_reason) || trimmed(data.fail_reason) || trimmed(data.error && data.error.message) || "",
  };
  const images = extractImages(data);
  if (images.length) out.data = images;
  return out;
}

export const native = {
  decodeVideoSubmit: function (ctx) { return protocols.openai_video.decodeRequest(ctx); },
  renderVideo: function (ctx, task) { return protocols.openai_video.render(ctx, task); },
  decodeImageSubmit: decodeImageSubmit,
  decodeImageEditSubmit: decodeImageEditSubmit,
  decodeGeminiImageSubmit: decodeGeminiImageSubmit,
  imageResult: imageResult,
  imageTaskStatus: imageTaskStatus,
  taskCreated: imageResult,
  taskStatus: imageTaskStatus,
  error: function (_ctx, error) {
    return { error: { message: (error && error.message) || "request failed", type: "upstream_error", code: (error && error.code) || "" } };
  },
};

/* ------------------------------------------------------------------ *
 * 上游请求构造
 * ------------------------------------------------------------------ */

function geminiImageRequest(ctx, req) {
  const model = trimmed(ctx.upstreamModel) || trimmed(ctx.model) || trimmed(req.model);
  const prompt = clientPrompt(req);
  if (!model) throw new Error("model is required");
  if (!prompt) throw new Error("prompt is required");

  const parts = [];
  const texts = requestTextParts(req);
  parts.push({ text: texts.length ? texts.join("\n\n") : prompt });
  for (const item of requestImages(req)) {
    if (typeof item === "object" && item.__fileRef) {
      parts.push({ inlineData: { mimeType: "image/png", data: item } });
      continue;
    }
    const value = trimmed(item);
    const dataUri = /^data:([^;,]+);base64,(.+)$/i.exec(value);
    if (dataUri) parts.push({ inlineData: { mimeType: dataUri[1], data: dataUri[2] } });
    else if (/^https?:\/\//i.test(value)) throw new Error("gemini 图片参考需要 base64/data URI,请改走 /aicost/v1/images/edits");
    else if (value) parts.push({ inlineData: { mimeType: "image/png", data: value } });
  }

  const imageSize = (trimmed(req.image_size) || trimmed(fieldOf(req, "image_size")) || "2K").toUpperCase();
  const body = {
    contents: [{ role: "user", parts: parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        imageSize: SIZE_TABLE[imageSize] ? imageSize : "2K",
        aspectRatio: resolveAspectRatio(req) || "16:9",
      },
    },
  };
  return {
    url: channelBaseUrl(ctx) + "/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    method: "POST",
    headers: jsonHeaders(ctx.apiKey),
    body: body,
    action: "image",
  };
}

function gptImageBody(ctx, req, withReference) {
  const model = trimmed(ctx.upstreamModel) || trimmed(ctx.model) || trimmed(req.model);
  if (!model) throw new Error("model is required");
  const prompt = clientPrompt(req);
  if (!prompt) throw new Error("prompt is required");

  const body = { model: model, prompt: prompt, n: 1 };
  const n = req.n !== undefined && req.n !== null && req.n !== "" ? Number(req.n) : undefined;
  if (n !== undefined && Number.isInteger(n) && n >= 1) body.n = n;
  body.quality = trimmed(req.quality) || trimmed(fieldOf(req, "quality")) || "auto";
  body.size = resolveSize(req, "3072x1728") || "3072x1728";
  body.output_format = trimmed(req.output_format) || trimmed(fieldOf(req, "output_format")) || "jpeg";
  body.moderation = trimmed(req.moderation) || "auto";
  const background = trimmed(req.background) || trimmed(fieldOf(req, "background"));
  if (background) body.background = background;
  if (req.output_compression !== undefined && req.output_compression !== null && req.output_compression !== "") {
    body.output_compression = Number(req.output_compression);
  }

  if (withReference) {
    let images = requestImages(req);
    if (req.__uploaded && req.__uploaded.length) {
      for (const item of req.__uploaded) {
        if (item.key === "mask") body.mask = item.value;
        else images = images.concat([item.value]);
      }
    }
    if (!images.length) throw new Error("image (reference) is required for /aicost/v1/images/edits");
    body.image = images.length === 1 ? images[0] : images;
  }
  return body;
}

export function buildSubmitRequest(ctx) {
  const req = (ctx && ctx.requestBody) || {};
  const model = trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model) || trimmed(req.model);
  const action = trimmed(ctx && ctx.action) || (isImageModel(model) ? "image" : "video");

  if (action === "image") {
    if (isGeminiImageModel(model)) return geminiImageRequest(ctx, req);
    const reference = requestImages(req).length > 0 || (req.__uploaded && req.__uploaded.length > 0);
    const path = reference ? "/v1/images/edits" : "/v1/images/generations";
    return {
      url: channelBaseUrl(ctx) + path,
      method: "POST",
      headers: jsonHeaders(ctx.apiKey),
      body: gptImageBody(ctx, req, reference),
      action: "image",
    };
  }

  // 视频
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

function collectImageUrls(data, out, seen) {
  const push = function (value) {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value && typeof value === "object") {
      if (value.b64_json || value.base64) {
        const b64 = trimmed(value.b64_json) || trimmed(value.base64);
        if (b64 && !seen["b64:" + b64.slice(0, 32)]) {
          seen["b64:" + b64.slice(0, 32)] = true;
          out.push({ b64_json: b64 });
        }
        return;
      }
      const url = mediaUrl(value);
      if (url && /^https?:\/\//i.test(url) && !seen[url]) {
        seen[url] = true;
        out.push({ url: url });
        return;
      }
      const nested = trimmed(value.image) || trimmed(value.output) || trimmed(value.result);
      if (nested) push(nested);
      if (value.images) push(value.images);
      if (value.data) push(value.data);
      return;
    }
    const s = trimmed(value);
    if (!s) return;
    if (/^https?:\/\//i.test(s)) {
      if (!seen[s]) {
        seen[s] = true;
        out.push({ url: s });
      }
      return;
    }
    if (s.length > 64 && !seen["b64:" + s.slice(0, 32)]) {
      seen["b64:" + s.slice(0, 32)] = true;
      out.push({ b64_json: s });
    }
  };
  push(data);
}

/** 从各家返回里抠出图片:OpenAI data[]/b64_json/url、aicost 扩展字段、Gemini inlineData、文本中的 URL */
function extractImages(root) {
  const out = [];
  const seen = {};
  if (!root || typeof root !== "object") return out;

  if (Array.isArray(root.data)) collectImageUrls(root.data, out, seen);
  for (const key of ["b64_json", "image_base64", "base64", "url", "image_url", "image", "images", "output", "result"]) {
    if (root[key] !== undefined) collectImageUrls(root[key], out, seen);
  }
  if (root.data && !Array.isArray(root.data)) collectImageUrls(root.data, out, seen);

  const candidates = root.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = candidate && candidate.content && candidate.content.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (part && part.inlineData && part.inlineData.data) collectImageUrls(part.inlineData.data, out, seen);
        if (part && part.inline_data && part.inline_data.data) collectImageUrls(part.inline_data.data, out, seen);
        if (part && part.text) {
          const urls = String(part.text).match(/https?:\/\/[^\s)"'<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)"'<>]*)?/gi);
          if (urls) urls.forEach(function (u) { collectImageUrls(u, out, seen); });
        }
      }
    }
  }
  return out;
}

/** 图片放在 message.content / message.images 里(部分上游把图片当聊天消息返回) */
function extractImagesFromChoices(root) {
  const out = [];
  const seen = {};
  const choices = root && root.choices;
  if (!Array.isArray(choices)) return out;
  for (const choice of choices) {
    const message = (choice && (choice.message || choice.delta)) || {};
    if (message.images) collectImageUrls(message.images, out, seen);
    const content = message.content;
    if (typeof content === "string") {
      const markdown = content.match(/!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/gi) || [];
      for (const item of markdown) {
        const value = item.replace(/^!\[[^\]]*\]\(/, "").replace(/\)$/, "");
        collectImageUrls(value, out, seen);
      }
      const urls = content.match(/https?:\/\/[^\s)"'<>]+/g) || [];
      for (const url of urls) collectImageUrls(url, out, seen);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && part.image_url) collectImageUrls(part.image_url, out, seen);
        if (part && part.image) collectImageUrls(part.image, out, seen);
      }
    }
  }
  return out;
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

export function parseSubmitResponse(ctx, resp) {
  const root = (resp && resp.body) || {};
  if (root.error) {
    const message = typeof root.error === "string" ? root.error : trimmed(root.error.message) || "upstream error";
    throw new Error(message);
  }
  if (root.message && root.success === false) throw new Error(trimmed(root.message) || "upstream error");

  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model));

  if (isImageModel(model)) {
    const images = extractImages(root).concat(extractImagesFromChoices(root));
    if (images.length) {
      const taskId = "aicost-img-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
      return {
        taskId: taskId,
        taskData: { model: model, images: images },
        state: { request: requestSnapshot(ctx) },
        immediate: { status: "SUCCESS", taskId: taskId, url: images[0].url || "" },
      };
    }
    const taskId = trimmed(root.task_id) || trimmed(root.id);
    if (taskId) return { taskId: taskId, taskData: root, state: { request: requestSnapshot(ctx) } };
    throw new Error("no image found in upstream response");
  }

  const taskId = trimmed(root.task_id) || trimmed(root.id);
  if (!taskId) {
    const images = extractImages(root);
    const done = trimmed(root.status).toUpperCase();
    if (images.length && (done === "SUCCESS" || done === "SUCCEEDED" || done === "COMPLETED")) {
      const synthetic = "aicost-video-" + Date.now();
      return {
        taskId: synthetic,
        taskData: root,
        state: { request: requestSnapshot(ctx) },
        immediate: { status: "SUCCESS", taskId: synthetic, url: images[0].url || "" },
      };
    }
    throw new Error("missing task_id in upstream response");
  }
  return { taskId: taskId, taskData: root, state: { request: requestSnapshot(ctx) } };
}

export function buildQueryRequest(ctx) {
  const base = channelBaseUrl(ctx);
  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model));
  const action = trimmed(ctx && ctx.action) || (isImageModel(model) ? "image" : "video");
  const path = action === "image" ? "/v1/images/generations/" : "/v1/videos/";
  return {
    url: base + path + encodeURIComponent(ctx.taskId),
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
  const data = artifactData(task);
  const images = extractImages(task.data || {});
  if (images.length) {
    return images.map(function (_item, index) {
      return { key: index === 0 ? "image" : "image_" + (index + 1), type: "image" };
    });
  }
  const urls = collectResultUrls(data);
  if (!urls.length) return [];
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(urls[0])) return urls.map(function (_u, i) { return { key: i === 0 ? "image" : "image_" + (i + 1), type: "image" }; });
  return [{ key: "video", type: "video" }];
}

export function buildContentRequest(ctx) {
  const task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  const data = artifactData(task);

  const images = extractImages((task && task.data) || {});
  if (images.length) {
    let index = 0;
    const key = trimmed(ctx && ctx.artifactKey);
    if (key && key !== "image") {
      const match = /^image_(\d+)$/.exec(key);
      if (!match) throw new Error("artifact_not_found");
      index = Number(match[1]) - 1;
    }
    const item = images[index];
    if (!item) throw new Error("artifact_not_found");
    if (item.url) return { url: item.url, method: "GET", credentialless: true };
    throw new Error("artifact_not_found");
  }

  const urls = collectResultUrls(data);
  if (urls.length) return { url: urls[0], method: "GET", credentialless: true };

  const model = trimmed(ctx && (ctx.upstreamModel || ctx.model));
  const action = trimmed(ctx && ctx.action) || (isImageModel(model) ? "image" : "video");
  if (action === "image") {
    const remote = trimmed(task && task.remote_url);
    if (remote && /^https?:\/\//i.test(remote)) return { url: remote, method: "GET" };
    throw new Error("artifact_not_found");
  }
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
      if (isImageModel(model)) throw new Error("图片模型请使用 /aicost/v1/images/generations、/aicost/v1/images/edits 或 /aicost/v1/gemini-images");

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
