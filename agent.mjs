import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const VERSION = "0.6.0"
const PORT = Number(process.env.CHDEVAGENT_PORT || process.env.PORT || 8228);
const HOST = process.env.HOST || "127.0.0.1";
const WORKSPACE = path.resolve(process.env.CHDEVAGENT_WORKSPACE || path.join(process.cwd(), "workspace"));
const DATA_FILE = path.join(WORKSPACE, ".chdevagent-state.json");
let PAIRING_CODE = String(process.env.CHDEVAGENT_PAIRING_CODE || '');
let DEVICE_ID = String(process.env.CHDEVAGENT_DEVICE_ID || '');
const IDENTITY_FILE = path.join(WORKSPACE, '.chdevagent-device.json');
const MAX_BODY = 32 * 1024;

const devices = new Map();
const tasks = new Map();
const skills = new Map();
const audit = [];
const activeControllers = new Map();
const capabilities = [
  { id: "file.list", name: "Liệt kê tệp", group: "Tệp cục bộ", enabled: true, permission: "chỉ đọc", description: "Xem tên tệp trong workspace được cấp phép." },
  { id: "file.read", name: "Đọc tệp", group: "Tệp cục bộ", enabled: true, permission: "chỉ đọc", description: "Đọc tệp văn bản tối đa 1 MB trong workspace." },
  { id: "screenshot", name: "Chụp màn hình PC", group: "Màn hình", enabled: false, permission: "cần quyền Windows", description: "Chưa bật trong bản v2 vì cần adapter Windows và preview riêng." },
  { id: "ocr", name: "Đọc chữ trong ảnh", group: "Màn hình", enabled: false, permission: "chưa cấu hình", description: "Chưa bật trong bản local MVP." },
  { id: "browser.control", name: "Điều khiển trình duyệt", group: "Ứng dụng", enabled: false, permission: "rủi ro cao", description: "Chưa bật; không tự động đăng nhập hoặc gửi biểu mẫu." },
  { id: "system.control", name: "Điều khiển hệ thống", group: "Ứng dụng", enabled: false, permission: "rủi ro cao", description: "Chưa bật; không chạy shell tùy ý." },
];
let activity = { state: "idle", currentStep: "Chờ yêu cầu", progress: 0, summary: "PC Agent sẵn sàng", updatedAt: new Date().toISOString(), log: [] };

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(6).toString("hex")}`; }
function lanAddresses() { return Object.values(os.networkInterfaces()).flatMap(items => (items || []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address)); }
function json(res, status, payload) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET,POST,OPTIONS" }); res.end(JSON.stringify(payload)); }
function tokenHash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function getToken(req) { return String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); }
function isLoopback(req) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress); }
function isLocalUi(req) { return req.headers['x-chdevagent-local-ui'] === '1' && isLoopback(req); }
function getDevice(req) { const token = getToken(req); const device = token ? devices.get(tokenHash(token)) : null; return device && !device.revoked ? device : null; }
function safePath(relative = ".") { const candidate = path.resolve(WORKSPACE, relative); if (candidate !== WORKSPACE && !candidate.startsWith(`${WORKSPACE}${path.sep}`)) throw new Error("Đường dẫn nằm ngoài workspace được cấp phép"); return candidate; }
async function readBody(req) { let body = ""; for await (const chunk of req) { body += chunk; if (body.length > MAX_BODY) throw new Error("Nội dung yêu cầu quá lớn"); } return body ? JSON.parse(body) : {}; }
let persistQueue = Promise.resolve();
function persistState() {
  persistQueue = persistQueue.catch(() => {}).then(async () => {
    const snapshot = { devices: [...devices.values()], tasks: [...tasks.values()], skills: [...skills.values()], audit: audit.slice(0, 300), activity };
    const temp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), "utf8");
    await fs.rename(temp, DATA_FILE);
  });
  return persistQueue;
}
async function loadIdentity() { try { const identity = JSON.parse(await fs.readFile(IDENTITY_FILE, 'utf8')); PAIRING_CODE = String(identity.pairingCode || ''); DEVICE_ID = String(identity.deviceId || ''); } catch {} if (!/^\d{6}$/.test(PAIRING_CODE)) PAIRING_CODE = String(Math.floor(100000 + Math.random() * 900000)); if (!DEVICE_ID) DEVICE_ID = `pc_${crypto.randomBytes(6).toString('hex')}`; await fs.writeFile(IDENTITY_FILE, JSON.stringify({ deviceId: DEVICE_ID, pairingCode: PAIRING_CODE, createdAt: now() }, null, 2), 'utf8'); }
async function restoreState() { try { const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8")); for (const device of saved.devices || []) devices.set(device.tokenHash, device); for (const task of saved.tasks || []) tasks.set(task.id, task); for (const skill of saved.skills || []) skills.set(skill.id, skill); audit.push(...(saved.audit || []).slice(0, 300)); if (saved.activity) activity = saved.activity; } catch { /* first run */ } }
function record(type, data = {}) { const event = { id: id("evt"), at: now(), type, ...data }; audit.unshift(event); if (audit.length > 300) audit.length = 300; void persistState(); return event; }
function setActivity(next, logLine) { activity = { ...activity, ...next, updatedAt: now() }; if (logLine) activity.log = [{ at: now(), text: logLine }, ...(activity.log || [])].slice(0, 30); void persistState(); }
function requireDevice(req, res) { const device = getDevice(req); if (device) { device.lastSeenAt = now(); return device; } if (isLocalUi(req)) return { id: 'desktop-local', name: 'Desktop UI', pcDeviceId: DEVICE_ID, local: true }; json(res, 401, { error: "paired_device_required", message: "Thiết bị chưa được ghép nối" }); return null; }
function taskSummary(task) { return { id: task.id, createdAt: task.createdAt, updatedAt: task.updatedAt, status: task.status, instruction: task.instruction, source: task.source, requestedTools: task.requestedTools, preview: task.preview, result: task.result || null, error: task.error || null }; }
function skillSummary(skill) { return { id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, source: skill.source, requestedCapabilities: skill.requestedCapabilities, status: skill.status, createdAt: skill.createdAt, updatedAt: skill.updatedAt, approvedAt: skill.approvedAt || null, history: skill.history || [] }; }
function createSkill(body, device) { const name = String(body.name || '').trim(); const description = String(body.description || '').trim(); const instructions = String(body.instructions || '').trim(); if (!name || !instructions) throw new Error('Cần nhập tên và hướng dẫn cho skill'); const requestedCapabilities = Array.isArray(body.requestedCapabilities) ? body.requestedCapabilities.map(String).slice(0, 12) : []; const skill = { id: id('skill'), name, description, instructions, source: String(body.source || 'Người dùng tạo'), requestedCapabilities, status: 'draft', createdAt: now(), updatedAt: now(), ownerDeviceId: device.id, history: [{ at: now(), action: 'created', detail: 'Tạo bản nháp; chưa được Agent sử dụng' }] }; skills.set(skill.id, skill); record('skill.created', { skillId: skill.id, deviceId: device.id, requestedCapabilities }); void persistState(); return skill; }
function activitySummary() { return { ...activity, activeTaskIds: [...activeControllers.keys()] }; }
async function listWorkspace(relative = ".") { const target = safePath(relative); const entries = await fs.readdir(target, { withFileTypes: true }); return entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" })); }
async function readWorkspaceFile(relative) { const target = safePath(relative); const stat = await fs.stat(target); if (!stat.isFile()) throw new Error("Chỉ đọc được tệp, không đọc thư mục"); if (stat.size > 1024 * 1024) throw new Error("Tệp lớn hơn giới hạn 1 MB"); return fs.readFile(target, "utf8"); }
async function recentFiles() { const entries = await fs.readdir(WORKSPACE, { withFileTypes: true }); const files = []; for (const entry of entries) { if (!entry.isFile() || entry.name.startsWith(".chdevagent")) continue; const stat = await fs.stat(path.join(WORKSPACE, entry.name)); files.push({ name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() }); } return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 20); }
function planFor(task) { return [{ step: 1, title: "Kiểm tra quyền", status: "done" }, { step: 2, title: task.requestedTools.includes("file.read") ? "Đọc tệp trong workspace" : "Liệt kê workspace", status: "pending" }, { step: 3, title: "Trả kết quả và ghi audit log", status: "pending" }]; }

async function executeTask(task) {
  if (task.cancelled) return;
  task.status = "executing"; task.updatedAt = now(); activeControllers.set(task.id, new AbortController());
  setActivity({ state: "running", currentStep: "Đang kiểm tra quyền", progress: 15, summary: `Đang xử lý: ${task.instruction}`, activeTaskId: task.id, log: [] }, "Đã nhận quyền từ thiết bị đã ghép nối");
  record("task.executing", { taskId: task.id, deviceId: task.deviceId });
  try {
    await new Promise(resolve => setTimeout(resolve, 120));
    if (task.cancelled) return;
    setActivity({ currentStep: task.requestedTools.includes("file.read") ? "Đang đọc tệp" : "Đang liệt kê workspace", progress: 55 }, task.requestedTools.includes("file.read") ? "Đọc tệp trong vùng được cấp phép" : "Quét tên tệp, không thay đổi dữ liệu");
    if (task.requestedTools.includes("file.list")) task.result = { workspace: WORKSPACE, entries: await listWorkspace(task.relativePath || ".") };
    else if (task.requestedTools.includes("file.read")) task.result = { path: task.relativePath, content: await readWorkspaceFile(task.relativePath) };
    else throw new Error("Công cụ chưa được bật trong registry");
    if (task.cancelled) return;
    task.status = "succeeded"; task.updatedAt = now(); setActivity({ state: "idle", currentStep: "Hoàn tất", progress: 100, summary: "Tác vụ đã hoàn tất", activeTaskId: null }, "Đã trả kết quả và ghi audit log"); record("task.succeeded", { taskId: task.id });
  } catch (error) {
    if (task.cancelled) return;
    task.status = "failed"; task.error = error instanceof Error ? error.message : "Tác vụ thất bại"; task.updatedAt = now(); setActivity({ state: "error", currentStep: "Có lỗi", progress: 100, summary: task.error, activeTaskId: null }, task.error); record("task.failed", { taskId: task.id, error: task.error });
  } finally { activeControllers.delete(task.id); void persistState(); }
}
function createTask(body, device) {
  const instruction = String(body.instruction || "").trim(); const requested = Array.isArray(body.requestedTools) ? body.requestedTools.map(String) : ["file.list"]; const enabled = new Set(capabilities.filter(item => item.enabled).map(item => item.id)); const allowedTools = requested.filter(tool => enabled.has(tool));
  if (!instruction) throw new Error("Cần nhập yêu cầu tác vụ"); if (!allowedTools.length) throw new Error("Tác vụ yêu cầu quyền chưa được bật");
  const relativePath = String(body.relativePath || "."); safePath(relativePath);
  const task = { id: id("task"), createdAt: now(), updatedAt: now(), status: "awaiting_approval", instruction, source: "paired_device", deviceId: device.id, requestedTools: allowedTools, relativePath, preview: { action: allowedTools.includes("file.read") ? "Đọc một tệp trong workspace" : "Liệt kê tệp trong workspace", scope: path.posix.join("/workspace", relativePath), permission: "chỉ đọc", impact: "Không tạo, sửa hoặc xóa tệp" }, plan: [] };
  task.plan = planFor(task); tasks.set(task.id, task); setActivity({ state: "awaiting_approval", currentStep: "Chờ phê duyệt", progress: 0, summary: "Có tác vụ cần bạn xem trước", activeTaskId: task.id }, "Đã tạo preview, chưa thực thi"); record("task.created", { taskId: task.id, deviceId: device.id, tools: allowedTools }); return task;
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`); const method = req.method || "GET";
  if (method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET,POST,OPTIONS" }); return res.end(); }
  if (method === "GET" && url.pathname === "/") { const html = await fs.readFile(path.join(process.cwd(), "public", "index.html"), "utf8"); res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(html); }
  if (method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, service: "chdevagent-agent", version: VERSION, host: os.hostname(), lanAddresses: lanAddresses(), workspace: WORKSPACE, deviceId: DEVICE_ID, codeHint: `${PAIRING_CODE.slice(0, 2)}••••`, pairedDevices: [...devices.values()].filter(d => !d.revoked).length, activity: activitySummary() });
  if (method === "GET" && url.pathname === "/api/pairing/status") { const localUi = isLocalUi(req); return json(res, 200, { pairingRequired: true, deviceId: DEVICE_ID, codeHint: `${PAIRING_CODE.slice(0, 2)}••••`, ...(localUi ? { pairingCode: PAIRING_CODE } : {}), workspace: WORKSPACE }); }
  if (method === "POST" && url.pathname === "/api/pairing/confirm") { const body = await readBody(req); if (String(body.code || "") !== PAIRING_CODE) return json(res, 403, { error: "invalid_pairing_code", message: "Mã ghép nối không đúng" }); const rawToken = crypto.randomBytes(24).toString("base64url"); const device = { id: id("device"), name: String(body.deviceName || "Điện thoại đã ghép nối"), tokenHash: tokenHash(rawToken), pairedAt: now(), lastSeenAt: now(), revoked: false, pcDeviceId: DEVICE_ID }; devices.set(device.tokenHash, device); record("device.paired", { deviceId: device.id, name: device.name }); return json(res, 201, { device: { id: device.id, name: device.name, pairedAt: device.pairedAt }, token: rawToken }); }
  const requiresDevice = ["/api/status", "/api/capabilities", "/api/tools", "/api/plan", "/api/recent-files", "/api/devices", "/api/audit", "/api/history", "/api/tasks", "/api/stop", "/api/skills"].some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
  const device = requiresDevice ? requireDevice(req, res) : null;
  if (requiresDevice && !device) return;
  if (["/api/status", "/api/capabilities", "/api/tools"].includes(url.pathname)) return json(res, 200, url.pathname === "/api/status" ? { activity: activitySummary() } : { capabilities });
  if (method === "GET" && url.pathname === "/api/plan") { const current = activity.activeTaskId ? tasks.get(activity.activeTaskId) : null; return json(res, 200, { plan: current?.plan || [], taskId: current?.id || null }); }
  if (method === "GET" && url.pathname === "/api/skills") return json(res, 200, { skills: [...skills.values()].filter(skill => skill.ownerDeviceId === device.id || device.local).map(skillSummary) });
  if (method === "POST" && url.pathname === "/api/skills") { try { const skill = createSkill(await readBody(req), device); return json(res, 201, skillSummary(skill)); } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : 'invalid_skill' }); } }
  const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/(submit|approve|disable)$/); if (skillMatch && method === 'POST') { const skill = skills.get(skillMatch[1]); if (!skill || (skill.ownerDeviceId !== device.id && !device.local)) return json(res, 404, { error: 'skill_not_found' }); const action = skillMatch[2]; if (action === 'submit') skill.status = 'pending_review'; if (action === 'approve') { skill.status = 'enabled'; skill.approvedAt = now(); } if (action === 'disable') skill.status = 'disabled'; skill.updatedAt = now(); skill.history = [{ at: now(), action, detail: action === 'approve' ? 'Đã duyệt; chỉ có thể dùng trong capability đã cấp' : `Skill chuyển sang ${skill.status}` }, ...(skill.history || [])].slice(0, 30); record(`skill.${action}`, { skillId: skill.id, deviceId: device.id }); void persistState(); return json(res, 200, skillSummary(skill)); }
  if (method === "GET" && url.pathname === "/api/recent-files") return json(res, 200, { files: await recentFiles() });
  if (method === "GET" && url.pathname === "/api/devices") return json(res, 200, { devices: [...devices.values()].filter(d => !d.revoked).map(({ tokenHash: _, ...safe }) => safe) });
  if (method === "GET" && url.pathname === "/api/history") return json(res, 200, { tasks: [...tasks.values()].filter(t => t.deviceId === device.id).map(taskSummary), events: audit.filter(event => !event.deviceId || event.deviceId === device.id).slice(0, 100) });
  if (method === "GET" && url.pathname === "/api/audit") return json(res, 200, { events: audit.filter(event => !event.deviceId || event.deviceId === device.id) });
  if (method === "POST" && url.pathname === "/api/stop") { for (const task of tasks.values()) if (task.deviceId === device.id && ["awaiting_approval", "approved", "executing"].includes(task.status)) { task.cancelled = true; task.status = "cancelled"; task.updatedAt = now(); activeControllers.get(task.id)?.abort(); record("task.cancelled", { taskId: task.id, deviceId: device.id }); } setActivity({ state: "stopped", currentStep: "Đã dừng", progress: 0, summary: "Đã dừng theo yêu cầu người dùng", activeTaskId: null }, "Nút dừng khẩn cấp đã được kích hoạt"); return json(res, 200, { ok: true, activity: activitySummary() }); }
  if (method === "POST" && url.pathname === "/api/tasks") { try { const task = createTask(await readBody(req), device); return json(res, 201, { ...taskSummary(task), plan: task.plan }); } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : "invalid_task" }); } }
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(approve|reject|cancel))?$/);
  if (taskMatch) { const task = tasks.get(taskMatch[1]); if (!task || task.deviceId !== device.id) return json(res, 404, { error: "task_not_found" }); const action = taskMatch[2]; if (method === "GET" && !action) return json(res, 200, { ...taskSummary(task), plan: task.plan }); if (method === "POST" && action === "approve") { if (task.status !== "awaiting_approval") return json(res, 409, { error: "task_not_awaiting_approval" }); task.status = "approved"; task.updatedAt = now(); record("task.approved", { taskId: task.id, deviceId: device.id }); setTimeout(() => executeTask(task), 50); return json(res, 200, taskSummary(task)); } if (method === "POST" && action === "reject") { if (task.status !== "awaiting_approval") return json(res, 409, { error: "task_not_awaiting_approval" }); task.status = "rejected"; task.updatedAt = now(); setActivity({ state: "idle", currentStep: "Đã từ chối", progress: 0, summary: "Tác vụ không được thực thi", activeTaskId: null }, "Người dùng đã từ chối preview"); record("task.rejected", { taskId: task.id, deviceId: device.id }); return json(res, 200, taskSummary(task)); } if (method === "POST" && action === "cancel") { if (["succeeded", "failed", "rejected", "cancelled"].includes(task.status)) return json(res, 409, { error: "task_already_finished" }); task.cancelled = true; task.status = "cancelled"; task.updatedAt = now(); activeControllers.get(task.id)?.abort(); setActivity({ state: "stopped", currentStep: "Đã dừng", progress: 0, summary: "Tác vụ đã được dừng", activeTaskId: null }, "Người dùng đã dừng tác vụ"); record("task.cancelled", { taskId: task.id, deviceId: device.id }); return json(res, 200, taskSummary(task)); } }
  if (method === "GET" && url.pathname === "/api/tasks") return json(res, 200, { tasks: [...tasks.values()].filter(task => task.deviceId === device.id).map(taskSummary) });
  return json(res, 404, { error: "not_found" });
}

const RELAY_URL = String(process.env.CHDEVAGENT_RELAY_URL || '').replace(/\/$/, '');
const RELAY_TOKEN = String(process.env.CHDEVAGENT_AGENT_TOKEN || '');
let relayTimer = null;
let relayBusy = false;

async function relayCall(procedure, input, mutation = false) {
  if (!RELAY_URL || !RELAY_TOKEN) return null;
  const payload = JSON.stringify({ json: input });
  const url = `${RELAY_URL}/api/trpc/relay.${procedure}`;
  const response = mutation
    ? await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
    : await fetch(`${url}?input=${encodeURIComponent(payload)}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Relay HTTP ${response.status}`);
  const body = await response.json();
  return body?.result?.data?.json ?? body?.result?.data ?? null;
}

async function pollRelay() {
  if (relayBusy || !RELAY_URL || !RELAY_TOKEN) return;
  relayBusy = true;
  try {
    const result = await relayCall('agentPoll', { deviceId: DEVICE_ID, agentToken: RELAY_TOKEN });
    for (const remote of result?.tasks || []) {
      if ([...tasks.values()].some(task => task.relayTaskId === remote.id)) continue;
      const task = {
        id: id('relay_task'), relayTaskId: remote.id, createdAt: now(), updatedAt: now(), status: 'awaiting_approval',
        instruction: String(remote.instruction || 'Yêu cầu từ relay'), source: 'https_relay', deviceId: 'relay',
        requestedTools: ['file.list'], relativePath: '.', preview: {
          action: 'Liệt kê tệp trong workspace cục bộ', scope: '/workspace', permission: 'chỉ đọc',
          impact: 'Task relay đã được duyệt ở web nhưng vẫn yêu cầu xác nhận local; bản này chỉ cho phép đọc danh sách tệp.'
        }, plan: []
      };
      task.plan = planFor(task); tasks.set(task.id, task);
      record('relay.task.received', { taskId: task.id, relayTaskId: remote.id });
    }
    if ((result?.tasks || []).length) await persistState();
  } catch (error) {
    record('relay.poll_failed', { error: error instanceof Error ? error.message : 'unknown' });
  } finally { relayBusy = false; }
}

function startRelayLoop() {
  if (!RELAY_URL || !RELAY_TOKEN) { console.log('HTTPS relay: chưa cấu hình CHDEVAGENT_RELAY_URL/CHDEVAGENT_AGENT_TOKEN; chỉ chạy local.'); return; }
  console.log(`HTTPS relay outbound: ${RELAY_URL}`);
  void pollRelay();
  relayTimer = setInterval(() => void pollRelay(), 5000);
  relayTimer.unref?.();
}

async function start() { await fs.mkdir(WORKSPACE, { recursive: true }); await loadIdentity(); await restoreState(); const server = http.createServer((req, res) => route(req, res).catch(error => { record("gateway.error", { error: error instanceof Error ? error.message : "unknown" }); json(res, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown" }); })); server.listen(PORT, HOST, () => { console.log(`ChDevAgent local gateway v${VERSION} listening at http://${HOST}:${PORT}`); console.log(`Workspace: ${WORKSPACE}`); console.log(`Pairing code: ${PAIRING_CODE}`); console.log(`LAN addresses: ${lanAddresses().join(', ') || 'Không phát hiện IPv4 LAN'}`); console.log("Vietnamese UI + safe local capabilities enabled."); startRelayLoop(); }); }
start().catch(error => { console.error(error); process.exitCode = 1; });
