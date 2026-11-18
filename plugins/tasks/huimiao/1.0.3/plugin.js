/**
 * huimiao (Huimiao AI 慧喵) — NewAPI 任务插件 · 视频专用
 * 上游: https://huimiaovip.com     文档: https://huimiaovip.com/docs/api-guide.md
 * OpenAPI: https://huimiaovip.com/openapi.yaml
 *
 * 上游契约（原生入口，与 OpenAI Videos 不同，需要翻译）:
 *   POST   /v1/videos/generations                    创建（必须 Idempotency-Key，成功 202）
 *   GET    /v1/videos/generations/{id}               查询
 *   DELETE /v1/videos/generations/{id}               取消（仅 queued）
 *   GET    /v1/videos/{id}/content                   下载
 *   GET    /v1/models                                模型目录（动态）
 *
 *   创建体（严格解析，未声明字段 → 400 unsupported_field）:
 *     { prompt, model?, task_type?, ratio?, duration?, resolution?,
 *       asset_keys?, image_urls?, image_url?, audio_urls?, video_urls? }
 *
 *   任务对象: { id:"task_123", public_id:"HM-...", status, progress(0-100),
 *              created_at, updated_at, completed_at, download_expires_at,
 *              download_url, usage:{credits}, error:{code,message} }
 *   status ∈ queued | in_progress | completed | failed
 *
 * ⚠️ 三个必须在本插件内处理的上游特性:
 *   1. **严格字段白名单** —— 上游对任何未声明字段直接 400，所以绝不能把客户端
 *      的 size / quality / output_compression / metadata 之类原样透传，必须显式重建 body。
 *   2. **参考图只收公网 HTTPS** —— data: base64 一律拒（上游在冻结积分前校验），
 *      这里明确报错并指路 /v1/files 中转，而不是静默丢弃导致"图没生效"。
 *   3. **幂等键格式** —— 8~80 位，仅字母数字 . _ : - ；每次提交生成新键
 *      （同一键同参数会被上游判为同一任务并返回原任务，会阻止用户重复生成同提示词）。
 *
 * 计费: 上游是"积分"制（unit=credit），分按条(per_item)与按秒(per_second)两种；
 *       本插件不参与计费，价格在 New API 渠道侧配置。
 *
 * 变更记录:
 *   1.0.3  中文别名进 meta.models / protocols.models —— 宿主的 "is not served by this plugin"
 *          校验只认声明列表，别名不进列表会在 decodeRequest 之后被宿主拦下
 *   1.0.2  支持中文模型别名（MODEL_ALIASES）：New API 渠道 model_mapping 对任务插件不生效，
 *          中文名须在插件侧翻译成上游 id
 *   1.0.0  首版：声明 20 个视频模型；原生 generations 面 + 严格白名单 + 幂等键 + 直链下载
 *   1.0.1  素材/参数解析广谱兼容：支持 OpenAI 标准面 input_reference / size 与首尾帧别名；
 *          检测 asset_keys 等上游直传键并明确报错（网关跨账户用不了，静默丢弃会导致"图没生效"）
 */

var DEFAULT_BASE_URL = "https://huimiaovip.com";

/** 模型能力表（来自上游 GET /v1/models 实测；上游会变，改版时按目录重抓） */
var MODEL_SPECS = {
  "hm-video-sd-2.5-flash-gz": { minDur: 5, maxDur: 30, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 10, maxAudios: 5, maxVideos: 5, maxPrompt: 15000, caps: ["image_to_video", "audio_reference", "video_reference"] },
  "hm-video-wan3.0-gf": { minDur: 2, maxDur: 30, resolutions: ["480p", "720p", "1080p"], defaultResolution: "480p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 10, maxAudios: 5, maxVideos: 5, maxPrompt: 20000, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-video-wan3.0-prime-gf": { minDur: 2, maxDur: 30, resolutions: ["480p", "720p", "1080p"], defaultResolution: "480p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 10, maxAudios: 5, maxVideos: 5, maxPrompt: 20000, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-video-sd-2.0-mini-gz": { minDur: 4, maxDur: 15, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 3, maxPrompt: 15000, caps: ["image_to_video", "audio_reference", "video_reference"] },
  "hm-video-sd-2.0-fast-gz": { minDur: 4, maxDur: 15, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 3, maxPrompt: 15000, caps: ["image_to_video", "audio_reference", "video_reference"] },
  "hm-video-sd-2.0-full-gz": { minDur: 4, maxDur: 15, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 3, maxPrompt: 15000, caps: ["image_to_video", "audio_reference", "video_reference"] },
  "hm-video-wan3.0-deal-mm": { minDur: 5, maxDur: 30, resolutions: ["720p", "480p", "1080p"], defaultResolution: "720p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 10, maxAudios: 5, maxVideos: 5, maxPrompt: 7000, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-sd-2.5-30-0-10-m": { minDur: 4, maxDur: 30, resolutions: ["720p"], defaultResolution: "720p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 30, maxAudios: 10, maxVideos: 0, maxPrompt: 10000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
  "hm-video-sd-2.5-full-gz": { minDur: 5, maxDur: 30, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 30, maxAudios: 10, maxVideos: 10, maxPrompt: 15000, caps: ["image_to_video", "audio_reference", "video_reference"] },
  "hm-video-vidu-q4-mm": { minDur: 2, maxDur: 16, resolutions: ["720p", "1080p", "480p"], defaultResolution: "720p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 10, maxAudios: 3, maxVideos: 0, maxPrompt: 7000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
  "hm-sd-2.5-30-0-10-mm": { minDur: 4, maxDur: 30, resolutions: ["720p"], defaultResolution: "720p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 30, maxAudios: 10, maxVideos: 0, maxPrompt: 10000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
  "hm-video-h3-768-gz-jj": { minDur: 4, maxDur: 15, resolutions: ["768p"], defaultResolution: "768p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 3, maxPrompt: 7000, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-video-h3-2k-gz-jj": { minDur: 4, maxDur: 15, resolutions: ["2k"], defaultResolution: "2k", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 3, maxPrompt: 7000, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-video-sd-2.5-deal-persecond": { minDur: 4, maxDur: 30, resolutions: ["720p", "480p"], defaultResolution: "720p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 10, maxAudios: 5, maxVideos: 5, maxPrompt: 8000, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-video-heygen-nn": { minDur: 15, maxDur: 15, resolutions: ["720p"], defaultResolution: "720p", ratios: ["16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 0, maxPrompt: 7000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
  "hm-sd-2.5-30-0-10-gz-persecond-ll": { minDur: 4, maxDur: 30, resolutions: ["480p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 30, maxAudios: 10, maxVideos: 10, maxPrompt: 9999, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-sd-2.5-30-0-10-720-gz-persecond-ll": { minDur: 4, maxDur: 30, resolutions: ["720p"], defaultResolution: "720p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 30, maxAudios: 10, maxVideos: 10, maxPrompt: 9999, caps: ["text_to_video", "image_to_video", "audio_reference", "video_reference"] },
  "hm-sd-2.0-mini-gz": { minDur: 4, maxDur: 15, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 0, maxPrompt: 8000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
  "hm-sd-2.0-fast-gz": { minDur: 4, maxDur: 15, resolutions: ["480p", "720p"], defaultResolution: "480p", ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], maxImages: 9, maxAudios: 3, maxVideos: 0, maxPrompt: 8000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
  "hm-wan3.0-prime-deal-mc": { minDur: 5, maxDur: 30, resolutions: ["1080p"], defaultResolution: "1080p", ratios: ["16:9", "4:3", "1:1", "9:16"], maxImages: 10, maxAudios: 5, maxVideos: 0, maxPrompt: 10000, caps: ["text_to_video", "image_to_video", "audio_reference"] },
};

var MODELS = Object.keys(MODEL_SPECS);

/**
 * 站点中文别名 → 上游模型 id。
 * ⚠️ New API 的渠道 model_mapping 对**任务插件这条路不生效**（插件拿到的 ctx.model 仍是
 * 客户端传来的原名），所以要用中文模型名，必须在插件侧翻译。别名表只含本站自建的中文名，
 * 对其他站点无副作用；上游新增中文名时在此追加并 +1 版本。
 */
var MODEL_ALIASES = {
  "官转-Sd-2.5-flash-支持人脸": "hm-video-sd-2.5-flash-gz",
  "官转-Sd-2.0-fast-支持人脸": "hm-video-sd-2.0-fast-gz",
};

function resolveAlias(model) {
  var name = trimmed(model);
  if (!name) return "";
  if (MODEL_ALIASES[name]) return MODEL_ALIASES[name];
  var lower = name.toLowerCase();
  var keys = Object.keys(MODEL_ALIASES);
  for (var i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === lower) return MODEL_ALIASES[keys[i]];
  }
  return name;
}

/** 对外可服务模型 = 上游真实 id + 中文别名（宿主的 "is not served by this plugin" 校验看这份） */
var SERVED_MODELS = MODELS.concat(Object.keys(MODEL_ALIASES));

export const meta = {
  apiVersion: 1,
  key: "huimiao",
  name: "Huimiao AI",
  icon: "text:hm",
  description: {
    en: "Huimiao AI (huimiaovip.com) video generation, 20 models, credits billing.",
    zh: "慧喵 Huimiao AI(huimiaovip.com)视频生成,20 个模型,积分计费。",
  },
  version: "1.0.3",
  author: { name: "Huimiao AI", url: "https://huimiaovip.com/" },
  baseUrl: DEFAULT_BASE_URL,
  models: SERVED_MODELS,
  fetchMode: "per_task",
  allowedHosts: ["huimiaovip.com"],
  protocols: [
    {
      name: "openai_video",
      models: SERVED_MODELS,
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
  return Object.assign(
    { "Content-Type": "application/json; charset=utf-8" },
    authorizationHeader(apiKey)
  );
}

function specOf(model) {
  var name = resolveAlias(model);
  if (!name) return null;
  if (MODEL_SPECS[name]) return MODEL_SPECS[name];
  var lower = name.toLowerCase();
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === lower) return MODEL_SPECS[MODELS[i]];
  }
  return null;
}

function canonicalModel(model) {
  var name = resolveAlias(model);
  if (MODEL_SPECS[name]) return name;
  var lower = name.toLowerCase();
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === lower) return MODELS[i];
  }
  return name;
}

/**
 * 幂等键：8~80 位，只允许英文字母/数字/点/下划线/冒号/短横线。
 * 每次提交生成新键 —— 上游对"同键同参数"返回原任务（不重复扣费），
 * 但那样用户重复提交同一提示词就永远拿到同一个视频，所以这里必须每次新键。
 */
function newIdempotencyKey() {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var rand = "";
  for (var i = 0; i < 12; i += 1) rand += chars.charAt(Math.floor(Math.random() * chars.length));
  return "hm_" + Date.now() + "_" + rand;
}

/* ------------------------------------------------------------------ *
 * 请求体解码（JSON / multipart）
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

/** 分辨率代号 → 短边像素，用于把客户端 size 提示吸附到模型支持的档位 */
var RES_SIDE = { "480p": 480, "720p": 720, "768p": 768, "1080p": 1080, "2k": 1440, "4k": 2160 };

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

/**
 * 解析客户端常见的像素 size（OpenAI Videos 面用 `size` 而不是 `ratio`/`resolution`）：
 *   "1280x720" → { ratio: "16:9", shortSide: 720 }
 * 非像素形式（如 "720p"）返回 null，交给 resolution 分支处理。
 */
function parseSizeHint(size) {
  var text = trimmed(size);
  if (!text) return null;
  var m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(text);
  if (!m) return null;
  var w = Number(m[1]);
  var h = Number(m[2]);
  if (!w || !h) return null;
  var g = gcd(w, h);
  return { ratio: w / g + ":" + h / g, shortSide: Math.min(w, h), width: w, height: h };
}

/** 把短边像素吸附到该模型支持的最近分辨率（只看 supported_resolutions） */
function nearestResolution(shortSide, spec) {
  var best = spec.defaultResolution;
  var bestDiff = Infinity;
  for (var i = 0; i < spec.resolutions.length; i += 1) {
    var code = spec.resolutions[i];
    var side = RES_SIDE[String(code).toLowerCase()];
    if (!side) continue;
    var diff = Math.abs(side - shortSide);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = code;
    }
  }
  return best;
}

/**
 * 上游只接受公网 HTTPS 地址（localhost / 私有网段 / 用户名密码 / 非 443 一律在冻结积分前被拒）。
 * data: base64 与已上传文件在这里就报错，别让客户端以为"提交成功但图没生效"。
 */
function requireHttps(list, label, max, directKeyCount) {
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
  // 客户端只传了上游直传对象键（asset_keys）、一张图都没给 URL —— 直说原因，
  // 否则会静默按"无参考图"提交，客户拿到一段跟参考图无关的视频。
  if (!ok.length && directKeyCount > 0) {
    throw new Error(
      "检测到 asset_keys（上游直传对象键）但没有公网 " + label + " 地址。对象键绑定上传者账户，网关用的另一把 key 无法使用它" +
      "（上游会判对象不属于当前账户）。请改传公网 https 地址：本地文件先经「设置 → 视频 → 参考素材中转 → 自定义上传接口」" +
      "（https://img.qlike.top/v1/files）转成直链，或直接用图床 / OSS 的 https 链接重试。"
    );
  }
  if (rejected.length) {
    var unique = rejected.filter(function (v, idx) { return rejected.indexOf(v) === idx; });
    throw new Error(
      "Huimiao 的参考" + label + "只接受公网 https 地址，本次收到：" + unique.join("、") +
      "。请先在「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 https://img.qlike.top/v1/files 把本地文件/base64 转成公网直链，或改用图床 / OSS 的 https 地址后重试。"
    );
  }
  if (ok.length > max) {
    throw new Error("该模型的参考" + label + "上限是 " + max + " 个，本次提交 " + ok.length + " 个，请删减后重试");
  }
  return ok;
}

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */

function pickDuration(req, spec) {
  var candidates = [
    req && req.duration, req && req.seconds,
    fieldOf(req, "duration"), fieldOf(req, "seconds"),
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = Number(candidates[i]);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(spec.maxDur, Math.max(spec.minDur, Math.round(value)));
    }
  }
  // 上游默认 5 秒；模型不支持 5 秒时落到下限，避免直接 400
  return Math.min(spec.maxDur, Math.max(spec.minDur, 5));
}

function pickResolution(req, spec, model) {
  var raw = trimmed(req && req.resolution) || trimmed(fieldOf(req, "resolution"));
  if (!raw) {
    // 客户端只给了 size（OpenAI Videos 面常见）→ 按短边就近吸附
    var hint = parseSizeHint(req && req.size) || parseSizeHint(fieldOf(req, "size"));
    return hint ? nearestResolution(hint.shortSide, spec) : spec.defaultResolution;
  }
  var lower = raw.toLowerCase();
  for (var i = 0; i < spec.resolutions.length; i += 1) {
    if (String(spec.resolutions[i]).toLowerCase() === lower) return spec.resolutions[i];
  }
  throw new Error(
    "模型 " + model + " 支持的分辨率是 " + spec.resolutions.join(" / ") + "，收到：" + raw +
    "（上游不做静默吸附，请显式改成受支持的值）"
  );
}

function pickRatio(req, spec, model) {
  var raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (!raw) {
    // 没给比例时先用 size 推断；推断不出来才用模型首位比例
    var hint = parseSizeHint(req && req.size) || parseSizeHint(fieldOf(req, "size"));
    if (hint && spec.ratios.indexOf(hint.ratio) >= 0) return hint.ratio;
    return spec.ratios[0];
  }
  var norm = raw.replace(/\s*[x×*]\s*/i, ":");
  if (spec.ratios.indexOf(norm) >= 0) return norm;
  if (spec.ratios.indexOf(raw) >= 0) return raw;
  // 显式比例不受支持时报错（上游不做静默吸附），但把可用值列出来
  throw new Error(
    "模型 " + model + " 支持的比例是 " + spec.ratios.join(" / ") + "，收到：" + raw
  );
}

function pickTaskType(images, spec, model) {
  if (images.length) return "image_to_video";
  if ((spec.caps || []).indexOf("text_to_video") < 0) {
    throw new Error(
      "模型 " + model + " 不支持纯文生视频（必须至少 1 张参考图），请补参考图或换模型"
    );
  }
  return "text_to_video";
}

/* ------------------------------------------------------------------ *
 * 提交
 * ------------------------------------------------------------------ */

/**
 * 构建上游创建体。
 * **严格白名单**：上游对任何未声明字段返回 400 unsupported_field，
 * 所以这里逐字段重建，不 Object.assign 客户端原始 req。
 */
function buildVideoBody(ctx, req, model) {
  var spec = specOf(model);
  if (!spec) {
    throw new Error("huimiao 插件只声明了 " + MODELS.join(" / ") + "，收到：" + model);
  }

  var prompt = clientPrompt(req);
  if (!prompt) throw new Error("prompt is required");
  if (prompt.length > spec.maxPrompt) {
    throw new Error("提示词 " + prompt.length + " 字符，超过模型 " + model + " 的上限 " + spec.maxPrompt + " 字符，请精简后重试");
  }

  // 上游直传对象键（asset_keys）绑账户，网关这把 key 用不了别人的对象 ——
  // 静默忽略会生成一段"没有参考图"的视频，所以这里必须显式拦下来。
  var directKeys = collectMedia([
    req.asset_keys, req.audio_asset_keys, req.video_asset_keys,
    fieldOf(req, "asset_keys"), fieldOf(req, "audio_asset_keys"), fieldOf(req, "video_asset_keys"),
  ]).filter(function (v) { return trimmed(v) && !/^https?:\/\//i.test(v) && !/^data:/i.test(v); });

  var images = requireHttps(collectMedia([
    // 本插件惯用 + 各家客户端常见别名
    req.image, req.images, req.image_urls, req.reference_images, req.reference_image,
    req.image_url, req.image_list, req.material_urls,
    // OpenAI Videos 标准面：input_reference（单个）与首尾帧
    req.input_reference, req.input_references,
    req.first_frame_url, req.first_frame, req.start_frame,
    req.last_frame_url, req.last_frame, req.end_frame,
    fieldOf(req, "image"), fieldOf(req, "images"), fieldOf(req, "image_urls"),
    fieldOf(req, "reference_images"), fieldOf(req, "input_reference"),
    fieldOf(req, "first_frame_url"), fieldOf(req, "last_frame_url"),
  ]), "图片", spec.maxImages, directKeys.length);

  var audios = requireHttps(collectMedia([
    req.audios, req.audio_urls, req.audio_reference, req.audio_references, req.audio,
    req.audio_url, req.audio_list,
    fieldOf(req, "audios"), fieldOf(req, "audio_urls"), fieldOf(req, "audio_reference"),
  ]), "音频", spec.maxAudios, directKeys.length);

  var videos = requireHttps(collectMedia([
    req.videos, req.video_urls, req.reference_videos, req.video,
    req.video_url, req.video_list,
    fieldOf(req, "videos"), fieldOf(req, "video_urls"), fieldOf(req, "reference_videos"),
  ]), "视频", spec.maxVideos, directKeys.length);

  var duration = pickDuration(req, spec);
  var resolution = pickResolution(req, spec, model);
  var ratio = pickRatio(req, spec, model);
  var taskType = pickTaskType(images, spec, model);

  var body = {
    model: model,
    prompt: prompt,
    task_type: taskType,
    ratio: ratio,
    duration: duration,
    resolution: resolution,
  };
  if (images.length) body.image_urls = images;
  if (audios.length) body.audio_urls = audios;
  if (videos.length) body.video_urls = videos;

  return {
    body: body,
    plan: {
      taskType: taskType,
      duration: duration,
      resolution: resolution,
      ratio: ratio,
      imageCount: images.length,
      audioCount: audios.length,
      videoCount: videos.length,
      images: images,
    },
  };
}

function requestSnapshot(ctx) {
  var req = decodeJsonObject(ctx);
  if (!req || Object.keys(req).length === 0) {
    var fallback = ctx && ctx.requestBody;
    if (fallback && typeof fallback === "object") req = fallback;
  }
  var images = collectMedia([
    req.image, req.images, req.image_urls, req.reference_images,
    fieldOf(req, "image"), fieldOf(req, "image_urls"),
  ]);
  var model = trimmed(ctx && ctx.model);
  var spec = specOf(model);
  return {
    model: model,
    upstream_model: trimmed(ctx && ctx.upstreamModel),
    prompt: trimmed(req && req.prompt).slice(0, 2000),
    reference_images_sent: images.length,
    reference_images_https: images.filter(function (u) { return /^https:\/\//i.test(u); }).length,
    reference_images_base64: images.filter(function (u) { return /^data:/i.test(u); }).length,
    duration: spec ? pickDuration(req, spec) : null,
    resolution: spec ? spec.defaultResolution : null,
    client_keys: Object.keys(req || {}).slice(0, 30),
  };
}

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

/** 复算上游报文写进 plugin_state.__outbound（绝不抛） */
function outboundSnapshot(ctx) {
  var desc;
  try {
    desc = buildSubmitRequest(ctx);
  } catch (e) {
    return { plugin: "huimiao", version: "1.0.3", error: "未能复算上游报文:" + (e && e.message ? e.message : String(e)) };
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
      plugin: "huimiao", version: "1.0.3", url: desc.url, method: desc.method,
      body: flat, body_omitted: "报文整体超过 16KB,已降级为顶层标量字段",
      bytes: text.length,
    };
  }
  return {
    plugin: "huimiao",
    version: "1.0.3",
    url: desc.url,
    method: desc.method,
    body: body,
    bytes: text ? text.length : 0,
  };
}

export function buildSubmitRequest(ctx) {
  var req = (ctx && ctx.requestBody) || {};
  var model = canonicalModel(trimmed(ctx && ctx.upstreamModel) || trimmed(ctx && ctx.model) || trimmed(req.model));
  if (!model) throw new Error("model is required");

  var built = buildVideoBody(ctx, req, model);
  var headers = jsonHeaders(ctx && ctx.apiKey);
  headers["Idempotency-Key"] = newIdempotencyKey();

  return {
    url: channelBaseUrl(ctx) + "/v1/videos/generations",
    method: "POST",
    headers: headers,
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
    url: channelBaseUrl(ctx) + "/v1/videos/generations/" + encodeURIComponent(ctx.taskId),
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
  var value = trimmed(raw).toLowerCase();
  if (!value) return "UNKNOWN";
  if (value === "queued" || value === "queueing" || value === "pending" || value === "submitted" || value === "created" || value === "waiting") return "QUEUED";
  if (value === "in_progress" || value === "running" || value === "processing" || value === "generating") return "IN_PROGRESS";
  if (value === "completed" || value === "success" || value === "succeeded" || value === "done") return "SUCCESS";
  if (value === "failed" || value === "failure" || value === "error" || value === "cancelled" || value === "canceled" || value === "timeout") return "FAILURE";
  return "UNKNOWN";
}

/** 上游 progress 是 0~100 整数 */
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

/**
 * 成品地址：download_url（可能=本站 /content 入口，也可能=临时直链）
 * 直链到期/不可用时用 download_fallback_url，最后退回本站 content 接口。
 */
function resultUrlOf(outer, inner) {
  var candidates = [outer.download_url, outer.download_fallback_url, inner.download_url, inner.download_fallback_url, outer.url, inner.url];
  for (var i = 0; i < candidates.length; i += 1) {
    var url = trimmed(candidates[i]);
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return "";
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
    var url = resultUrlOf(outer, inner);
    if (url) result.url = url;
  }
  return result;
}

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  var parts = layers((task && task.data) || {});
  return resultUrlOf(parts.outer, parts.inner) ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  var task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  var parts = layers((task && task.data) || {});
  var base = channelBaseUrl(ctx);
  var url = resultUrlOf(parts.outer, parts.inner);
  var taskId = trimmed(ctx && ctx.taskId) || trimmed(parts.outer.id) || trimmed(task && task.task_id);

  // 本站 content 入口需要鉴权；临时直链是匿名可读的，绝不能带上本站 Key
  if (url && url.indexOf(base + "/v1/videos/") === 0) {
    return { url: url, method: "GET", headers: authorizationHeader(ctx && ctx.apiKey) };
  }
  if (url) return { url: url, method: "GET", credentialless: true };

  if (taskId) {
    return {
      url: base + "/v1/videos/" + encodeURIComponent(taskId) + "/content",
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
      model: trimmed(parts.outer.model) || trimmed(parts.inner.model),
      status: task && task.status,
      progress: (task && task.progress) || "0%",
    };
    if (task && task.status === "SUCCESS") {
      var url = resultUrlOf(parts.outer, parts.inner);
      if (url) output.result_url = url;
    }
    if (task && task.status === "FAILURE") {
      output.fail_reason = trimmed(task.fail_reason) || failureReason(parts.root, parts.outer, parts.inner) || "task failed";
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
      var model = canonicalModel(trimmed(ctx && ctx.model));
      if (!model) throw new Error("model is required");
      if (!specOf(model)) {
        throw new Error("huimiao 插件只声明了 " + MODELS.join(" / ") + "，收到：" + model);
      }
      if (files.length) {
        throw new Error(
          "Huimiao 上游按公网 https 地址取素材，不支持直接上传文件；请先在「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 https://img.qlike.top/v1/files 转成公网直链后重试"
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
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      var data = (task && task.data) || {};
      var parts = layers(data);
      var output = {
        id: task && task.task_id,
        object: "video",
        model: trimmed(parts.outer.model) || trimmed(parts.inner.model),
        status: statusMap[trimmed(task && task.status).toUpperCase()] || "queued",
        progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      };
      if (task && task.status === "SUCCESS") {
        var url = resultUrlOf(parts.outer, parts.inner);
        if (url) output.result_url = url;
      }
      if (task && task.status === "FAILURE") {
        output.error = {
          message: trimmed(task.fail_reason) || failureReason(parts.root, parts.outer, parts.inner) || "task failed",
          code: "",
        };
      }
      return output;
    },
  },
};
