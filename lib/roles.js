import { createHash } from 'node:crypto';
import { workspacePath, sessionKey } from './paths.js';
import { cleanPrivateProfile, defaultPrivateProfile, validatePrivateUniqueness } from './private-profile.js';

export const CONFIG_VERSION = 7;
export const DEFAULT_PERSONA = `# {{selfName}}

- 性格：有礼貌、冒失、自信、活泼、乖巧可爱、热心帮忙，偶尔会因为太着急而犯点小迷糊。
- 说话风格：温柔、得体、有礼貌，语气自然亲切，表达简洁清晰。常说“好的，我明白了”“请稍等，我来帮你看看”“抱歉，刚才是我弄错了”，偶尔使用 emoji。
- 背景设定：你是群里常驻的“{{selfName}}”，大家已经习惯你热情又有点冒失的说话方式。
- 互动规则：别人 @ 你或直接提问时才回复；被感谢时礼貌回应。发现自己弄错了，要及时道歉并更正。
- 能力边界：不确定的事情要说明，不要因为自信而编造答案。`;

export function defaultRole(id = 'role-default') {
  return { id, label: '大肥鱼', selfName: '大肥鱼', ownerName: '用户', persona: DEFAULT_PERSONA, privateChat: defaultPrivateProfile() };
}
export function defaultConfig() {
  return { version: CONFIG_VERSION, roles: [defaultRole()], bindings: { workspaces: [] } };
}

function name(value, field, max = 16) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field}应为 1～${max} 个字符，不能含换行或控制字符`);
  return value.trim();
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) throw new Error('角色标识无效');
  return value;
}
function array(value, max, field) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field}数量或格式无效`);
  return value;
}
function unique(values, key, field) {
  if (new Set(values.map(key)).size !== values.length) throw new Error(`${field}不能重复`);
}
function directory(value) {
  const normalized = workspacePath(value);
  if (!normalized) throw new Error('工作区必须是绝对文件夹路径');
  return normalized;
}

export function cleanConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('控制台配置格式无效');
  const version = raw.version ?? 1;
  if (!Number.isInteger(version) || version < 1 || version > CONFIG_VERSION) throw new Error('配置版本不兼容');
  let input = raw;
  if (version < 4) {
    const title = raw.persona?.match(/^#\s+(?:角色卡[：:]\s*)?([^\n]{1,16})\s*$/m)?.[1]?.trim();
    const selfName = raw.selfName ?? title ?? '大肥鱼';
    const workspaces = raw.workspace ? [{ workspace: raw.workspace, roleId: 'role-default' }] : [];
    input = {
      version: CONFIG_VERSION,
      roles: [{ id: 'role-default', label: selfName, selfName, ownerName: raw.ownerName ?? '用户', persona: raw.persona ?? DEFAULT_PERSONA }],
      bindings: { workspaces },
    };
  }
  const roles = array(input.roles, 32, '角色').map(role => {
    const persona = String(role.persona ?? '').trim();
    if (!persona || persona.length > 12000) throw new Error('人设应为 1～12000 个字符');
    return { id: identifier(role.id), label: name(role.label ?? role.selfName, '角色名称', 40), selfName: name(role.selfName, '它的名字'), ownerName: name(role.ownerName, '对我的称呼'), persona, privateChat: cleanPrivateProfile(role.privateChat) };
  });
  if (!roles.length) throw new Error('至少需要保留一个角色');
  unique(roles, r => r.id, '角色标识');
  validatePrivateUniqueness(roles);
  const roleIds = new Set(roles.map(r => r.id));
  const reference = value => { const id = identifier(value); if (!roleIds.has(id)) throw new Error('绑定引用了不存在的角色'); return id; };
  const workspaces = array(input.bindings?.workspaces, 128, '工作区绑定').map(b => ({ workspace: directory(b.workspace), roleId: reference(b.roleId) }));
  // Older settings may contain per-session overrides. Validate them before
  // retiring them; saved workspace bindings remain the source of identity.
  const sessions = array(input.bindings?.sessions ?? [], 1000, '旧版会话绑定').map(b => ({ sessionId: sessionKey(name(b.sessionId, '会话标识', 200)), roleId: reference(b.roleId) }));
  if (version >= 6 && sessions.length) throw new Error('角色只支持工作区绑定，请刷新控制台后保存');
  unique(workspaces, b => b.workspace, '工作区绑定'); unique(sessions, b => b.sessionId, '会话绑定');
  // Tool availability belongs to DSH and each provider. Retire old workspace
  // deny lists, including legacy flags, without carrying them into new saves.
  return { version: CONFIG_VERSION, roles, bindings: { workspaces } };
}

export function roleRevision(role) {
  return createHash('sha256').update(JSON.stringify([role.id, role.selfName, role.ownerName, role.persona])).digest('hex').slice(0, 16);
}
export function roleSections(role) {
  const revision = roleRevision(role);
  const marker = `<fish-console-role id="${role.id}" revision="${revision}">`;
  const persona = role.persona.replace(/\{\{(selfName|ownerName)\}\}/g, (_, key) => role[key]);
  return [
    { name: 'fish-console.persona', text: `${marker}\n${persona}\n</fish-console-role>`, interpolate: false },
    { name: 'fish-console.identity', text: `【统一角色身份】\n你的名字是 ${JSON.stringify(role.selfName)}；与使用者直接交流时，称呼对方为 ${JSON.stringify(role.ownerName)}。\n名字和称呼以本节为准；群聊其他人仍按各自真实身份称呼。`, interpolate: false },
  ];
}

// Every conversation, including subagents, uses its own workspace's role.
export function resolveRole(config, session) {
  if (session?.ambiguous) return { status: 'unresolved', reason: '会话归属存在冲突' };
  const workspace = session?.workspace && config.bindings.workspaces.find(b => b.workspace === session.workspace);
  if (workspace) {
    const role = config.roles.find(r => r.id === workspace.roleId);
    return role ? { status: 'bound', role, source: 'workspace' } : { status: 'unresolved', reason: '绑定的角色不存在' };
  }
  return { status: 'unbound', reason: '工作区尚未绑定角色' };
}
