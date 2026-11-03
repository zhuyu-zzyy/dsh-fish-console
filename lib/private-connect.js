import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveRole } from './roles.js';
import { updateJson, readJson } from './json-store.js';
import { sessionKey } from './paths.js';
import { biliConfigDiverged, biliOtherPeers, biliPublicUse, inspectPrivateChannel, privateSessionConflict, qqBindings } from './private-routing.js';

function backup(directory, channel, config) {
  const bytes = JSON.stringify(config, null, 2) + '\n', hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(path.join(directory, `private-${channel}-${hash}.json`), bytes, { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
export function planBiliConnection(current, role, descriptor, routes) {
  const profile = role.privateChat, id = descriptor.id;
  if (biliOtherPeers(current, profile.bili.uid)) throw new Error('B站额外私信名单里还有其他账号，请先在刷B站确认名单，未覆盖原名单');
  const mode = current.autoMode || (current.peakValley ? 'valley' : 'manual');
  if (mode !== 'manual' || (current.watchOn && current.watchAt !== false)) throw new Error('B站互动入口仍用于自动刷或公开互动；请先在刷B站选择私信专用用法，未停止原任务');
  const dynamic = sessionKey(current.dynamicSession || current.targetSession);
  if (current.dynamicOn && current.dynamicAutoOn && !current.dynamicSession && !current.targetSession) throw new Error('自动动态的原目标尚未固定，请先在刷B站明确其目标会话');
  if (current.dynamicOn && current.dynamicAutoOn && dynamic === id) throw new Error('这间会话正在用于自动公开动态，请选择另一间专用私聊会话');
  const crossRoutes = { ...routes, bili: { ...routes.bili, config: undefined } };
  const conflict = privateSessionConflict(role, id, crossRoutes);
  if (conflict) throw new Error(conflict);
  // When an existing dynamic task follows targetSession, preserve its original
  // destination rather than silently rerouting it into the private Session.
  const patch = { dmUid: Number(profile.bili.uid), targetSession: descriptor.nativeId || descriptor.id, dmMode: 'only', inboxOn: true, watchOn: true, watchDm: true, watchAt: false, watchScope: 'always' };
  if (current.dynamicOn && current.dynamicAutoOn && !current.dynamicSession && current.targetSession) patch.dynamicSession = current.targetSession;
  return patch;
}
export function planQqConnection(current, role, descriptor, routes) {
  const profile = role.privateChat, id = descriptor.id, number = profile.qq.number;
  const rows = qqBindings(current);
  const other = rows.find(row => sessionKey(row.会话) === id && (row.类型 !== '私聊' || String(row.号码) !== number));
  if (other) throw new Error('这间会话还连接 QQ 群或其他私聊对象，请选择专用会话');
  const existing = rows.find(row => row.类型 === '私聊' && String(row.号码) === number);
  if (existing && sessionKey(existing.会话) !== id) throw new Error('这个 QQ号已连接另一间会话，请先在通到QQ确认原绑定，未自动搬移');
  const crossRoutes = { ...routes, qq: { ...routes.qq, config: undefined } };
  const conflict = privateSessionConflict(role, id, crossRoutes);
  if (conflict) throw new Error(conflict);
  const owner = profile.ownerName || role.ownerName;
  const row = { ...(existing || {}), 类型: '私聊', 号码: number, 会话: descriptor.nativeId || descriptor.id, 称呼: owner, 开: true };
  const next = { ...current, 绑定: existing ? rows.map(item => item === existing ? row : item) : [...rows, row] };
  if (!current) next.总开关 = false;
  const first = next.绑定.find(item => item.类型 === '私聊');
  next.私聊QQ = first.号码; next.私聊会话 = first.会话; next.目标会话 = first.会话; next.称呼 = first.称呼;
  return next;
}
export async function connectPrivateChannel({ channel, role, config, catalog, routes, home, request, isCurrent = () => true }) {
  if (!['bili', 'qq'].includes(channel)) throw new Error('未知私聊平台');
  const profile = role?.privateChat, binding = profile?.[channel];
  if (!profile?.enabled || !binding?.sessionId || !(channel === 'bili' ? binding.uid : binding.number)) throw new Error('请先保存并启用私聊身份，填写账号与会话');
  if (!routes[channel].compatible || routes[channel].error) throw new Error('该插件版本尚未适配或配置不可读，未修改连接');
  const descriptor = catalog.lookup(binding.sessionId), resolved = descriptor && resolveRole(config, descriptor, catalog.lookup);
  if (!descriptor || descriptor.ambiguous || resolved?.role?.id !== role.id) throw new Error('专用会话归属尚未确认，请先绑定到当前角色');
  const backupDir = path.join(home, 'fish-console/backups');
  if (channel === 'bili') {
    const current = (await request('/api/bili-duty/config')).config;
    if (!current) throw new Error('B站未返回可识别的配置');
    const disk = readJson(path.join(home, 'bili-duty/config.json'), undefined);
    if (disk && biliConfigDiverged(disk, current)) throw new Error('B站生效设置与保存设置不一致，未改动原有任务，请先检查刷B站配置');
    if (config.roles.some(other => other.id !== role.id && other.privateChat.enabled && other.privateChat.bili.uid === String(current.dmUid || '') && other.privateChat.bili.sessionId === sessionKey(current.targetSession))) throw new Error('B站入口已连接另一个角色的私聊身份，请先在该身份中停用连接用途，未覆盖原入口');
    const patch = planBiliConnection(current, role, descriptor, routes);
    const fresh = (await request('/api/bili-duty/config')).config;
    const latestDisk = readJson(path.join(home, 'bili-duty/config.json'), undefined);
    if (JSON.stringify(current) !== JSON.stringify(fresh) || JSON.stringify(disk) !== JSON.stringify(latestDisk) || !isCurrent()) throw new Error('设置刚发生变化，请刷新后再连接');
    backup(backupDir, 'bili', current);
    const saved = await request('/api/bili-duty/config', patch);
    if (saved.host?.ok === false) return { state: 'attention', message: 'B站本地连接已保存，但宿主设置未确认；请刷新后重试' };
    const after = (await request('/api/bili-duty/config')).config;
    if (!after || Object.entries(patch).some(([key, value]) => after[key] !== value) || biliPublicUse(after, descriptor.id)) throw new Error('B站连接尚未确认，请刷新检查');
    return { state: 'connected', message: 'B站本人私信入口已连接，下一条新私信会核对并应用专属规则；未发送测试消息' };
  }
  const file = path.join(home, 'qq-bridge-config.json');
  if (!isCurrent()) throw new Error('控制台设置已变化，请刷新');
  updateJson(file, current => {
    if (!isCurrent()) throw new Error('控制台设置已变化，请刷新');
    const existed = Object.keys(current).length > 0;
    return planQqConnection(existed ? current : undefined, role, descriptor, routes);
  }, backupDir, 'private-qq-config');
  const saved = readJson(file, undefined), state = inspectPrivateChannel(role, channel, { ...routes, qq: { ...routes.qq, config: saved } });
  if (!state.eligible) throw new Error('QQ 绑定保存后未能确认专用路由');
  return { state: state.state === 'ready' ? 'connected' : 'paused', message: state.message + '；未发送测试消息' };
}
