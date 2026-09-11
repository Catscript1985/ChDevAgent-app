import fs from 'node:fs/promises';

const LLM_URL = String(process.env.CHDEVAGENT_LLM_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const LLM_MODEL = String(process.env.CHDEVAGENT_LLM_MODEL || 'qwen2.5-coder:7b');
const MAX_FILES = 12;

function allowedPath(value) {
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value) && !value.includes('..');
}

export function validatePlan(plan) {
  if (!plan || plan.requiresApproval !== true) throw new Error('Kế hoạch phải yêu cầu phê duyệt');
  if (!Array.isArray(plan.files) || plan.files.length > MAX_FILES) throw new Error('Kế hoạch vượt giới hạn số tệp');
  for (const file of plan.files) {
    if (!allowedPath(file.path)) throw new Error('Đường dẫn nằm ngoài workspace');
    if (!['read', 'create', 'modify'].includes(file.operation)) throw new Error('Thao tác chưa được allowlist');
    if (typeof file.preview !== 'string' || file.preview.length > 12000) throw new Error('Preview không hợp lệ');
  }
  return plan;
}

export async function createLocalCodingPlan({ instruction, workspaceFiles = [] }) {
  const prompt = [
    'Bạn là trợ lý lập trình local-first an toàn.',
    'Chỉ trả JSON kế hoạch và diff preview; tuyệt đối không chạy lệnh, không tự ghi file.',
    'Không đề xuất shell tùy ý, secrets, quyền admin, xóa dữ liệu hoặc đường dẫn ngoài workspace.',
    'Schema: {summary:string,risk:"low"|"medium"|"high",files:[{path,operation:"read"|"create"|"modify",reason,preview}],checks:string[],requiresApproval:true}.',
    `Yêu cầu: ${instruction}`,
    `Tệp hiện có:\n${workspaceFiles.filter(allowedPath).slice(0, 100).join('\n')}`,
  ].join('\n\n');
  const response = await fetch(`${LLM_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!response.ok) throw new Error(`Local LLM HTTP ${response.status}`);
  const body = await response.json();
  const content = body?.message?.content || body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Local LLM không trả về JSON');
  const plan = validatePlan(JSON.parse(content));
  return { ...plan, model: LLM_MODEL, providerUrl: LLM_URL };
}

export async function canReachLocalLlm() {
  try {
    const response = await fetch(`${LLM_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}
