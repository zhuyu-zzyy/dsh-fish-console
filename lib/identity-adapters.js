import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, updateJson } from './json-store.js';
import { sessionKey } from './paths.js';
import { uniqueIdentity, moodWorkspaceMatches } from './identity-targets.js';
import { resolveRole } from './roles.js';
import { biliConfigDiverged } from './private-routing.js';

const result = (state, message) => ({ state, message });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function backupValue(directory, label, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(path.join(directory, `names-${label}-${hash}.json`), bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

export function planMemory(current, targets) {
  for (const field of ['selfNames', 'ownerNames']) if (current[field] !== undefined && (!current[field] || typeof current[field] !== 'object' || Array.isArray(current[field]))) throw new Error('记忆名称配置不兼容');
  const next = { ...current, selfNames: { ...current.selfNames }, ownerNames: { ...current.ownerNames } };
  for (const session of targets.sessions) {
    const keys = new Set([session.nativeId, ...Object.keys(next.selfNames), ...Object.keys(next.ownerNames)].filter(id => sessionKey(id) === session.id));
    for (const id of keys) { next.selfNames[id] = session.selfName; next.ownerNames[id] = session.ownerName; }
  }
  if (targets.globalOwner) next.userPronoun = targets.globalOwner;
  return next;
}
export async function syncMemory({ home, backupDir, targets }) {
  const file = path.join(home, 'fish-memory-config.json');
  // The upstream /names route rewrites historical memories when selfName is
  // supplied. Its config is read on every use, so update only that config here.
  updateJson(file, current => planMemory(current, targets), backupDir, 'names-memory-config');
  const saved = readJson(file, {}), expected = planMemory(saved, targets);
  if (!same(saved, expected)) throw new Error('记忆配置没有确认保存');
  return result(targets.globalOwner ? 'synced' : 'partial', `已同步 ${targets.sessions.length} 个会话的名字和称呼；` + (targets.globalOwner ? '全局用户称呼已一致，历史记忆不改写' : '多个角色的全局用户称呼冲突，已保留原值'));
}

export function planMood(current, targets) {
  if (!Array.isArray(current.slots)) throw new Error('心情配置不兼容');
  const mode = current.模式 || current.mode || 'session';
  if (!['workspace', 'session'].includes(mode)) throw new Error('心情归属模式不兼容');
  const slots = structuredClone(current.slots), conflicts = [];
  let owned = 0;
  for (const slot of slots) {
    if (!slot.id || !Array.isArray(slot.sessions)) throw new Error('心情绑定格式不兼容');
    let identities = [];
    if (mode === 'workspace') {
      const binding = targets.config.bindings.workspaces.find(b => moodWorkspaceMatches(slot.工作区 || slot.workspace, b.workspace));
      if (!binding) continue;
      owned++;
      const base = targets.config.roles.find(role => role.id === binding.roleId);
      if (base) identities.push(base);
      for (const session of targets.catalog.sessions.filter(s => s.workspace === binding.workspace && s.origin !== 'subagent')) {
        const resolved = resolveRole(targets.config, session, targets.catalog.lookup);
        if (!resolved.role) { identities = []; break; }
        identities.push(targets.lookup(session.id) || resolved.role);
      }
    } else {
      const members = slot.sessions.map(id => targets.lookup(id));
      if (!members.some(Boolean)) continue;
      owned++;
      if (members.every(Boolean)) identities = members;
    }
    const identity = uniqueIdentity(identities);
    if (!identity) { conflicts.push(slot.id); continue; }
    slot.selfName = identity.selfName; slot.ownerName = identity.ownerName;
  }
  const patch = {};
  if (!same(slots, current.slots)) patch.slots = slots;
  const globalSafe = targets.globalIdentity && owned === slots.length && !conflicts.length;
  if (globalSafe) for (const key of ['selfName', 'ownerName']) if (current[key] !== targets.globalIdentity[key]) patch[key] = targets.globalIdentity[key];
  const attention = conflicts.length || (!globalSafe && owned > 0);
  return { patch, state: attention ? 'partial' : owned || globalSafe ? 'synced' : 'not_bound', message: conflicts.length
    ? `${conflicts.length} 份心情被不同角色或未管理会话共用，未覆盖冲突项`
    : !owned && !globalSafe ? '没有可明确归属的心情绑定，未新增或修改绑定'
      : globalSafe ? '对应心情绑定及默认名字、称呼已一致；昵称和心情记录保留'
        : '已同步对应心情绑定；全局默认值被多角色或其他绑定共用，已保留原值' };
}
export async function syncMood({ backupDir, targets, request }) {
  const route = '/dsh-feiyu-mood/config';
  const current = (await request(route)).config;
  if (!current) throw new Error('未返回心情配置');
  const plan = planMood(current, targets);
  if (Object.keys(plan.patch).length) {
    const fresh = (await request(route)).config;
    if (!same([fresh?.slots, fresh?.模式 || fresh?.mode, fresh?.selfName, fresh?.ownerName], [current.slots, current.模式 || current.mode, current.selfName, current.ownerName])) throw new Error('心情配置并发修改');
    backupValue(backupDir, 'mood', current);
    await request(route, plan.patch);
    const saved = (await request(route)).config;
    if (!saved || Object.keys(planMood(saved, targets).patch).length) throw new Error('心情配置没有确认保存');
  }
  return result(plan.state, plan.message);
}

export async function syncBili({ home, backupDir, targets, request, previous }) {
  if (!targets.globalOwner) return result('conflict', 'B站称呼是全局字段；多个角色的称呼不同，未覆盖原值');
  const route = '/api/bili-duty/config';
  const current = (await request(route)).config;
  if (!current || typeof current.ownerName !== 'string') throw new Error('B站配置不兼容');
  const savedFile = home ? readJson(path.join(home, 'bili-duty/config.json'), undefined) : undefined;
  if (savedFile && biliConfigDiverged(savedFile, current, ['ownerName'])) return result('partial', 'B站生效设置与保存设置不一致，已暂停名称写入以保留原任务；请检查刷B站配置');
  if (current.ownerName !== targets.globalOwner || previous?.needsHostRetry) {
    const fresh = (await request(route)).config;
    const latestFile = home ? readJson(path.join(home, 'bili-duty/config.json'), undefined) : undefined;
    if (!same(current, fresh) || !same(savedFile, latestFile)) return result('partial', 'B站设置正在变化，未写入名称，请刷新后重试');
    if (current.ownerName !== targets.globalOwner) backupValue(backupDir, 'bili', current);
    const response = await request(route, { ownerName: targets.globalOwner });
    const saved = (await request(route)).config;
    if (saved?.ownerName !== targets.globalOwner) throw new Error('B站配置没有确认保存');
    if (response.host?.ok === false) return { ...result('partial', 'B站本地称呼已更新，DSH 原生设置未确认同步，请重试'), needsHostRetry: true };
  }
  return result('synced', 'B站全局称呼已一致；任务目标、提示正文和开关保留');
}

export function planQq(current, targets) {
  if (current.绑定 !== undefined && !Array.isArray(current.绑定)) throw new Error('QQ 绑定格式不兼容');
  if (Array.isArray(current.绑定)) {
    const duplicates = new Map();
    for (const row of current.绑定.filter(row => row.类型 === '私聊')) {
      const id = sessionKey(row.会话);
      if (!duplicates.has(id)) duplicates.set(id, new Set());
      duplicates.get(id).add(String(row.号码 || ''));
    }
    let count = 0, conflicts = 0;
    const rows = current.绑定.map(row => {
      const identity = row.类型 === '私聊' && targets.lookup(row.会话);
      if (!identity) return row;
      if (!row.号码 || duplicates.get(sessionKey(row.会话)).size > 1) { conflicts++; return row; }
      count++; return { ...row, 称呼: identity.ownerName };
    });
    const next = { ...current, 绑定: rows };
    const first = rows.find(row => row.类型 === '私聊');
    if (first && targets.lookup(first.会话) && current.称呼 !== undefined && !conflicts) next.称呼 = first.称呼;
    return { next, count, conflicts };
  }
  const identity = targets.lookup(current.私聊会话 || current.目标会话);
  return identity && current.私聊QQ ? { next: { ...current, 称呼: identity.ownerName }, count: 1, conflicts: 0 } : { next: current, count: 0, conflicts: 0 };
}
export async function syncQq({ home, backupDir, targets }) {
  const file = path.join(home, 'qq-bridge-config.json'), current = readJson(file, undefined);
  if (!current) return result('not_configured', 'QQ 尚无保存的绑定配置，未创建配置');
  let plan;
  updateJson(file, fresh => { plan = planQq(fresh, targets); return plan.next; }, backupDir, 'names-qq-config');
  return result(plan.conflicts ? 'partial' : plan.count ? 'synced' : 'not_bound', plan.conflicts ? '部分私聊绑定的对象存在歧义，未覆盖冲突项' : `已同步 ${plan.count} 条对应私聊称呼；群聊、其他对象和收发开关保留`);
}
export const identityAdapters = { memory: syncMemory, mood: syncMood, bili: syncBili, qq: syncQq };
