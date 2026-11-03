import path from 'node:path';
import { readJson } from './json-store.js';
import { resolveRole } from './roles.js';
import { sessionKey } from './paths.js';

// Read-only routing hints, isolated from the runtime role and tool policies.
// These are saved settings, not proof that a background task has executed.
export function inspectIntegrations(home, versions, config, catalog) {
  const tasks = [], notes = [];
  const task = (id, label, target, enabled) => {
    const key = sessionKey(target);
    const session = key && catalog.lookup(key);
    const resolved = session ? resolveRole(config, session, catalog.lookup) : null;
    tasks.push({ id, label, sessionId: key || null, enabled, title: session?.title || '', workspace: session?.workspace || '', roleId: resolved?.role?.id || null,
      state: !key ? 'automatic' : !session || resolved.status === 'unresolved' ? 'unknown' : resolved.status === 'bound' ? 'bound' : 'unbound' });
  };
  if (versions.bili?.compatible) {
    try {
      const bili = readJson(path.join(home, 'bili-duty/config.json'), undefined);
      if (bili) {
        task('bili-scan', 'B站自动刷／互动目标（保存值）', bili.targetSession, undefined);
        task('bili-dynamic', 'B站自动发动态目标（保存值）', bili.dynamicSession || bili.targetSession, bili.dynamicOn === true && bili.dynamicAutoOn === true);
      } else notes.push({ plugin: 'bili', message: 'B站尚无保存的目标配置' });
    } catch { notes.push({ plugin: 'bili', message: 'B站保存的目标配置无法读取，未推测任务归属' }); }
  } else notes.push({ plugin: 'bili', message: '此 B站插件版本的目标检查尚未适配' });
  if (versions.qq?.compatible) {
    try {
      const qq = readJson(path.join(home, 'qq-bridge-config.json'), undefined);
      if (!qq) notes.push({ plugin: 'qq', message: 'QQ 桥尚无保存的会话绑定配置' });
      else if (Array.isArray(qq['绑定'])) qq['绑定'].slice(0, 30).forEach((row, index) => task(`qq-${index}`, `QQ ${row['类型'] === '群' ? '群聊' : '私聊'}绑定 ${index + 1}（保存值）`, row['会话'], row['开'] !== false));
      else {
        if (qq['私聊会话'] || qq['目标会话']) task('qq-private', 'QQ 私聊目标（保存值）', qq['私聊会话'] || qq['目标会话'], qq['总开关'] === true);
        if (qq['群会话']) task('qq-group', 'QQ 群聊目标（保存值）', qq['群会话'], qq['总开关'] === true);
      }
    } catch { notes.push({ plugin: 'qq', message: 'QQ 保存的绑定配置无法读取，未推测任务归属' }); }
  } else notes.push({ plugin: 'qq', message: '此 QQ 插件版本的目标检查尚未适配' });
  return { tasks, notes, mode: 'read_only' };
}
