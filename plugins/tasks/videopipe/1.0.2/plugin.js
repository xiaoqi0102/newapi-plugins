/**
 * videopipe (VideoPipe · 创作站) — NewAPI 任务插件 · 视频专用
 * 上游: https://videopipe.cc     文档: https://videopipe.cc/docs
 *
 * 上游契约（官方文档 + 零成本探针双重确认，2026-11-18）:
 *   POST /v1/videos/generations
 *     { prompt*, mode?, ratio*, durationSeconds*, images?:[{url}], skipFaceProcess? }
 *   GET  /v1/tasks/{id}              id 是 long，但以**字符串**返回（JS 不能用 number 接）
 *   GET  /v1/tasks/output-url/{id}   产物 CDN 签名过期后刷新地址
 *   GET  /v1/balance                 {points:N}
 *
 *   响应: { id, status, createdAt, finishedAt, outputUrl, outputUrls[], points }
 *   status ∈ pending | processing | succeeded | failed | timeout | cancelled
 *   判定完成的唯一依据是 status === "succeeded"；其余状态 outputUrl 一律 null。
 *
 * 三档 mode（ratio/images 上限完全相同，只有时长与计价不同；全部 5 积分/任务）:
 *   mode=2.0        时长 5 / 10 / 15 秒（默认档）
 *   mode=dola2.0    固定 15 秒
 *   mode=sd-20-10s  固定 10 秒
 *   ⇒ 插件把它们映射成三个对外模型，方便各自定价。
 *
 * ⚠️ 必须翻译、不能透传的点:
 *   1. 路径不同：/v1/videos/generations + /v1/tasks/{id}，不是 OpenAI 的 /v1/videos。
 *   2. 时长字段叫 durationSeconds（必填）、比例叫 ratio（必填、且只认 6 个值）。
 *   3. images 的元素是**对象** [{url}]（ASP.NET DTO OpenMaterialInput），传字符串数组会被 400。
 *   4. 上游没有 /v1/models，也没有 model 参数 —— 模型=mode，由插件翻译。
 *   5. 产物是第三方 CDN 签名直链，会过期；过期后要走 /v1/tasks/output-url/{id} 刷新。
 *
 * 变更记录:
 *   1.0.0  首版：零成本探针确认的字段集与路径；宽容响应解析
 *   1.0.1  补齐宿主钩子（listArtifacts / buildContentRequest / native / protocols），rc.51 缺则拒装
 *   1.0.2  拿到官方文档后按真实契约重写：3 档 mode 映射模型、ratio/durationSeconds 必填且校验、
 *          timeout 归为失败、产物地址过期走 output-url 刷新、@ImageN 自动改写为上游的 @图N
 */

var DEFAULT_BASE_URL = "https://videopipe.cc";

/** 三档 mode —— 对外模型名带短横后缀，便于 New API 各自定价（都是 5 积分/任务） */
var MODE_SPECS = {
  "videopipe-2.0": { mode: "2.0", durations: [5, 10, 15], defaultDuration: 5 },
  "videopipe-dola2.0": { mode: "dola2.0", durations: [15], defaultDuration: 15 },
  "videopipe-sd-20-10s": { mode: "sd-20-10s", durations: [10], defaultDuration: 10 },
};

var MODELS = Object.keys(MODE_SPECS);
var RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
var MAX_IMAGES = 10;

export const meta = {
  apiVersion: 1,
  key: "videopipe",
  name: "VideoPipe",
  icon: "text:vp",
  description: {
    en: "VideoPipe (videopipe.cc) creative-station video generation: 3 modes, credits billing.",
    zh: "VideoPipe 创作站（videopipe.cc）视频生成，3 档模式，积分计费。",
  },
  version: "1.0.2",
  author: { name: "VideoPipe", url: "https://videopipe.cc/" },
  baseUrl: DEFAULT_BASE_URL,
  models: MODELS,
  fetchMode: "per_task",
  allowedHosts: ["videopipe.cc"],
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

function jsonHeaders(apiKey) {
  var key = trimmed(apiKey);
  var headers = { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" };
  if (key) headers.Authorization = /^Bearer\s/i.test(key) ? key : "Bearer " + key;
  return headers;
}

function specOf(model) {
  var name = trimmed(model);
  if (!name) return null;
  if (MODE_SPECS[name]) return MODE_SPECS[name];
  var lower = name.toLowerCase();
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === lower) return MODE_SPECS[MODELS[i]];
  }
  return null;
}

function canonicalModel(model) {
  var name = trimmed(model);
  if (MODE_SPECS[name]) return name;
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

/**
 * 上游用 `@图N` 引用第 N 张参考图；客户端常见写法是 @Image1 / @image1 / @图片1。
 * 统一改写成上游认的形式，避免提示词里的引用变成纯文本。
 */
function normalizeReferences(text) {
  return String(text || "").replace(/@(?:image|Image|IMAGE|img|图片)\s*(\d{1,2})/g, "@图$1");
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
      "VideoPipe 的参考" + label + "只接受公网 https 地址，本次收到：" + unique.join("、") +
      "。请先经「设置 → 视频 → 参考素材中转 → 自定义上传接口」把本地文件/base64 转成公网直链" +
      "（如 https://img.qlike.top/v1/files），或改用图床 / OSS 的 https 链接后重试。"
    );
  }
  if (max && ok.length > max) {
    throw new Error("VideoPipe 参考" + label + "最多 " + max + " 个，本次提交 " + ok.length + " 个，请删减后重试");
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

function pickRatio(req) {
  var raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (!raw) {
    var size = trimmed(req && req.size) || trimmed(fieldOf(req, "size"));
    var m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(size);
    if (m) {
      var w = Number(m[1]);
      var h = Number(m[2]);
      if (w && h) {
        var g = gcd(w, h);
        var derived = w / g + ":" + h / g;
        if (RATIOS.indexOf(derived) >= 0) return derived;
      }
    }
    return "16:9"; // 上游 ratio 必填，缺省给最常用的一档
  }
  var norm = raw.replace(/\s*[x×*]\s*/i, ":");
  if (RATIOS.indexOf(norm) >= 0) return norm;
  throw new Error("VideoPipe 支持的 ratio 是 " + RATIOS.join(" / ") + "，收到：" + raw);
}

function pickDuration(req, spec) {
  var candidates = [
    req && req.durationSeconds, req && req.duration, req && req.seconds,
    fieldOf(req, "durationSeconds"), fieldOf(req, "duration"), fieldOf(req, "seconds"),
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = Number(candidates[i]);
    if (Number.isFinite(value) && value > 0) {
      var rounded = Math.round(value);
      if (spec.durations.indexOf(rounded) >= 0) return rounded;
      // 不在该档允许的时长里：吸附到最近的一档
      var best = spec.durations[0];
      var bestDiff = Infinity;
      for (var j = 0; j < spec.durations.length; j += 1) {
        var diff = Math.abs(spec.durations[j] - rounded);
        if (diff < bestDiff) { bestDiff = diff; best = spec.durations[j]; }
      }
      return best;
    }
  }
  return spec.defaultDuration;
}

/* ------------------------------------------------------------------ *
 * 提交
 * ------------------------------------------------------------------ */

function buildVideoBody(ctx, req, model) {
  var spec = specOf(model);
  if (!spec) {
    throw new Error("videopipe 插件只声明了 " + MODELS.join(" / ") + "，收到：" + model);
  }
  var prompt = clientPrompt(req);
  if (!prompt) {
    // 网关侧直接拒：0ms、不打上游、不扣积分
    throw new Error("提示词不能为空：请在请求里给出 prompt（或 messages）");
  }

  var images = requireHttps(collectMedia([
    req.images, req.image, req.image_urls, req.reference_images, req.reference_image,
    req.image_url, req.image_list, req.material_urls,
    req.input_reference, req.input_references,
    req.first_frame_url, req.first_frame, req.start_frame,
    req.last_frame_url, req.last_frame, req.end_frame,
    fieldOf(req, "images"), fieldOf(req, "image"), fieldOf(req, "image_urls"),
    fieldOf(req, "reference_images"), fieldOf(req, "input_reference"),
  ]), "图片", MAX_IMAGES);

  var body = {
    prompt: prompt,
    mode: spec.mode,
    ratio: pickRatio(req),
    durationSeconds: pickDuration(req, spec),
    // 上游 images 元素是对象 {url}，传字符串数组会被 ASP.NET 模型绑定 400
    images: images.map(function (url) { return { url: url }; }),
  };

  // 可选：跳过人脸处理（上游默认 false = 会做人脸处理）
  var skipFace = fieldOf(req, "skipFaceProcess");
  if (skipFace === undefined) skipFace = fieldOf(req, "skip_face_process");
  if (skipFace !== undefined) body.skipFaceProcess = !!skipFace;

  return body;
}

export function buildSubmitRequest(ctx) {
  var req = decodeAnyObject(ctx && ctx.body).req;
  var model = canonicalModel(trimmed(ctx && ctx.model) || fieldOf(req, "model"));
  var body = buildVideoBody(ctx, req, model);
  return {
    url: channelBaseUrl(ctx) + "/v1/videos/generations",
    method: "POST",
    headers: jsonHeaders(ctx && ctx.apiKey),
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
  // 文档明确：id 是 long 但以字符串返回，JS 不能当 number 接
  var id = dig(payload, ["id", "taskId", "task_id", "task.id", "data.id", "data.taskId"]);
  if (id === undefined) return "";
  return trimmed(id);
}

function pickStatus(payload) {
  return trimmed(dig(payload, ["status", "state", "taskStatus", "task.status", "data.status"])).toLowerCase();
}

function pickVideoUrl(payload) {
  var u = dig(payload, [
    "outputUrl", "output_url", "videoUrl", "downloadUrl", "url",
    "outputUrls.0", "data.outputUrl", "data.outputUrls.0", "data.url",
  ]);
  var text = trimmed(u);
  return /^https?:\/\//i.test(text) ? text : "";
}

function pickErrorMessage(payload) {
  var m = dig(payload, ["message", "error.message", "errorMessage", "msg", "data.message"]);
  var code = dig(payload, ["code", "error.code", "data.code"]);
  var text = trimmed(m);
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
    throw new Error("VideoPipe 创建任务失败：" + (pickErrorMessage(payload) || ("上游返回 HTTP " + status)));
  }
  var taskId = pickTaskId(payload);
  if (!taskId) {
    throw new Error(
      "VideoPipe 创建任务的响应里取不到任务 ID（文档约定字段为 id，字符串形式）。原始响应：" +
      JSON.stringify(payload).slice(0, 400)
    );
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
      plugin: "videopipe",
      version: "1.0.2",
      url: channelBaseUrl(ctx) + "/v1/videos/generations",
      method: "POST",
      body: body,
      bytes: JSON.stringify(body).length,
      responseId: pickTaskId(payload),
    };
  } catch (e) {
    return {
      plugin: "videopipe",
      version: "1.0.2",
      error: "未能复算上游报文：" + (e && e.message ? e.message : String(e)),
    };
  }
}

/* ------------------------------------------------------------------ *
 * 查询 / 结果
 * ------------------------------------------------------------------ */

export function buildQueryRequest(ctx) {
  var taskId = trimmed(ctx && (ctx.taskId || ctx.task_id));
  if (!taskId) throw new Error("VideoPipe 查询任务缺少 taskId");
  return {
    url: channelBaseUrl(ctx) + "/v1/tasks/" + encodeURIComponent(taskId),
    method: "GET",
    headers: jsonHeaders(ctx && ctx.apiKey),
  };
}

var FAILED = ["failed", "failure", "timeout", "cancelled", "canceled", "error", "rejected", "expired"];
var RUNNING = ["pending", "queued", "processing", "running", "generating", "in_progress", "inprogress"];

export function parseTaskResult(ctx, res) {
  var payload = res && res.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  var httpStatus = Number(res && res.status) || 0;
  if (httpStatus >= 400 || !payload || typeof payload !== "object") {
    return {
      status: "FAILURE",
      reason: "VideoPipe 查询失败：" + (pickErrorMessage(payload) || ("上游返回 HTTP " + httpStatus)),
    };
  }

  var state = pickStatus(payload);
  var url = pickVideoUrl(payload);

  // 文档明确：判定完成的唯一依据是 status === succeeded
  if (FAILED.indexOf(state) >= 0) {
    return { status: "FAILURE", reason: pickErrorMessage(payload) || ("任务状态 " + state) };
  }
  if (state === "succeeded") {
    if (url) return { status: "SUCCESS", url: url, progress: 100 };
    return {
      status: "FAILURE",
      reason: "任务已 succeeded 但 outputUrl 为空（CDN 签名可能已过期），需走 /v1/tasks/output-url/{id} 刷新",
    };
  }
  var result = { status: "IN_PROGRESS" };
  if (state) result.progress = state === "pending" ? 5 : 50;
  return result;
}

/* ------------------------------------------------------------------ *
 * 宿主钩子（rc.51 的 openai_video 协议缺 listArtifacts 会整份拒装）
 * ------------------------------------------------------------------ */

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  return pickVideoUrl(task.data || {}) ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  var task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  var data = (task && task.data) || {};
  var url = pickVideoUrl(data);
  var taskId = trimmed(ctx && ctx.taskId) || trimmed(data.id) || trimmed(task && task.task_id);

  // 产物是第三方 CDN 签名直链：匿名可读，绝不能带本站 Key
  if (url) return { url: url, method: "GET", credentialless: true };

  // outputUrl 为空/过期 → 走官方刷新端点（仍需鉴权）
  if (taskId) {
    return {
      url: channelBaseUrl(ctx) + "/v1/tasks/output-url/" + encodeURIComponent(taskId),
      method: "GET",
      headers: jsonHeaders(ctx && ctx.apiKey),
    };
  }
  throw new Error("artifact_not_found");
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
      status: task && task.status,
      progress: (task && task.progress) || "0%",
    };
    var url = pickVideoUrl(data);
    if (task && task.status === "SUCCESS" && url) output.result_url = url;
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
      var model = canonicalModel(trimmed(ctx && ctx.model));
      if (!model) throw new Error("model is required");
      if (!specOf(model)) {
        throw new Error("videopipe 插件只声明了 " + MODELS.join(" / ") + "，收到：" + model);
      }
      if (files.length) {
        throw new Error(
          "VideoPipe 上游按公网 https 地址取素材，不支持直接上传文件；请先在「设置 → 视频 → 参考素材中转 → 自定义上传接口」填 https://img.qlike.top/v1/files 转成公网直链后重试"
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
      var output = {
        id: task && task.task_id,
        object: "video",
        model: trimmed(data.model || ""),
        status: statusMap[trimmed(task && task.status).toUpperCase()] || "queued",
        progress: Number(String((task && task.progress) || "0").replace("%", "")) || 0,
      };
      var url = pickVideoUrl(data);
      if (task && task.status === "SUCCESS" && url) output.result_url = url;
      if (task && task.status === "FAILURE") {
        output.error = { message: trimmed(task.fail_reason) || "task failed", code: "" };
      }
      return output;
    },
  },
};
