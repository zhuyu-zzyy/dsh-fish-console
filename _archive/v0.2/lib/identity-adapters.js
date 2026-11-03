import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readJson, updateJson } from './json-store.js';
import { moodWorkspaceKey, sessionKey } from './identity.js';

const result = (state, message) => ({ state, message });
function backupValue(directory, label, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 24);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(path.join(directory, `${label}-${hash}.json`), text, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export async function syncMemory({ home, backupDir, config, sessions }) {
  if (!sessions.ids.length) return result('pending', '工作区还没有会话；创建会话后会自动同步');
  updateJson(path.join(home, 'fish-memory-config.json'), current => {
    for (const field of ['selfNames', 'ownerNames']) {
      if (current[field] !== undefined && (!current[field] || typeof current[field] !== 'object' || Array.isArray(current[field]))) {
        throw new Error('记忆名称配置格式不兼容');
      }
    }
    const selfNames = { ...current.selfNames }, ownerNames = { ...current.ownerNames };
    const keys = new Set([...sessions.ids, ...Object.keys(selfNames), ...Object.keys(ownerNames)].filter(id => sessions.keys.has(sessionKey(id))));
    for (const id of keys) { selfNames[id] = config.selfName; ownerNames[id] = config.ownerName; }
    return { ...current, selfNames, ownerNames };
  }, backupDir, 'memory-config');
  return result('synced', `已同步 ${sessions.keys.size} 个会话的名字和称呼；历史记忆正文保持原样`);
}

export function planMood(current, config, sessions) {
  if (!Array.isArray(current.slots)) throw new Error('心情插件的配置格式不兼容');
  const slots = structuredClone(current.slots);
  const mode = current['模式'] || current.mode || 'session';
  let selected;
  if (mode === 'workspace') {
    const workspace = moodWorkspaceKey(config.workspace);
    selected = slots.filter(s => {
      const key = String(s['工作区'] || s.workspace || '');
      return (key.startsWith('--') ? key : moodWorkspaceKey(key)) === workspace;
    });
    if (selected.length > 1) return { blocked: '同一工作区绑定了多份心情，请先在心情插件中确认归属' };
    if (!selected.length) {
      if (slots.length >= 6) return { blocked: '心情插件的六份绑定已用完，无法新增工作区绑定' };
      const slot = { id: 'fish-console-' + randomUUID(), label: '', selfName: '', ownerName: '', 工作区: workspace, sessions: [] };
      slots.push(slot); selected = [slot];
    }
  } else if (mode === 'session') {
    if (!sessions.ids.length) return { pending: true };
    selected = slots.filter(s => (s.sessions || []).some(id => sessions.keys.has(sessionKey(id))));
    if (selected.some(s => s.sessions.some(id => !sessions.keys.has(sessionKey(id))))) {
      return { blocked: '这份心情还被其他工作区的会话共用，暂未修改；请先拆分绑定' };
    }
    if (!selected.length) {
      if (slots.length >= 6) return { blocked: '心情插件的六份绑定已用完，无法新增会话绑定' };
      const slot = { id: 'fish-console-' + randomUUID(), label: '', selfName: '', ownerName: '', 工作区: '', sessions: [] };
      slots.push(slot); selected = [slot];
    }
    const assigned = new Set(selected.flatMap(s => s.sessions || []).map(sessionKey));
    selected[0].sessions = [...(selected[0].sessions || []), ...sessions.ids.filter(id => !assigned.has(sessionKey(id)))];
  } else throw new Error('无法识别心情插件的绑定模式');
  for (const slot of selected) {
    if (!slot.id) throw new Error('心情绑定缺少稳定标识，未修改');
    slot.selfName = config.selfName; slot.ownerName = config.ownerName;
  }
  return { slots, selected: selected.map(s => s.id), changed: JSON.stringify(slots) !== JSON.stringify(current.slots) };
}

export async function syncMood({ backupDir, config, sessions, request }) {
  const response = await request('/dsh-feiyu-mood/config');
  const current = response.config;
  if (!current) throw new Error('心情插件没有返回配置');
  const plan = planMood(current, config, sessions);
  if (plan.blocked) return result('conflict', plan.blocked);
  if (plan.pending) return result('pending', '工作区还没有会话；创建会话后会自动同步');
  if (plan.changed) {
    const fresh = (await request('/dsh-feiyu-mood/config')).config;
    if (!fresh || JSON.stringify([fresh.slots, fresh['模式'] || fresh.mode]) !== JSON.stringify([current.slots, current['模式'] || current.mode])) {
      throw new Error('心情绑定刚被其他页面修改，将在下一轮重试');
    }
    backupValue(backupDir, 'mood-config', current);
    const saved = await request('/dsh-feiyu-mood/config', { slots: plan.slots });
    if (!plan.selected.every(id => saved.config?.slots?.some(s => s.id === id && s.selfName === config.selfName && s.ownerName === config.ownerName))) {
      throw new Error('心情插件未确认名称更新');
    }
  }
  return result('synced', '已同步对应心情绑定，原心情记录和其他工作区绑定保留');
}

export function planQq(current, config, sessions) {
  if (!Array.isArray(current['绑定'])) {
    const target = current['私聊会话'] || current['目标会话'];
    if (!current['私聊QQ'] || !sessions.keys.has(sessionKey(target))) return { skipped: '没有属于此工作区的私聊绑定；名字由工作区人设提供' };
    return { next: { ...current, 称呼: config.ownerName } };
  }
  const privateRows = current['绑定'].filter(row => row['类型'] === '私聊' && sessions.keys.has(sessionKey(row['会话'])));
  if (!privateRows.length) return { skipped: '没有属于此工作区的私聊绑定；群聊称呼保持原样' };
  if (privateRows.some(row => !row['号码']) || new Set(privateRows.map(row => String(row['号码']))).size > 1) {
    return { blocked: '此工作区绑定了多个私聊对象，无法判断哪一个是你，暂未修改称呼' };
  }
  return { next: { ...current, 绑定: current['绑定'].map(row => privateRows.includes(row) ? { ...row, 称呼: config.ownerName } : row) } };
}

export async function syncQq({ home, backupDir, config, sessions }) {
  const file = path.join(home, 'qq-bridge-config.json');
  const current = readJson(file, undefined);
  if (!current) return result('not_configured', 'QQ 桥尚无保存的绑定配置；名字由工作区人设提供');
  const plan = planQq(current, config, sessions);
  if (plan.blocked) return result('conflict', plan.blocked);
  if (plan.skipped) return result('not_bound', plan.skipped);
  updateJson(file, fresh => {
    const next = planQq(fresh, config, sessions);
    if (!next.next) throw new Error('QQ 绑定刚发生变化，将在下一轮重试');
    return next.next;
  }, backupDir, 'qq-config');
  return result('synced', '已同步此工作区私聊绑定的称呼；名字由工作区人设提供');
}

export async function syncBili({ config, request }) {
  const response = await request('/api/bili-duty/config');
  if (!response.config || typeof response.config.ownerName !== 'string') throw new Error('B 站插件未返回可识别的称呼配置');
  return response.config.ownerName === config.ownerName
    ? result('aligned', '插件现有全局称呼已一致；名字由工作区人设提供')
    : result('scope_limited', '插件称呼是全局配置，当前版本不能按工作区同步；工作区身份已统一，未覆盖其全局称呼');
}

export const identityAdapters = { memory: syncMemory, mood: syncMood, qq: syncQq, bili: syncBili };
