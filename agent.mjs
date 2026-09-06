import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.CHDEVAGENT_PORT || process.env.PORT || 8228);
const HOST = process.env.HOST || "127.0.0.1";
const WORKSPACE = path.resolve(process.env.CHDEVAGENT_WORKSPACE || path.join(process.cwd(), "workspace"));
const PAIRING_CODE = String(process.env.CHDEVAGENT_PAIRING_CODE || Math.floor(100000 + Math.random() * 900000));
const MAX_BODY = 32 * 1024;

const devices = new Map();
const tasks = new Map();
const audit = [];
const activeControllers = new Map();

await fs.mkdir(WORKSPACE, { recursive: true });

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(6).toString("hex")}`; }
function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(payload));
}
function text(res, status, payload) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}
function record(type, data = {}) {
  const event = { id: id("evt"), at: now(), type, ...data };
  audit.unshift(event);
  if (audit.length > 300) audit.length = 300;
  return event;
}
function tokenHash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function getToken(req) { return String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); }
function getDevice(req) {
  const token = getToken(req);
  if (!token) return null;
  const device = devices.get(tokenHash(token));
  if (!device || device.revoked) return null;
  return device;
}
function safePath(relative = ".") {
  const candidate = path.resolve(WORKSPACE, relative);
  if (candidate !== WORKSPACE && !candidate.startsWith(`${WORKSPACE}${path.sep}`)) {
    throw new Error("Path is outside the approved workspace");
  }
  return candidate;
}
async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error("Request body too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}
function requireDevice(req, res) {
  const device = getDevice(req);
  if (!device) {
    json(res, 401, { error: "paired_device_required" });
    return null;
  }
  device.lastSeenAt = now();
  return device;
}
function taskSummary(task) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    status: task.status,
    instruction: task.instruction,
    source: task.source,
    requestedTools: task.requestedTools,
    preview: task.preview,
    result: task.result || null,
    error: task.error || null,
  };
}
async function listWorkspace(relative = ".") {
  const target = safePath(relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
}
async function readWorkspaceFile(relative) {
  const target = safePath(relative);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Only files can be read");
  if (stat.size > 1024 * 1024) throw new Error("File is larger than the 1MB MVP limit");
  return fs.readFile(target, "utf8");
}
async function executeTask(task) {
  if (task.cancelled) return;
  task.status = "executing";
  task.updatedAt = now();
  record("task.executing", { taskId: task.id });
  const controller = new AbortController();
  activeControllers.set(task.id, controller);
  try {
    if (task.requestedTools.includes("file.list")) {
      task.result = { workspace: WORKSPACE, entries: await listWorkspace(task.relativePath || ".") };
    } else if (task.requestedTools.includes("file.read")) {
      task.result = { path: task.relativePath, content: await readWorkspaceFile(task.relativePath) };
    } else {
      throw new Error("No executable tool in the MVP registry");
    }
    if (task.cancelled) return;
    task.status = "succeeded";
    task.updatedAt = now();
    record("task.succeeded", { taskId: task.id });
  } catch (error) {
    if (task.cancelled) return;
    task.status = "failed";
    task.error = error instanceof Error ? error.message : "Task failed";
    task.updatedAt = now();
    record("task.failed", { taskId: task.id, error: task.error });
  } finally {
    activeControllers.delete(task.id);
  }
}
function createTask(body, device) {
  const instruction = String(body.instruction || "").trim();
  const requestedTools = Array.isArray(body.requestedTools) ? body.requestedTools.map(String) : ["file.list"];
  const supported = new Set(["file.list", "file.read"]);
  const allowedTools = requestedTools.filter((tool) => supported.has(tool));
  if (!instruction) throw new Error("instruction_required");
  if (!allowedTools.length) throw new Error("no_allowed_tools");
  const task = {
    id: id("task"),
    createdAt: now(),
    updatedAt: now(),
    status: "awaiting_approval",
    instruction,
    source: "paired_device",
    deviceId: device.id,
    requestedTools: allowedTools,
    relativePath: String(body.relativePath || "."),
    preview: {
      action: allowedTools.includes("file.read") ? "Read a file inside the approved workspace" : "List files inside the approved workspace",
      scope: path.posix.join("/workspace", String(body.relativePath || ".")),
      permission: "read-only",
      impact: "No files are changed",
    },
  };
  tasks.set(task.id, task);
  record("task.created", { taskId: task.id, deviceId: device.id, tools: allowedTools });
  return task;
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const method = req.method || "GET";
  if (method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET,POST,OPTIONS" });
    return res.end();
  }
  if (method === "GET" && url.pathname === "/") {
    const html = await fs.readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(html);
  }
  if (method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, service: "chdevagent-agent", version: "0.1.0", host: os.hostname(), workspace: WORKSPACE, pairedDevices: [...devices.values()].filter((d) => !d.revoked).length });
  if (method === "GET" && url.pathname === "/api/pairing/status") return json(res, 200, { pairingRequired: true, codeHint: `${PAIRING_CODE.slice(0, 2)}••••`, workspace: WORKSPACE });
  if (method === "POST" && url.pathname === "/api/pairing/confirm") {
    const body = await readBody(req);
    if (String(body.code || "") !== PAIRING_CODE) return json(res, 403, { error: "invalid_pairing_code" });
    const rawToken = crypto.randomBytes(24).toString("base64url");
    const device = { id: id("device"), name: String(body.deviceName || "Paired phone"), tokenHash: tokenHash(rawToken), pairedAt: now(), lastSeenAt: now(), revoked: false };
    devices.set(device.tokenHash, device);
    record("device.paired", { deviceId: device.id, name: device.name });
    return json(res, 201, { device: { id: device.id, name: device.name, pairedAt: device.pairedAt }, token: rawToken });
  }
  if (method === "GET" && url.pathname === "/api/devices") {
    const device = requireDevice(req, res); if (!device) return;
    return json(res, 200, { devices: [...devices.values()].filter((d) => !d.revoked).map(({ tokenHash: _, ...safe }) => safe) });
  }
  if (method === "POST" && url.pathname === "/api/tasks") {
    const device = requireDevice(req, res); if (!device) return;
    try { const task = createTask(await readBody(req), device); return json(res, 201, taskSummary(task)); }
    catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "invalid_task" }); }
  }
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(approve|reject|cancel))?$/);
  if (taskMatch) {
    const device = requireDevice(req, res); if (!device) return;
    const task = tasks.get(taskMatch[1]);
    if (!task || task.deviceId !== device.id) return json(res, 404, { error: "task_not_found" });
    const action = taskMatch[2];
    if (method === "GET" && !action) return json(res, 200, taskSummary(task));
    if (method === "POST" && action === "approve") {
      if (task.status !== "awaiting_approval") return json(res, 409, { error: "task_not_awaiting_approval" });
      task.status = "approved"; task.updatedAt = now(); record("task.approved", { taskId: task.id, deviceId: device.id });
      setTimeout(() => executeTask(task), 50);
      return json(res, 200, taskSummary(task));
    }
    if (method === "POST" && action === "reject") {
      if (task.status !== "awaiting_approval") return json(res, 409, { error: "task_not_awaiting_approval" });
      task.status = "rejected"; task.updatedAt = now(); record("task.rejected", { taskId: task.id, deviceId: device.id });
      return json(res, 200, taskSummary(task));
    }
    if (method === "POST" && action === "cancel") {
      if (["succeeded", "failed", "rejected", "cancelled"].includes(task.status)) return json(res, 409, { error: "task_already_finished" });
      task.cancelled = true; task.status = "cancelled"; task.updatedAt = now(); activeControllers.get(task.id)?.abort(); record("task.cancelled", { taskId: task.id, deviceId: device.id });
      return json(res, 200, taskSummary(task));
    }
  }
  if (method === "GET" && url.pathname === "/api/tasks") {
    const device = requireDevice(req, res); if (!device) return;
    return json(res, 200, { tasks: [...tasks.values()].filter((task) => task.deviceId === device.id).map(taskSummary) });
  }
  if (method === "GET" && url.pathname === "/api/audit") {
    const device = requireDevice(req, res); if (!device) return;
    return json(res, 200, { events: audit.filter((event) => !event.deviceId || event.deviceId === device.id) });
  }
  return json(res, 404, { error: "not_found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    record("gateway.error", { error: error instanceof Error ? error.message : "unknown" });
    json(res, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" });
  });
});
server.listen(PORT, HOST, () => {
  console.log(`ChDevAgent local gateway listening at http://${HOST}:${PORT}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Pairing code: ${PAIRING_CODE}`);
  console.log("This MVP exposes read-only workspace tools only.");
});
