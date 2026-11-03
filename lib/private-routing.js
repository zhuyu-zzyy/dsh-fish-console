import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson } from './json-store.js';
import { sessionKey } from './paths.js';

export function qqBindings(config) {
  if (config?.绑定 !== undefined) {
    if (!Array.isArray(config.绑定)) throw new Error('QQ 绑定格式未知');
    return config.绑定;
  }
  const rows = [];
  const id = config?.私聊会话 || config?.目标会话;
  if (id && config.私聊QQ) rows.push({ 类型: '私聊', 号码: config.私聊QQ, 会话: id });
  if (config?.群会话 && config?.群号) rows.push({ 类型: '群', 号码: config.群号, 会话: config.群会话 });
  return rows;
}
export function readPrivateRoutes(home, versions) {
  const read = (file, version) => {
    try { return { config: readJson(path.join(home, file), undefined), compatible: !!version?.compatible, version: version?.version || null }; }
    catch { return { error: true, compatible: !!version?.compatible, version: version?.version || null }; }
  };
  return { bili: read('bili-duty/config.json', versions.bili), qq: read('qq-bridge-config.json', versions.qq) };
}
// Bili's host settings may override its saved file. Ask the plugin itself for
// its freshly refreshed configuration before using it as routing evidence.
export async function readEffectivePrivateRoutes(home, versions, request) {
  const routes = readPrivateRoutes(home, versions);
  if (!versions.bili?.compatible) return routes;
  try {
    const config = (await request('/api/bili-duty/config')).config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid Bili configuration');
    routes.bili = { ...routes.bili, error: false, config };
  } catch {
    // If the installed plugin cannot describe its active routes, never infer
    // that another private session is isolated from it using stale disk data.
    routes.bili = { ...routes.bili, error: true };
  }
  return routes;
}
export const maskedAccount = value => value ? (String(value).length <= 4 ? '****' : String(value).slice(0, 2) + '***' + String(value).slice(-2)) : '';
export function biliOtherPeers(config, uid) {
  return [...new Set(String(config?.inboxUids || '').split(/[,，\s]+/).filter(Boolean))].some(value => value !== uid);
}
// A Bili settings POST saves its whole effective config, not just the patch.
// Refuse such writes if they would silently replace unrelated saved fields.
export function biliConfigDiverged(saved, effective, ignored = []) {
  if (!saved || !effective || typeof saved !== 'object' || typeof effective !== 'object' || Array.isArray(saved) || Array.isArray(effective)) return true;
  const ignore = new Set(ignored);
  return Object.keys(saved).some(key => !ignore.has(key) && JSON.stringify(saved[key]) !== JSON.stringify(effective[key]));
}
export function biliPublicUse(config, id) {
  const target = sessionKey(config?.targetSession), dynamic = sessionKey(config?.dynamicSession || config?.targetSession);
  if (dynamic === id && config?.dynamicOn && config?.dynamicAutoOn) return true;
  if (target !== id) return false;
  const mode = config.autoMode || (config.peakValley ? 'valley' : 'manual');
  return mode !== 'manual' || (config.watchOn === true && config.watchAt !== false) || config.dmMode !== 'only';
}
// Native QQ 1.4 broadcasts a Session's replies to every binding of that Session.
// Check outgoing routes as well as the current incoming source.
export function privateSessionConflict(role, id, routes) {
  const profile = role.privateChat;
  for (const channel of ['bili', 'qq']) if (routes[channel].error) return '插件配置无法读取，暂不能确认私聊会话是否专用';
  try {
    const rows = qqBindings(routes.qq.config).filter(row => sessionKey(row.会话) === id);
    if (rows.length && (!routes.qq.compatible || profile.qq.sessionId !== id || rows.some(row => row.类型 !== '私聊' || String(row.号码) !== profile.qq.number))) return '这间会话同时连接了 QQ 群或其他对象，请改用专用私聊会话';
  } catch { return 'QQ 绑定格式未知，暂不能确认会话是否专用'; }
  const bili = routes.bili.config;
  if (bili && (sessionKey(bili.targetSession) === id || (bili.dynamicOn && bili.dynamicAutoOn && sessionKey(bili.dynamicSession || bili.targetSession) === id))) {
    if (!routes.bili.compatible || profile.bili.sessionId !== id || String(bili.dmUid || '') !== profile.bili.uid || biliOtherPeers(bili, profile.bili.uid) || biliPublicUse(bili, id)) return '这间会话仍连接 B站公开任务或其他私信对象，请先使用独立的私信入口';
  }
  return '';
}
export function inspectPrivateChannel(role, channel, routes) {
  const profile = role.privateChat, binding = profile[channel], account = channel === 'bili' ? binding.uid : binding.number;
  const response = (state, message, eligible = false) => ({ state, message, eligible, sessionId: binding.sessionId, account: maskedAccount(account) });
  if (!profile.enabled) return response('disabled', '私聊身份尚未启用');
  if (!account || !binding.sessionId) return response('incomplete', '请填写账号并选择专用私聊会话');
  const route = routes[channel];
  if (!route.compatible) return response('unsupported', '插件未安装或此版本尚未适配，未应用专属规则');
  if (route.error) return response('unavailable', '插件配置暂不可读');
  const conflict = privateSessionConflict(role, binding.sessionId, routes);
  if (conflict) return response('conflict', conflict);
  const config = route.config;
  if (channel === 'bili') {
    if (!config || String(config.dmUid || '') !== account || sessionKey(config.targetSession) !== binding.sessionId) return response('unbound', '账号已保存到控制台，尚未连接到 B站插件');
    if (biliOtherPeers(config, account)) return response('conflict', 'B站额外私信名单里还有其他账号，无法确认单独属于你');
    return config.watchOn && config.watchDm !== false && config.inboxOn !== false
      ? response('ready', '已连接本人私信入口，等待下一条私信验证', true)
      : response('paused', '路由已对应，但自动接收私信尚未开启', true);
  }
  let rows;
  try { rows = qqBindings(config).filter(row => sessionKey(row.会话) === binding.sessionId); } catch { return response('unavailable', 'QQ 绑定格式未知'); }
  if (!rows.some(row => row.类型 === '私聊' && String(row.号码) === account)) return response('unbound', '账号已保存到控制台，尚未连接到 QQ 插件');
  return config?.总开关 && rows.some(row => row.开 !== false)
    ? response('ready', '已连接本人 QQ 私聊，等待下一条私信验证', true)
    : response('paused', '绑定已保存；请在通到 QQ 完成连接服务设置并开启接收', true);
}
export function privateRouteRevision(routes) {
  // Hash the route witness, without retaining account IDs in runtime observations.
  return createHash('sha256').update(JSON.stringify([
    routes.bili.compatible, routes.bili.version, routes.bili.error, routes.bili.config && Object.fromEntries(['dmUid', 'targetSession', 'dynamicSession', 'dynamicOn', 'dynamicAutoOn', 'autoMode', 'peakValley', 'dmMode', 'watchOn', 'watchAt', 'watchDm', 'watchScope', 'inboxOn', 'inboxUids', 'ownerName', 'triggerPrompt'].map(key => [key, routes.bili.config[key]])),
    routes.qq.compatible, routes.qq.version, routes.qq.error, routes.qq.config && { 绑定: qqBindings(routes.qq.config), 来源头: routes.qq.config.来源头 },
  ])).digest('hex').slice(0, 16);
}
function prefixText(message) {
  if (!Array.isArray(message.content)) return typeof message.content === 'string' ? message.content.slice(0, 256) : '';
  const first = message.content.find(block => block?.type === 'text' && typeof block.text === 'string');
  return first?.text.slice(0, 256) || '';
}
export function identifyPrivateInput(role, descriptor, message, routes) {
  const profile = role.privateChat, id = descriptor.id;
  if (!profile.enabled || descriptor.origin === 'subagent' || privateSessionConflict(role, id, routes)) return null;
  const kind = message?.source?.kind;
  if (kind === 'user' && profile.localSessions.includes(id)) return { channel: 'local' };
  if (kind === 'qq' && profile.qq.sessionId === id && inspectPrivateChannel(role, 'qq', routes).eligible && routes.qq.config?.来源头 !== false && prefixText(message).startsWith('【QQ私聊】\n')) return { channel: 'qq' };
  if (kind === 'bili-duty-scan' && profile.bili.sessionId === id && inspectPrivateChannel(role, 'bili', routes).eligible) {
    const config = routes.bili.config, owner = String(config.ownerName || '你');
    const starts = ['⚠️ 这一轮只有' + owner + '私信转来的一条视频：', '⚠️ 这一轮只是' + owner + '在 **B站 私信**里跟你说了一句话（没带视频）：'];
    // This prefix is generated by the pinned native adapter only for an all-DM
    // batch. Never search user text or accept a manually forged chat header.
    const base = String(config.triggerPrompt || '').replaceAll('{owner}', owner);
    if (!starts.some(start => base.startsWith(start)) && starts.some(start => prefixText(message).startsWith(start))) return { channel: 'bili' };
  }
  return null;
}
