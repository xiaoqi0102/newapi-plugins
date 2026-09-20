/**
 * meaicc (MeAICC) — NewAPI 任务插件 · 视频专用(Seedance 2.0) · 按次计费
 * 上游: https://api.meaicc.com      模型: sd-2-c1
 * 文档: https://api.meaicc.com/create/sd-2.html    模型列表: https://api.meaicc.com/pricing
 *
 * 只做视频。计费口径 = 按次:价格配在网关「模型定价」的固定单价里,
 * 因此本插件**不声明 usageSchema**、不导出用量钩子(与 aicost / sudashui 同款做法)。
 *
 * 对外路径(下游调用):
 *   视频(宿主 openai_video 协议,标准路径,盐值AI 走这条):
 *     POST   /v1/videos                    创建任务
 *     GET    /v1/videos/:task_id           查询任务
 *     GET    /v1/videos/:task_id/content   下载视频
 *   插件自有路径(直连调试用):
 *     POST   /meaicc/v1/videos/generations
 *     GET    /meaicc/v1/videos/tasks/:task_id
 *
 * 上游协议(逐字对齐官方文档):
 *   POST /v1/videos
 *     { model, input: { prompt, media?: [{type, url}] },
 *       parameters: { duration(必填,秒), resolution?(如 720p), ratio?(1:1|16:9|9:16) } }
 *     media[].type ∈ first_frame | last_frame | reference_image | reference_voice | reference_video
 *     ⚠ 素材必须是**公网 http(s) URL** —— 上游服务端亲自去抓,base64 / 本地文件一律不收
 *     ⚠ 上限:9 图片 + 3 视频 + 3 音频;输入视频 + 输出视频时长合计 ≤ 25 秒
 *     ⚠ 图片分辨率需 ≥ 300x300
 *   GET  /v1/videos/{task_id}
 *     { id, object, status, progress, seconds, created_at }
 *     status: PENDING 排队 | RUNNING 运行中 | SUCCEEDED 完成 | FAILED: 错误信息
 *     ⚠ 失败时**错误信息是拼在 status 字符串里**的(形如 "FAILED: 触发敏感词"),不是独立字段
 *     成功时 object = 视频直链(⚠ 只缓存 10 小时,请尽快下载保存)
 *
 * 提示词引用: @图1 / @视频1 / @音频1(与官方文档一致)。
 *   盐值AI「统一视频入口」会写成 @Image1 / @Video1 / @Audio1,本插件统一转成中文写法再提交。
 *
 * 变更记录:
 *   1.0.0  首版(视频专用 · 按次 · 单模型 sd-2-c1)
 */
export const meta = {
  apiVersion: 1,
  key: "meaicc",
  name: "MeAICC API",
  icon: "text:meaicc",
  description: {
    en: "MeAICC (api.meaicc.com) Seedance 2.0 video generation, per-call models.",
    zh: "MeAICC(api.meaicc.com)Seedance 2.0 视频生成,仅按次计费模型。",
  },
  version: "1.0.0",
  author: { name: "MeAICC", url: "https://api.meaicc.com/create/sd-2.html" },
  baseUrl: "https://api.meaicc.com",
  models: ["sd-2-c1"],
  fetchMode: "per_task",
  allowedHosts: ["api.meaicc.com"],
  protocols: [
    {
      name: "openai_video",
      models: ["sd-2-c1"],
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/meaicc/v1/videos/generations",
      type: "submit",
      action: "video",
      decode: "decodeVideoSubmit",
      render: "taskCreated",
    },
    {
      method: "GET",
      path: "/meaicc/v1/videos/tasks/:task_id",
      type: "query",
      render: "taskStatus",
    },
  ],
};

const DEFAULT_BASE_URL = "https://api.meaicc.com";

/** 上游硬限制(取自官方文档) */
const IMAGE_MAX = 9;
const VIDEO_MAX = 3;
const AUDIO_MAX = 3;
const DURATION_MAX = 25; // 输入视频 + 输出视频时长合计上限
const DURATION_DEFAULT = 5;
const RATIOS = { "1:1": true, "16:9": true, "9:16": true };
const MEDIA_TYPES = {
  first_frame: true,
  last_frame: true,
  reference_image: true,
  reference_voice: true,
  reference_video: true,
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
  return Object.assign({ "Content-Type": "application/json" }, authorizationHeader(apiKey));
}

function authHeaders(apiKey) {
  return authorizationHeader(apiKey);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(trimmed(value));
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

/** 顶层 → metadata → extra_body 逐层找字段(下游客户端三种写法都兼容) */
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
    if (isHttpUrl(item)) ok.push(trimmed(item));
    else if (item.indexOf("__file:") === 0) rejected.push("已上传文件");
    else if (/^data:/i.test(item)) rejected.push("base64/data URL");
    else rejected.push("非公网地址");
  }
  if (rejected.length) {
    const unique = rejected.filter(function (item, index) { return rejected.indexOf(item) === index; });
    throw new Error(
      "参考" + label + "必须是公网 http(s) URL(meaicc 上游由服务端抓取素材,不接受 base64 或本地文件);" +
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

function pickDuration(req) {
  const candidates = [
    req && req.seconds,
    req && req.duration,
    fieldOf(req, "seconds"),
    fieldOf(req, "duration"),
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(DURATION_MAX, Math.max(1, Math.round(value)));
    }
  }
  return DURATION_DEFAULT;
}

function pickResolution(req) {
  const raw = trimmed(req && req.resolution) || trimmed(fieldOf(req, "resolution")) ||
    trimmed(req && req.size) || trimmed(fieldOf(req, "size"));
  if (/^\d{3,4}p$/i.test(raw)) return raw.toLowerCase();
  return "720p";
}

function pickRatio(req) {
  const raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (!raw) return "";
  if (RATIOS[raw]) return raw;
  // 上游只认 1:1 / 16:9 / 9:16,其它比例不传,交给上游按素材自适应
  return "";
}

function firstFrameOf(req) {
  return trimmed(req && req.first_frame_url) || trimmed(fieldOf(req, "first_frame_url")) ||
    trimmed(req && req.firstFrameUrl) || trimmed(fieldOf(req, "firstFrameUrl")) ||
    trimmed(req && req.start_frame) || trimmed(fieldOf(req, "start_frame"));
}

function lastFrameOf(req) {
  return trimmed(req && req.last_frame_url) || trimmed(fieldOf(req, "last_frame_url")) ||
    trimmed(req && req.lastFrameUrl) || trimmed(fieldOf(req, "lastFrameUrl")) ||
    trimmed(req && req.end_frame) || trimmed(fieldOf(req, "end_frame"));
}

/** 盐值AI 统一视频入口写 @Image1,上游文档写 @图1 —— 统一转成上游写法 */
function normalizeReferences(prompt) {
  return prompt
    .replace(/@Image\s*(\d+)/gi, "@图$1")
    .replace(/@Video\s*(\d+)/gi, "@视频$1")
    .replace(/@Audio\s*(\d+)/gi, "@音频$1");
}

/**
 * 客户端已按上游形状传了 media 数组时,原样采纳(只校验 type 与 url)。
 */
function explicitMedia(req) {
  const raw = req && req.media !== undefined ? req.media : fieldOf(req, "media");
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = trimmed(item.type);
    const url = trimmed(item.url) || mediaUrl(item);
    if (!type || !url) continue;
    if (!MEDIA_TYPES[type]) {
      throw new Error("media[].type 不支持:" + type + "(可选 first_frame/last_frame/reference_image/reference_voice/reference_video)");
    }
    out.push({ type: type, url: url });
  }
  return out.length ? out : null;
}

/**
 * 把「统一视频入口 / OpenAI 兼容」请求体翻译成上游 body。
 * 返回 { body, plan } —— plan 供落库快照与排查用。
 */
function buildVideoBody(ctx, req, model) {
  if (!trimmed(model)) throw new Error("model is required");

  const prompt = normalizeReferences(clientPrompt(req));
  if (!prompt) throw new Error("prompt is required");

  const duration = pickDuration(req);
  const resolution = pickResolution(req);
  const ratio = pickRatio(req);

  const media = [];
  const explicit = explicitMedia(req);
  const plan = {
    prompt: prompt,
    duration: duration,
    resolution: resolution,
    ratio: ratio,
    firstFrame: 0,
    lastFrame: 0,
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
  };

  if (explicit) {
    // 客户端直接给上游形状:原样透传(按 type 计数)
    for (const item of explicit) {
      media.push({ type: item.type, url: requirePublicUrls([item.url], item.type)[0] });
      if (item.type === "first_frame") plan.firstFrame += 1;
      else if (item.type === "last_frame") plan.lastFrame += 1;
      else if (item.type === "reference_image") plan.imageCount += 1;
      else if (item.type === "reference_video") plan.videoCount += 1;
      else if (item.type === "reference_voice") plan.audioCount += 1;
    }
  } else {
    const firstFrame = firstFrameOf(req);
    const lastFrame = lastFrameOf(req);
    if (firstFrame) {
      media.push({ type: "first_frame", url: requirePublicUrls([firstFrame], "首帧图")[0] });
      plan.firstFrame = 1;
    }
    if (lastFrame) {
      media.push({ type: "last_frame", url: requirePublicUrls([lastFrame], "尾帧图")[0] });
      plan.lastFrame = 1;
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
    const publicImages = limitOf(requirePublicUrls(images, "图片"), IMAGE_MAX, "图片");
    const publicVideos = limitOf(requirePublicUrls(videos, "视频"), VIDEO_MAX, "视频");
    const publicAudios = limitOf(requirePublicUrls(audios, "音频"), AUDIO_MAX, "音频");
    for (const url of publicImages) media.push({ type: "reference_image", url: url });
    for (const url of publicVideos) media.push({ type: "reference_video", url: url });
    for (const url of publicAudios) media.push({ type: "reference_voice", url: url });
    plan.imageCount = publicImages.length;
    plan.videoCount = publicVideos.length;
    plan.audioCount = publicAudios.length;
  }

  const input = { prompt: prompt };
  if (media.length) input.media = media;

  const parameters = { duration: duration, resolution: resolution };
  if (ratio) parameters.ratio = ratio;

  return {
    body: { model: trimmed(model), input: input, parameters: parameters },
    plan: plan,
  };
}

function submitIntent(ctx, action, requestBody) {
  return {
    kind: "submit",
    model: trimmed(ctx && ctx.model) || trimmed(requestBody && requestBody.model),
    action: action,
    requestBody: requestBody,
  };
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

  const built = buildVideoBody(ctx, req, model);
  return {
    url: channelBaseUrl(ctx) + "/v1/videos",
    method: "POST",
    headers: jsonHeaders(ctx && ctx.apiKey),
    body: built.body,
    action: "video",
  };
}

export function buildQueryRequest(ctx) {
  return {
    url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: authHeaders(ctx && ctx.apiKey),
  };
}

/* ------------------------------------------------------------------ *
 * 上游响应解析
 * ------------------------------------------------------------------ */

function upstreamError(root) {
  if (!root || typeof root !== "object") return "";
  if (root.error) {
    return typeof root.error === "string" ? root.error : trimmed(root.error.message) || "upstream error";
  }
  if (root.success === false) return trimmed(root.message) || "upstream error";
  return "";
}

/** meaicc 失败时把错误拼在 status 里:"FAILED: 触发敏感词" —— 剥掉前缀并给可执行提示 */
function failureTextFromStatus(raw) {
  const text = trimmed(raw).replace(/^FAILED\s*[:：]?\s*/i, "").trim();
  if (!text) return "上游返回 FAILED(未附错误信息)";
  if (/敏感|违规|违规内容|风险|sensitive|policy/i.test(text)) {
    return text + "(多为提示词/素材触发敏感词:避免违法、违规、涉政、色情、暴力、低俗、恶意引导,以及特定校名、地域名称)";
  }
  return text;
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
    snap.resolution = plan.resolution;
    if (plan.ratio) snap.ratio = plan.ratio;
    snap.meaicc_media_count = plan.firstFrame + plan.lastFrame + plan.imageCount + plan.videoCount + plan.audioCount;
    if (plan.firstFrame) snap.first_frame = true;
    if (plan.lastFrame) snap.last_frame = true;
    if (plan.imageCount) snap.reference_images_count = plan.imageCount;
    if (plan.videoCount) snap.reference_videos_count = plan.videoCount;
    if (plan.audioCount) snap.reference_audios_count = plan.audioCount;
  }
  return snap;
}

export function parseSubmitResponse(ctx, resp) {
  const root = (resp && resp.body) || {};
  const failure = upstreamError(root);
  if (failure) throw new Error(failure);

  const rawStatus = trimmed(root.status);
  if (/^FAILED/i.test(rawStatus)) throw new Error(failureTextFromStatus(rawStatus));

  const taskId = trimmed(root.task_id) || trimmed(root.id);
  if (!taskId) {
    const message = trimmed(root.message);
    throw new Error(message || "missing task_id in upstream response");
  }
  return { taskId: taskId, taskData: root, state: { request: requestSnapshot(ctx) } };
}

function mapStatus(raw) {
  const value = trimmed(raw).toUpperCase();
  if (!value) return "UNKNOWN";
  if (value === "PENDING" || value === "QUEUED" || value === "QUEUEING" || value === "WAITING" ||
    value === "NOT_START" || value === "SUBMITTED" || value === "CREATED") return "QUEUED";
  if (value === "RUNNING" || value === "IN_PROGRESS" || value === "PROCESSING" || value === "GENERATING") return "IN_PROGRESS";
  if (value === "SUCCEEDED" || value === "SUCCESS" || value === "COMPLETED" || value === "DONE") return "SUCCESS";
  if (/^FAILED/i.test(value)) return "FAILURE";
  if (value === "FAILURE" || value === "ERROR" || value === "CANCELLED" || value === "CANCELED" || value === "TIMEOUT") return "FAILURE";
  return "UNKNOWN";
}

/** 成功时取视频直链(上游字段:object) */
function resultUrl(root) {
  const candidates = [root && root.object, root && root.url, root && root.video_url, root && root.result_url];
  for (const candidate of candidates) {
    const url = trimmed(candidate);
    if (isHttpUrl(url)) return url;
  }
  return "";
}

export function parseTaskResult(ctx, body, response) {
  const root = body && typeof body === "object" ? body : {};

  if (response && response.status >= 400) {
    return { status: "FAILURE", reason: "upstream HTTP " + response.status + (trimmed(root.message) ? ":" + trimmed(root.message) : "") };
  }

  const failure = upstreamError(root);
  if (failure) return { status: "FAILURE", reason: failure };

  const rawStatus = trimmed(root.status);
  const status = mapStatus(rawStatus);
  if (status === "UNKNOWN") {
    return { status: "UNKNOWN", reason: "unknown task status: " + rawStatus };
  }

  const result = { status: status };
  const progress = root.progress;
  if (progress !== undefined && progress !== null && progress !== "") {
    result.progress = String(progress).indexOf("%") >= 0 ? String(progress) : String(progress) + "%";
  }
  if (status === "FAILURE") result.reason = failureTextFromStatus(rawStatus) || trimmed(root.message) || "";
  if (status === "SUCCESS") {
    const url = resultUrl(root);
    if (url) result.url = url;
  }
  return result;
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  const url = resultUrl((task && task.data) || {});
  return url ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  const task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  const url = resultUrl((task && task.data) || {});
  if (url) return { url: url, method: "GET", credentialless: true };
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
    const data = (task && task.data) || {};
    const output = {
      task_id: task && task.task_id,
      model: trimmed(data.model),
      status: task && task.status,
      progress: (task && task.progress) || "0%",
    };
    if (task && task.status === "SUCCESS") {
      const url = resultUrl(data);
      if (url) output.result_url = url;
    }
    if (task && task.status === "FAILURE") {
      output.fail_reason = trimmed(task.fail_reason) || trimmed(data.fail_reason) || "task failed";
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
          "meaicc 上游只接受公网 URL 素材,不支持直接上传文件;" +
          "请在盐值AI「设置 → 视频 → 参考素材中转」中选择图床/OSS 等公网地址后重试"
        );
      }

      const prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");
      req.prompt = prompt;
      req.seconds = pickDuration(req);

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
      if (task && task.status === "SUCCESS") {
        const url = resultUrl(data);
        if (url) output.url = url; // 便于客户端直接取直链(成片只缓存 10 小时)
      }
      if (task && task.status === "FAILURE") {
        output.error = {
          message: trimmed(task.fail_reason) || trimmed(data.fail_reason) || "task failed",
          code: "",
        };
      }
      return output;
    },
  },
};
