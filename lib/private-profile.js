import { createHash } from 'node:crypto';
import { sessionKey } from './paths.js';

export function defaultPrivateProfile() {
  return { enabled: false, ownerName: '', persona: '', localSessions: [], bili: { uid: '', sessionId: '' }, qq: { number: '', sessionId: '' } };
}
function text(value, max, field) {
  if (typeof value !== 'string' || value.length > max || /[\u0000\u007f]/.test(value)) throw new Error(`${field}格式或长度无效`);
  return value.trim();
}
function target(value) {
  const id = text(value ?? '', 200, '私聊会话');
  if (/[\u0000-\u001f]/.test(id)) throw new Error('私聊会话标识无效');
  return sessionKey(id);
}
export function accountNumber(value, channel) {
  const number = text(value ?? '', 16, channel === 'bili' ? 'B站 UID' : 'QQ号');
  if (!number) return '';
  if (!(channel === 'bili' ? /^[1-9]\d{0,15}$/ : /^[1-9]\d{4,11}$/).test(number) || !Number.isSafeInteger(Number(number))) throw new Error(channel === 'bili' ? 'B站 UID 应填写准确的数字 UID，不是昵称或主页链接' : 'QQ号应为 5～12 位数字');
  return number;
}
export function cleanPrivateProfile(raw) {
  if (raw === undefined) return defaultPrivateProfile();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.enabled !== 'boolean') throw new Error('私聊身份配置格式无效');
  for (const channel of ['bili', 'qq']) if (raw[channel] !== undefined && (!raw[channel] || typeof raw[channel] !== 'object' || Array.isArray(raw[channel]))) throw new Error('私聊账号绑定格式无效');
  const ownerName = text(raw.ownerName ?? '', 16, '私聊称呼');
  if (/[\u0000-\u001f]/.test(ownerName)) throw new Error('私聊称呼不能包含换行');
  if (!Array.isArray(raw.localSessions) || raw.localSessions.length > 100) throw new Error('本机私聊会话清单无效');
  const localSessions = raw.localSessions.map(target);
  if (localSessions.some(id => !id) || new Set(localSessions).size !== localSessions.length) throw new Error('本机私聊会话不能空白或重复');
  return { enabled: raw.enabled, ownerName, persona: text(raw.persona ?? '', 12000, '与你聊天的专属规则'), localSessions,
    bili: { uid: accountNumber(raw.bili?.uid, 'bili'), sessionId: target(raw.bili?.sessionId) },
    qq: { number: accountNumber(raw.qq?.number, 'qq'), sessionId: target(raw.qq?.sessionId) } };
}
export function privateSessionIds(profile) {
  return [...new Set([...profile.localSessions, profile.bili.sessionId, profile.qq.sessionId].filter(Boolean))];
}
export function validatePrivateUniqueness(roles) {
  const sessions = new Set(), accounts = new Set();
  for (const role of roles.filter(role => role.privateChat.enabled)) {
    for (const id of privateSessionIds(role.privateChat)) {
      if (sessions.has(id)) throw new Error('同一间私聊会话不能同时属于多个角色');
      sessions.add(id);
    }
    for (const [channel, number] of [['bili', role.privateChat.bili.uid], ['qq', role.privateChat.qq.number]]) {
      if (!number) continue;
      const key = channel + ':' + number;
      if (accounts.has(key)) throw new Error('同一平台账号不能同时绑定到多个启用的私聊身份');
      accounts.add(key);
    }
  }
}
export function privateRevision(role) {
  return createHash('sha256').update(JSON.stringify([role.id, role.selfName, role.ownerName, role.privateChat])).digest('hex').slice(0, 16);
}
export function privateSections(role) {
  const profile = role.privateChat, ownerName = profile.ownerName || role.ownerName;
  const persona = profile.persona.replace(/\{\{(selfName|ownerName)\}\}/g, (_, key) => key === 'ownerName' ? ownerName : role.selfName);
  return [{ name: 'fish-console.private', interpolate: false, text: `<fish-console-private role="${role.id}" revision="${privateRevision(role)}">\n【只用于本轮已按绑定路由识别的本人私聊】\n沿用统一角色的名字、性格和背景。下面是与你私聊的使用者之间的专属补充；在本轮相处方式和称呼上优先于通用约定。\n本轮称呼对方为 ${JSON.stringify(ownerName)}。\n${persona || '暂未设置额外相处规则。'}\n这些补充只属于这一份私聊身份，不推广到群聊、公开互动、其他人或子代理，也不要主动向外介绍这些私人约定。账号绑定只是本机路由识别，不代表平台实名认证，也不增加任何工具权限。\n</fish-console-private>` }];
}
