/**
 * videopipe (VideoPipe · 创作站) — NewAPI 任务插件 · 视频专用
 * 上游: https://videopipe.cc
 *
 * 上游契约（实测确认，2026-11-18）:
 *   POST /v1/videos/generations   创建任务
 *        body: { prompt, ratio, durationSeconds, images: [ {url} ] }
 *        - images 的元素是**对象**（AiSite.Core.Dtos.Open.OpenMaterialInput），
 *          不是字符串；传 ["https://..."] 会被 ASP.NET 模型绑定按 400 拒掉。
 *        - 缺 prompt → 400 {code:"INVALID_TASK_PARAMETERS", message:"提示词不能为空"}
 *   GET  /v1/tasks/{数字id}       查询任务（id 是整数，非 GUID）
 *        不存在 → 404 {code:"TASK_NOT_FOUND", message:"任务不存在：N"}
 *   GET  /v1/balance              余额，返回 {points:N}
 *
 * ⚠️ 与 OpenAI Videos 的差异（必须翻译，不能透传）:
 *   1. 路径不同：上游是 /v1/videos/generations + /v1/tasks/{id}，
 *      而不是 /v1/videos + /v1/videos/{id}。
 *   2. 时长字段叫 durationSeconds（不是 seconds）；比例叫 ratio（不是 size）。
 *   3. 参考图必须包成 [{url}]，且只收公网 URL。
 *   4. 上游没有 /v1/models（实测返回 SPA 兜底 HTML），也没有 model 参数 ——
 *      模型是站点默认档，因此本插件只声明一个对外模型名。
 *   5. 错误体是 {code, message}，成功体字段未经真实任务确认 ⇒ 解析一律**宽容**
 *      （多候选字段名 + 多状态同义词），拿到一条真实响应后可再收窄。
 *
 * 变更记录:
 *   1.0.0  首版：零成本探针确认的字段集与路径；宽容响应解析
 *   1.0.1  补齐宿主钩子（listArtifacts / buildContentRequest / native / protocols）——
 *          rc.51 下缺 listArtifacts 会整份拒装
 */

var DEFAULT_BASE_URL = "https://videopipe.cc";

/** 对外声明的模型名（上游无模型列表，站点只有一个默认档；渠道模型名可自行改） */
var MODELS = ["videopipe-video"];

export const meta = {
  apiVersion: 1,
  key: "videopipe",
  name: "VideoPipe",
  icon: "text:vp",
  description: {
    en: "VideoPipe (videopipe.cc) creative-station video generation, credits billing.",
    zh: "VideoPipe 创作站（videopipe.cc）视频生成，积分计费。",
  },
  version: "1.0.1",
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

function canonicalModel(model) {
  var name = trimmed(model);
  if (!name) return MODELS[0];
  for (var i = 0; i < MODELS.length; i += 1) {
    if (MODELS[i].toLowerCase() === name.toLowerCase()) return MODELS[i];
  }
  return name;
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

function clientPrompt(req) {
  var direct = trimmed(req && req.prompt) || trimmed(fieldOf(req, "prompt"));
  if (direct) return direct;
  return trimmed(requestTextParts(req));
}

/* ------------------------------------------------------------------ *
 * 素材：上游要 [{url}]，只收公网 https
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

/**
 * 上游 images 元素是对象（OpenMaterialInput），且只接受公网可抓取的地址。
 * base64 / 已上传文件在这里就报错，别让上游按 400 甩一坨 ASP.NET 校验错误。
 */
function requireHttps(list, label) {
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
  return ok;
}

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

function pickRatio(req) {
  var raw = trimmed(req && req.ratio) || trimmed(fieldOf(req, "ratio")) ||
    trimmed(req && req.aspect_ratio) || trimmed(fieldOf(req, "aspect_ratio")) ||
    trimmed(fieldOf(req, "aspectRatio"));
  if (!raw) {
    // 客户端只给像素 size 时反推比例（1280x720 → 16:9）
    var size = trimmed(req && req.size) || trimmed(fieldOf(req, "size"));
    var m = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(size);
    if (m) {
      var w = Number(m[1]);
      var h = Number(m[2]);
      if (w && h) {
        var g = gcd(w, h);
        return w / g + ":" + h / g;
      }
    }
    return "";
  }
  return raw.replace(/\s*[x×*]\s*/i, ":");
}

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

function pickDuration(req) {
  var candidates = [
    req && req.durationSeconds, req && req.duration, req && req.seconds,
    fieldOf(req, "durationSeconds"), fieldOf(req, "duration"), fieldOf(req, "seconds"),
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = Number(candidates[i]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return 0; // 0 = 不传，交给上游默认
}

/* ------------------------------------------------------------------ *
 * 提交
 * ------------------------------------------------------------------ */

function buildVideoBody(ctx, req) {
  var prompt = clientPrompt(req);
  if (!prompt) {
    // 网关侧直接拒，0ms、不打上游、不扣积分
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
  ]), "图片");

  // 上游 images 元素是对象：{url}
  var materials = images.map(function (url) { return { url: url }; });

  var body = { prompt: prompt };
  var ratio = pickRatio(req);
  if (ratio) body.ratio = ratio;
  var duration = pickDuration(req);
  if (duration > 0) body.durationSeconds = duration;
  body.images = materials;

  return body;
}

export function buildSubmitRequest(ctx) {
  var req = decodeAnyObject(ctx && ctx.body).req;
  var model = canonicalModel(trimmed(ctx && ctx.model) || fieldOf(req, "model"));
  var body = buildVideoBody(ctx, req);
  var base = channelBaseUrl(ctx);
  return {
    url: base + "/v1/videos/generations",
    method: "POST",
    headers: jsonHeaders(ctx && ctx.apiKey),
    body: body,
    model: model,
  };
}

/* ------------------------------------------------------------------ *
 * 响应解析（宽容：上游成功体未经真实任务确认）
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
  var id = dig(payload, [
    "taskId", "task_id", "id", "task.id", "data.taskId", "data.task_id", "data.id",
    "result.taskId", "result.id",
  ]);
  if (id === undefined) return "";
  var text = trimmed(id);
  return text;
}

function pickStatus(payload) {
  var s = dig(payload, ["status", "state", "taskStatus", "task.status", "data.status", "data.state"]);
  return trimmed(s).toLowerCase();
}

function pickProgress(payload) {
  var p = dig(payload, ["progress", "percent", "percentage", "task.progress", "data.progress"]);
  var n = Number(p);
  if (!Number.isFinite(n)) return undefined;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function pickVideoUrl(payload) {
  var u = dig(payload, [
    "videoUrl", "video_url", "url", "downloadUrl", "download_url", "outputUrl", "output_url",
    "resultUrl", "result_url", "task.videoUrl", "data.videoUrl", "data.url",
    "result.videoUrl", "result.url", "outputs.0.url", "videos.0.url",
  ]);
  var text = trimmed(u);
  return /^https?:\/\//i.test(text) ? text : "";
}

function pickErrorMessage(payload) {
  var m = dig(payload, ["error.message", "errorMessage", "message", "msg", "failReason", "data.message"]);
  var code = dig(payload, ["error.code", "code", "data.code"]);
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
    var msg = pickErrorMessage(payload) || ("上游返回 HTTP " + status);
    throw new Error("VideoPipe 创建任务失败：" + msg);
  }
  var taskId = pickTaskId(payload);
  if (!taskId) {
    throw new Error(
      "VideoPipe 创建任务的响应里取不到任务 ID（已尝试 taskId / task_id / id / data.*）。原始响应：" +
      JSON.stringify(payload).slice(0, 400)
    );
  }
  return {
    taskId: taskId,
    taskData: payload,
    state: {
      __outbound: buildOutboundSnapshot(ctx, payload),
    },
  };
}

function buildOutboundSnapshot(ctx, payload) {
  try {
    var req = decodeAnyObject(ctx && ctx.body).req;
    var body = buildVideoBody(ctx, req);
    return {
      plugin: "videopipe",
      version: "1.0.1",
      url: channelBaseUrl(ctx) + "/v1/videos/generations",
      method: "POST",
      body: body,
      bytes: JSON.stringify(body).length,
      responseId: pickTaskId(payload),
    };
  } catch (e) {
    return { plugin: "videopipe", version: "1.0.1", error: "未能复算上游报文：" + (e && e.message ? e.message : String(e)) };
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

var DONE = ["completed", "complete", "succeeded", "success", "done", "finished"];
var FAILED = ["failed", "failure", "error", "canceled", "cancelled", "rejected", "expired"];
var RUNNING = ["running", "processing", "generating", "in_progress", "inprogress", "working"];

export function parseTaskResult(ctx, res) {
  var payload = res && res.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  var httpStatus = Number(res && res.status) || 0;
  if (httpStatus >= 400 || !payload || typeof payload !== "object") {
    var errMsg = pickErrorMessage(payload) || ("上游返回 HTTP " + httpStatus);
    return { status: "FAILURE", reason: "VideoPipe 查询失败：" + errMsg };
  }

  var state = pickStatus(payload);
  var progress = pickProgress(payload);
  var url = pickVideoUrl(payload);

  if (FAILED.indexOf(state) >= 0) {
    return { status: "FAILURE", reason: pickErrorMessage(payload) || ("任务状态 " + state) };
  }
  if (url && (DONE.indexOf(state) >= 0 || !state)) {
    return { status: "SUCCESS", url: url, progress: 100 };
  }
  if (DONE.indexOf(state) >= 0 && !url) {
    // 状态说完成但没给可下载地址（可能需要调 /content 或产物字段换了名字）
    return {
      status: "FAILURE",
      reason: "任务已完成但响应里没有可下载的视频地址（字段名可能与预期不同）：" + JSON.stringify(payload).slice(0, 300),
    };
  }
  var result = { status: "IN_PROGRESS" };
  if (progress !== undefined) result.progress = progress;
  return result;
}

/* ------------------------------------------------------------------ *
 * 宿主钩子：产物清单 / 内容下载 / 标准面渲染
 * （rc.51 起 openai_video 协议缺 listArtifacts 会整份拒装）
 * ------------------------------------------------------------------ */

export function listArtifacts(task) {
  if (!task || task.status !== "SUCCESS") return [];
  return pickVideoUrl(task.data || {}) ? [{ key: "video", type: "video" }] : [];
}

export function buildContentRequest(ctx) {
  var task = ctx && ctx.task ? ctx.task : { data: ctx && ctx.data, status: ctx && ctx.status };
  var url = pickVideoUrl((task && task.data) || {});
  if (!url) throw new Error("artifact_not_found");
  // 上游产物是第三方 CDN 直链：匿名可读，绝不带本站 Key（防盗链也可能因此失效）
  return { url: url, method: "GET", credentialless: true };
}

export const native = {
  decodeVideoSubmit: function (ctx) {
    return protocols.openai_video.decodeRequest(ctx);
  },
  taskCreated: function (ctx, task) {
    return protocols.openai_video.render(ctx, task);
  },
  taskStatus: function (_ctx, task) {
    var output = {
      task_id: task && task.task_id,
      model: trimmed((task && task.data && task.data.model) || ""),
      status: task && task.status,
      progress: (task && task.progress) || "0%",
    };
    var url = pickVideoUrl((task && task.data) || {});
    if (task && task.status === "SUCCESS" && url) output.result_url = url;
    if (task && task.status === "FAILURE") {
      output.fail_reason = trimmed(task.fail_reason) || "task failed";
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
