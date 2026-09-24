/**
 * gaisc (g-aisc.xyz) — NewAPI 任务插件 · 视频专用 · 按次计费
 * 上游: https://g-aisc.xyz/v1
 * 模型: 7 个 —— Doubao Seedance 2.5 / 2.0、MiniMax-H3、Google Veo 3.1 fast、HappyHorse t2v / i2v / r2v
 * 文档: 《g-aisc.xyz 视频生成 API》(2026-09-23 核对版,上游每个模型真实提交 + 首尾帧解析 + 图片上传全链路实测)
 *
 * 只做视频。计费口径 = 按次:价格配在网关「模型定价」的固定单价里,
 * 因此本插件**不声明 usageSchema**、不导出用量钩子(与同仓库 aicost / sudashui / meaicc 同款做法)。
 *
 * 对外路径(下游调用):
 *   视频(宿主 openai_video 协议,标准路径,盐值AI 走这条):
 *     POST   /v1/videos                    创建任务
 *     GET    /v1/videos/:task_id           查询任务
 *     GET    /v1/videos/:task_id/content   下载视频
 *   插件自有路径(直连调试用):
 *     POST   /gaisc/v1/videos/generations
 *     GET    /gaisc/v1/videos/tasks/:task_id
 *
 * 上游协议(逐字对齐官方文档):
 *   POST /v1/videos
 *     { model, prompt, seconds(★字符串,如 "5"),
 *       metadata: { resolution, ratio, content?: [{type:"image_url", role, image_url:{url}}] },
 *       images?: [公网URL | data URI | 纯 base64] }
 *   GET  /v1/videos/{id}
 *     { id, object, model, status, progress, created_at, completed_at, url? }
 *     status: queued | in_progress(★下划线) | completed | failed
 *     ★ url 只在 completed 时出现,是**无鉴权直链**,可直接播/下
 *   GET  /v1/videos/{id}/content   → mp4 字节(★必须带 Authorization,不适合给前端)
 *   GET  /v1/tasks/{id}/artifacts  → 带凭证的 content_url(本插件不用,免多一跳)
 *
 * ⚠ 上游五个坑(文档明写的「踩坑必读」):
 *   1. seconds 一律传**字符串** —— 除 doubao 外其余模型传数字直接 400
 *   2. resolution / ratio 必须写在 metadata 里,放顶层**不生效**(按默认值出片)
 *   3. 分辨率只有 480p / 720p / 1080p,且各模型白名单不同(没有 2K / 4K)
 *   4. **首尾帧与参考图不能同时用**,同时传时参考图会被上游丢弃 —— 本插件提前拦掉并报中文错
 *   5. 成片**只保留 1 小时**,过期后 url / content_url / /content 全部失效 → 尽快转存
 *
 * 素材形态:与 aicost / sudashui / meaicc 不同 —— g-aisc **同时支持**
 *   公网 URL / data URI / 纯 base64(写在 JSON 的 images 数组里),所以本插件不强制公网 URL。
 *   下游用 multipart 上传的文件会被内联成 data URL 再提交(宿主负责替换 {__fileRef} 占位)。
 *
 * 变更记录:
 *   1.0.0  首版(视频专用 · 按次 · 7 模型 · 按模型校验时长/分辨率/比例/素材上限)
 *   1.0.1  修复插件自有路由(/gaisc/v1/videos/generations)取不到 model 的问题:
 *          宿主协议路径会把 model 放进 ctx,自有路由的 ctx 里没有,需回落到 body.model
 */
export const meta = {
  apiVersion: 1,
  key: "gaisc",
  name: "g-aisc API",
  icon: "text:gaisc",
  description: {
    en: "g-aisc.xyz video generation (Doubao Seedance / MiniMax-H3 / Veo 3.1 / HappyHorse), per-call models.",
    zh: "g-aisc.xyz 视频生成(Doubao Seedance / MiniMax-H3 / Veo 3.1 / HappyHorse),仅按次计费模型。",
  },
  version: "1.0.1",
  author: { name: "g-aisc.xyz", url: "https://g-aisc.xyz" },
  baseUrl: "https://g-aisc.xyz",
  models: [
    "doubao-seedance-2-5-260628",
    "doubao-seedance-2-0-260128",
    "MiniMax-H3",
    "veo-3.1-fast-generate-001",
    "happyhorse-1.0-t2v",
    "happyhorse-1.0-i2v",
    "happyhorse-1.0-r2v",
  ],
  fetchMode: "per_task",
  allowedHosts: ["g-aisc.xyz"],
  protocols: [
    {
      name: "openai_video",
      models: [
        "doubao-seedance-2-5-260628",
        "doubao-seedance-2-0-260128",
        "MiniMax-H3",
        "veo-3.1-fast-generate-001",
        "happyhorse-1.0-t2v",
        "happyhorse-1.0-i2v",
        "happyhorse-1.0-r2v",
      ],
    },
  ],
  routes: [
    {
      method: "POST",
      path: "/gaisc/v1/videos/generations",
      type: "submit",
      action: "video",
      decode: "decodeVideoSubmit",
      render: "taskCreated",
    },
    {
      method: "GET",
      path: "/gaisc/v1/videos/tasks/:task_id",
      type: "query",
      render: "taskStatus",
    },
  ],
};

const DEFAULT_BASE_URL = "https://g-aisc.xyz";

/** 默认时长:5 秒在所有 7 个模型的合法区间内(doubao 4~30 / MiniMax 4~15 / veo 4|6|8 / happyhorse 3~15) */
const DEFAULT_SECONDS = 5;
/** 默认分辨率:720p 是所有模型的交集(MiniMax / Veo / HappyHorse 没有 480p) */
const DEFAULT_RESOLUTION = "720p";
/** 默认比例:上游不传时的默认值 */
const DEFAULT_RATIO = "16:9";

/** 参考图上限 / 首尾帧能力 —— 逐条取自文档第 1 节与第 5.4 节 */
const MODEL_SPECS = {
  "doubao-seedance-2-5-260628": {
    label: "Doubao Seedance 2.5",
    minSeconds: 4,
    maxSeconds: 30,
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    maxImages: 9,
    firstFrame: true,
    lastFrame: true,
  },
  "doubao-seedance-2-0-260128": {
    label: "Doubao Seedance 2.0",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["480p", "720p", "1080p"],
    ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    maxImages: 9,
    firstFrame: true,
    lastFrame: true,
  },
  "MiniMax-H3": {
    label: "MiniMax-H3",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    maxImages: 9,
    firstFrame: true,
    lastFrame: true,
  },
  "veo-3.1-fast-generate-001": {
    label: "Google Veo 3.1 fast",
    seconds: [4, 6, 8], // ★ 只能 4 / 6 / 8
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16"],
    maxImages: 1, // 只支持首帧 1 张
    firstFrame: true,
    lastFrame: false,
  },
  "happyhorse-1.0-t2v": {
    label: "HappyHorse t2v(文生视频)",
    minSeconds: 3,
    maxSeconds: 15,
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    maxImages: 0, // 文生视频,不要传图
    firstFrame: false,
    lastFrame: false,
    textOnly: true,
  },
  "happyhorse-1.0-i2v": {
    label: "HappyHorse i2v(图生视频)",
    minSeconds: 3,
    maxSeconds: 15,
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    maxImages: 1, // 首帧 1 张
    firstFrame: true,
    lastFrame: false,
  },
  "happyhorse-1.0-r2v": {
    label: "HappyHorse r2v(参考生视频)",
    minSeconds: 3,
    maxSeconds: 15,
    resolutions: ["720p", "1080p"],
    ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
    maxImages: 9,
    firstFrame: true,
    lastFrame: false,
  },
};

/** 常见「宽x高」写法 → 上游分辨率白名单 */
const SIZE_ALIASES = {
  "640x480": "480p",
  "854x480": "480p",
  "1280x720": "720p",
  "720x1280": "720p",
  "1920x1080": "1080p",
  "1080x1920": "1080p",
};

/** multipart 字段名 → 素材语义(与文档第 4 节表格逐字一致) */
const FILE_FIELDS = {
  input_reference: "first_frame",
  first_frame: "first_frame",
  start_frame: "first_frame",
  last_frame: "last_frame",
  end_frame: "last_frame",
  image: "reference_image",
  images: "reference_image",
  reference_image: "reference_image",
  reference_images: "reference_image",
};

const FILE_FIELD_HINT =
  "input_reference / first_frame / start_frame(首帧)、last_frame / end_frame(尾帧)、" +
  "image / images / reference_image / reference_images(参考图)";

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

function isDataUri(value) {
  return /^data:image\//i.test(trimmed(value));
}

/** 纯 base64(不带 data: 前缀)—— 文档第 4 节方式 B 明确支持 */
function isBareBase64(value) {
  const text = trimmed(value);
  return text.length > 64 && /^[A-Za-z0-9+/=\s]+$/.test(text);
}

function isFilePlaceholder(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.__fileRef);
}

function specOf(model) {
  const spec = MODEL_SPECS[trimmed(model)];
  if (!spec) {
    throw new Error(
      "gaisc 不支持模型 " + trimmed(model) + ",可用模型:" + Object.keys(MODEL_SPECS).join(" / ")
    );
  }
  return spec;
}

/* ------------------------------------------------------------------ *
 * 请求体解码(JSON / multipart)
 * ------------------------------------------------------------------ */

function decodeAnyObject(body) {
  if (!body || typeof body !== "object") return { req: {}, files: [] };
  if (body.kind === "multipart" || body.kind === "form") {
    const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
    const req = {};
    for (const key of Object.keys(fields)) {
      const value = fields[key];
      req[key] = Array.isArray(value) && value.length === 1 ? value[0] : value;
    }
    // 方式 C 的 multipart 把 metadata 当**字符串字段**传(-F 'metadata={"resolution":"720p"}'),这里解开
    if (typeof req.metadata === "string") {
      try {
        const parsed = JSON.parse(req.metadata);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) req.metadata = parsed;
      } catch (error) {
        // 解析不了就保持原样,交给后面的字段解析兜底
      }
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

/** 盐值AI 统一视频入口写 @Image1,上游文档写 @image1 —— 统一转成上游写法 */
function normalizeReferences(prompt) {
  return prompt.replace(/@Image\s*(\d+)/gi, "@image$1");
}

/* ------------------------------------------------------------------ *
 * 素材:公网 URL / data URI / 纯 base64 / 宿主文件占位,四种都收
 * ------------------------------------------------------------------ */

function materialValue(value) {
  if (typeof value === "string") return trimmed(value);
  if (isFilePlaceholder(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["url", "image_url", "imageUrl", "image", "src", "uri", "file_url", "value"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && trimmed(candidate)) return trimmed(candidate);
    if (candidate && typeof candidate === "object" && typeof candidate.url === "string") return trimmed(candidate.url);
  }
  return null;
}

function collectMaterials(values) {
  const out = [];
  const seen = [];
  const walk = function (value) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const material = materialValue(value);
    if (material === null) return;
    if (typeof material === "string") {
      const text = trimmed(material);
      if (!text || seen.indexOf(text) >= 0) return; // 同一个字段名被顶层与 metadata 同时命中时去重
      seen.push(text);
      out.push(text);
      return;
    }
    out.push(material);
  };
  values.forEach(walk);
  return out;
}

function materialKind(material) {
  if (isFilePlaceholder(material)) return "upload";
  if (isHttpUrl(material)) return "url";
  if (isDataUri(material)) return "data";
  if (isBareBase64(material)) return "base64";
  return "unknown";
}

/**
 * 校验素材形态。g-aisc 上游由服务端自己取素材,但它**同时支持**公网 URL / data URI / 纯 base64
 * (JSON 的 images 数组),所以这里不像 aicost/sudashui 那样强制公网 URL。
 */
function requireMaterials(list, label) {
  const bad = [];
  for (const material of list) {
    const kind = materialKind(material);
    if (kind === "unknown") {
      bad.push(typeof material === "string" ? material.slice(0, 40) : "无法识别的素材");
    }
  }
  if (bad.length) {
    throw new Error(
      "参考" + label + "必须是 公网 http(s) URL、data URI 或 base64 字符串,本次收到:" +
      bad.join("、") + "。请检查素材地址是否完整(上游服务端需要能取到该素材)。"
    );
  }
  return list;
}

function limitOf(list, max, label) {
  if (list.length > max) {
    throw new Error("参考" + label + "最多 " + max + " 个,本次提交 " + list.length + " 个,请删减后重试");
  }
  return list;
}

/* ------------------------------------------------------------------ *
 * 参数解析(逐模型白名单)
 * ------------------------------------------------------------------ */

function firstNumber(candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** 时长:离散白名单(veo 4|6|8)取最接近;区间模型夹取到 [min,max];返回字符串(★上游要求) */
function pickSeconds(spec, req) {
  const raw = firstNumber([
    req && req.seconds,
    req && req.duration,
    fieldOf(req, "seconds"),
    fieldOf(req, "duration"),
  ]);
  if (raw === null) {
    return { seconds: String(DEFAULT_SECONDS), requested: null, adjusted: false };
  }
  if (Array.isArray(spec.seconds) && spec.seconds.length) {
    let best = spec.seconds[0];
    for (const value of spec.seconds) {
      const delta = Math.abs(value - raw);
      const bestDelta = Math.abs(best - raw);
      // 距离相同取更大的(拍 7 秒时给 8 秒,别悄悄砍短)
      if (delta < bestDelta || (delta === bestDelta && value > best)) best = value;
    }
    return { seconds: String(best), requested: raw, adjusted: best !== raw };
  }
  const rounded = Math.round(raw);
  const clamped = Math.min(spec.maxSeconds, Math.max(spec.minSeconds, rounded));
  return { seconds: String(clamped), requested: raw, adjusted: clamped !== raw };
}

function pickResolution(spec, model, req) {
  const raw = trimmed(req && req.resolution) || trimmed(fieldOf(req, "resolution")) ||
    trimmed(req && req.size) || trimmed(fieldOf(req, "size"));
  if (!raw) return DEFAULT_RESOLUTION;
  const lower = raw.toLowerCase().replace(/\s/g, "");
  const alias = SIZE_ALIASES[lower];
  const candidate = alias || lower;
  if (spec.resolutions.indexOf(candidate) >= 0) return candidate;
  throw new Error(
    "gaisc 的 " + model + " 分辨率只支持 [" + spec.resolutions.join(", ") + "](上游没有 2K / 4K),收到:" + raw
  );
}

/** 比例:白名单外提前报错(上游会返回 plugin_usage_invalid,本地报错信息更清楚) */
function pickRatio(spec, model, req) {
  const raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (!raw) return DEFAULT_RATIO;
  const norm = raw.replace(/[×xX*]/g, ":").replace(/\s/g, "");
  if (/^(auto|adaptive|default|origin|original)$/i.test(norm)) return DEFAULT_RATIO;
  if (spec.ratios.indexOf(norm) >= 0) return norm;
  throw new Error(
    "gaisc 的 " + model + " 比例只支持 [" + spec.ratios.join(", ") + "],收到:" + raw
  );
}

function frameUrlOf(req, keys) {
  for (const key of keys) {
    const value = req && req[key] !== undefined && req[key] !== null ? req[key] : fieldOf(req, key);
    const material = materialValue(value);
    if (material) return material;
  }
  return null;
}

/**
 * 客户端直接按上游形状传 metadata.content(或 content)时,原样采纳并校验。
 * role 归一:first/start → first_frame,last/end → last_frame,**不写 role → 普通参考图**(文档 5.1)。
 */
function explicitContent(req) {
  const raw = req && req.content !== undefined ? req.content : fieldOf(req, "content");
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = trimmed(item.role);
    const url = materialValue(item.image_url) || materialValue(item);
    if (!url) continue;
    let normalizedRole = "";
    if (/^(last|end)/i.test(role)) normalizedRole = "last_frame";
    else if (/^(first|start)/i.test(role)) normalizedRole = "first_frame";
    out.push({ role: normalizedRole, value: url });
  }
  return out.length ? out : null;
}

/** multipart 上传的文件 → 宿主 {__fileRef} 占位(宿主会内联成 data URL,上游 images 支持 data URI) */
function attachUploaded(req, files) {
  if (!files || !files.length) return;
  const uploaded = [];
  for (const file of files) {
    const field = trimmed(file && file.field);
    const semantics = FILE_FIELDS[field];
    if (!semantics) {
      throw new Error("unexpected file field: " + (field || "(空)") + " (supported: " + FILE_FIELD_HINT + ")");
    }
    const ref = trimmed(file && file.ref) || "request_file:" + field;
    uploaded.push({
      semantics: semantics,
      value: { __fileRef: ref, encoding: "dataUrl", mimeType: trimmed(file && file.mimeType) || undefined },
    });
  }
  req.__uploaded = uploaded;
}

/* ------------------------------------------------------------------ *
 * 组装上游 body
 * ------------------------------------------------------------------ */

/**
 * 把「统一视频入口 / OpenAI 兼容」请求体翻译成 g-aisc 上游 body。
 * 返回 { body, plan } —— plan 供落库快照与排查用。
 */
function buildVideoBody(ctx, req, model) {
  const spec = specOf(model);

  const prompt = normalizeReferences(clientPrompt(req));
  if (!prompt) throw new Error("prompt is required");

  const secondsPlan = pickSeconds(spec, req);
  const resolution = pickResolution(spec, model, req);
  const ratio = pickRatio(spec, model, req);

  /* ---- 首尾帧:上游 metadata.content ---- */
  const frames = [];
  const contentImages = [];
  const content = explicitContent(req);
  if (content) {
    // 客户端直接给了上游形状的 content:以它为准,不再读 first_frame_url 等字段
    for (const item of content) {
      if (item.role) frames.push(item);
      else contentImages.push(item.value); // 不写 role = 普通参考图
    }
  } else {
    const first = frameUrlOf(req, ["first_frame_url", "firstFrameUrl", "first_frame", "start_frame", "startFrame"]);
    const last = frameUrlOf(req, ["last_frame_url", "lastFrameUrl", "last_frame", "end_frame", "endFrame"]);
    if (first) frames.push({ role: "first_frame", value: first });
    if (last) frames.push({ role: "last_frame", value: last });
  }
  const uploaded = Array.isArray(req && req.__uploaded) ? req.__uploaded : [];
  for (const item of uploaded) {
    if (item.semantics === "first_frame" || item.semantics === "last_frame") {
      frames.push({ role: item.semantics, value: item.value });
    }
  }

  /* ---- 参考图:上游 images 数组 ---- */
  const images = contentImages.concat(collectMaterials([
    req && req.image, req && req.images, req && req.image_urls, req && req.image_url,
    req && req.reference_images, req && req.image_refs,
    fieldOf(req, "image"), fieldOf(req, "images"), fieldOf(req, "image_urls"),
    fieldOf(req, "reference_images"), fieldOf(req, "image_refs"),
  ]));
  for (const item of uploaded) {
    if (item.semantics === "reference_image") images.push(item.value);
  }

  /* ---- 参考视频 / 音频:g-aisc 的 JSON 接口没有对应字段,提前拦掉别静默丢 ---- */
  const videos = collectMaterials([
    req && req.videos, req && req.video_urls, req && req.reference_videos,
    fieldOf(req, "videos"), fieldOf(req, "video_urls"), fieldOf(req, "reference_videos"),
  ]);
  const audios = collectMaterials([
    req && req.audios, req && req.audio_urls, req && req.audio_reference, req && req.audio_references,
    fieldOf(req, "audios"), fieldOf(req, "audio_urls"), fieldOf(req, "audio_reference"),
  ]);
  if (videos.length || audios.length) {
    throw new Error(
      "g-aisc 的视频接口只支持**图片**参考(images 数组),不接受参考视频 / 参考音频;" +
      "本次收到 " + videos.length + " 个视频、" + audios.length + " 个音频,请去掉后重试"
    );
  }

  /* ---- 上游语义限制:首尾帧与参考图不能同时用 ---- */
  if (frames.length && images.length) {
    throw new Error(
      "g-aisc 上游限制:首尾帧与参考图不能同时使用(同时传时参考图会被丢弃);" +
      "本次收到 " + frames.length + " 个首/尾帧、" + images.length + " 张参考图,请二选一后重试"
    );
  }
  if (spec.textOnly && (frames.length || images.length)) {
    throw new Error("gaisc 的 " + model + " 是文生视频模型,不接受首帧 / 参考图,请改用 i2v / r2v 模型");
  }
  if (frames.length && !spec.firstFrame) {
    throw new Error("gaisc 的 " + model + " 不支持首帧图,请改用支持首帧的模型");
  }
  const hasLast = frames.some(function (item) { return item.role === "last_frame"; });
  if (hasLast && !spec.lastFrame) {
    throw new Error("gaisc 的 " + model + " 不支持尾帧图(尾帧与首帧不能同时给),请改用 doubao-seedance-* 或 MiniMax-H3");
  }

  requireMaterials(images, "图片");
  limitOf(images, spec.maxImages, "图片");

  /* ---- 组 body ---- */
  const metadata = { resolution: resolution, ratio: ratio };
  if (frames.length) {
    metadata.content = frames.map(function (item) {
      return {
        type: "image_url",
        role: item.role || "first_frame",
        image_url: isFilePlaceholder(item.value) ? item.value : { url: item.value },
      };
    });
  }

  const body = {
    model: model,
    prompt: prompt,
    seconds: secondsPlan.seconds, // ★ 字符串
    metadata: metadata,
  };
  if (images.length) body.images = images;

  return {
    body: body,
    plan: {
      prompt: prompt,
      seconds: secondsPlan.seconds,
      secondsRequested: secondsPlan.requested,
      secondsAdjusted: secondsPlan.adjusted,
      resolution: resolution,
      ratio: ratio,
      firstFrame: frames.filter(function (item) { return item.role !== "last_frame"; }).length,
      lastFrame: hasLast ? 1 : 0,
      imageCount: images.length,
      imageKinds: images.map(materialKind).filter(function (kind, index, list) { return list.indexOf(kind) === index; }),
    },
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
  const decoded = decodeAnyObject(ctx && ctx.body);
  const req = decoded.req;
  const model = trimmed(ctx && ctx.model) || trimmed(req.model);
  if (!model) throw new Error("model is required");
  const prompt = clientPrompt(req);
  if (!prompt) throw new Error("prompt is required");
  attachUploaded(req, decoded.files);
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
    if (typeof root.error === "string") return trimmed(root.error);
    return trimmed(root.error.message) || trimmed(root.error.code) || "upstream error";
  }
  if (root.success === false) return trimmed(root.message) || "upstream error";
  return "";
}

/** 失败原因:优先 error.message,其次顶层 message,最后原文 */
function failureReason(root, rawStatus) {
  const detail = upstreamError(root);
  if (detail) return detail;
  const message = trimmed(root && root.message);
  if (message) return message;
  return "上游返回 " + (trimmed(rawStatus) || "FAILED") + "(未附错误信息)";
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
    snap.seconds = plan.seconds;
    snap.resolution = plan.resolution;
    snap.ratio = plan.ratio;
    if (plan.secondsAdjusted) snap.seconds_requested = plan.secondsRequested;
    if (plan.firstFrame) snap.first_frame = true;
    if (plan.lastFrame) snap.last_frame = true;
    if (plan.imageCount) snap.reference_images_count = plan.imageCount;
    if (plan.imageKinds && plan.imageKinds.length) snap.reference_image_kinds = plan.imageKinds;
  }
  const uploaded = (req && req.__uploaded) || [];
  if (uploaded.length) snap.uploaded_files = uploaded.length;
  return snap;
}

export function parseSubmitResponse(ctx, resp) {
  const root = (resp && resp.body) || {};
  const failure = upstreamError(root);
  if (failure) throw new Error(failure);

  const taskId = trimmed(root.task_id) || trimmed(root.id);
  if (!taskId) {
    throw new Error(trimmed(root.message) || "missing task_id in upstream response");
  }
  return { taskId: taskId, taskData: root, state: { request: requestSnapshot(ctx) } };
}

function mapStatus(raw) {
  const value = trimmed(raw).toLowerCase();
  if (!value) return "UNKNOWN";
  if (value === "queued" || value === "queueing" || value === "pending" || value === "created" ||
    value === "submitted" || value === "waiting") return "QUEUED";
  if (value === "in_progress" || value === "processing" || value === "running" || value === "generating") {
    return "IN_PROGRESS";
  }
  if (value === "completed" || value === "succeeded" || value === "success" || value === "done") return "SUCCESS";
  if (value === "failed" || value === "failure" || value === "error" || value === "cancelled" ||
    value === "canceled" || value === "timeout" || value === "expired") return "FAILURE";
  return "UNKNOWN";
}

/** 成片直链:上游完成时给 url(无鉴权,可直接播/下);object 在提交阶段是字符串 "video",放最后兜底 */
function resultUrl(root) {
  const candidates = [root && root.url, root && root.video_url, root && root.result_url, root && root.object];
  for (const candidate of candidates) {
    const url = trimmed(candidate);
    if (isHttpUrl(url)) return url;
  }
  return "";
}

export function parseTaskResult(ctx, body, response) {
  const root = body && typeof body === "object" ? body : {};

  if (response && response.status >= 400) {
    return {
      status: "FAILURE",
      reason: "upstream HTTP " + response.status + (upstreamError(root) ? ":" + upstreamError(root) : ""),
    };
  }

  const rawStatus = trimmed(root.status);
  const status = mapStatus(rawStatus);
  if (status === "UNKNOWN") {
    // 只有 error 没有 status 的响应,也判失败,别把错误当「排队中」一直轮询
    if (upstreamError(root)) return { status: "FAILURE", reason: upstreamError(root) };
    return { status: "UNKNOWN", reason: "unknown task status: " + rawStatus };
  }

  const result = { status: status };
  const progress = root.progress;
  if (progress !== undefined && progress !== null && progress !== "") {
    result.progress = String(progress).indexOf("%") >= 0 ? String(progress) : String(progress) + "%";
  }
  if (status === "FAILURE") result.reason = failureReason(root, rawStatus);
  if (status === "SUCCESS") {
    const url = resultUrl(root);
    if (url) result.url = url; // ★ 上游直链(只保留 1 小时,尽快转存)
  }
  return result;
}

export function listArtifacts(task) {
  if (!task || trimmed(task.status).toUpperCase() !== "SUCCESS") return [];
  // 即使拿不到直链,也能走 /v1/videos/{id}/content 取字节,所以统一声明 video 产物
  return [{ key: "video", type: "video", mimeType: "video/mp4" }];
}

export function buildContentRequest(ctx) {
  const data = (ctx && ctx.data) || {};
  const direct = resultUrl(data);
  if (direct) {
    // 上游直链无鉴权,credentialless 拉取(不受 allowedHosts 限制,少一跳)
    return { url: direct, method: "GET", credentialless: true };
  }
  const taskId = trimmed(ctx && ctx.upstreamTaskId) || trimmed(ctx && ctx.taskId);
  if (taskId) {
    // 文档 6.3:返回 mp4 字节,必须带 Authorization(域名在 allowedHosts 内)
    return {
      url: channelBaseUrl(ctx) + "/v1/videos/" + encodeURIComponent(taskId) + "/content",
      method: "GET",
      headers: authHeaders(ctx && ctx.apiKey),
    };
  }
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
      // 宿主协议路径会把 model 放进 ctx;插件自有路由的 ctx 里没有 model,回落到 body
      const model = trimmed(ctx && ctx.model) || trimmed(req.model);
      if (!model) throw new Error("model is required");

      const prompt = clientPrompt(req);
      if (!prompt) throw new Error("prompt is required");

      // multipart 上传的文件 → {__fileRef} 占位,宿主会内联成 data URL
      attachUploaded(req, decoded.files);

      req.prompt = prompt;
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
        if (url) output.url = url; // 便于客户端直接取直链(成片只保留 1 小时)
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
