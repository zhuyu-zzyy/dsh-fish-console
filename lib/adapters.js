import fs from 'node:fs';
import path from 'node:path';

// Names are a compatibility contract, not a provider identity: DSH tool names
// are global and same-named tools from other providers cannot be distinguished.
export const adapters = Object.freeze({
  bili: { package: 'dsh-bili-subagent', verified: ['0.8.7', '0.8.8'], tools: ['bili_scan', 'bili_whoami', 'bili_search', 'bili_subtitle', 'bili_comments', 'bili_reply', 'bili_triple', 'bili_send_message', 'bili_send_dynamic', 'bili_status', 'bili_login_start', 'bili_login_poll', 'bili_setup', 'bili_config'] },
  qq: { package: 'dsh-qq-bridge', verified: '1.4.0', tools: ['qq_reply_gate'] },
  memory: { package: 'dsh-fish-memory', verified: ['1.4.3', '1.4.6'], tools: ['remember'], sections: ['memory-hint'], contexts: ['memory'] },
  mood: { package: 'dsh-feiyu-mood', verified: ['0.8.0', '0.8.2'], tools: [], contexts: ['feiyu-mood'] },
});
export function installedAdapters(home, profile = 'desktop') {
  return Object.fromEntries(Object.entries(adapters).map(([key, def]) => {
    const supported = Array.isArray(def.verified) ? def.verified : [def.verified];
    const expected = supported.join(' / ');
    try {
      const file = path.join(home, 'profiles', profile, 'node_modules', def.package, 'package.json');
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      return [key, { package: def.package, version: info.version, expected, compatible: info.name === def.package && supported.includes(info.version) }];
    } catch { return [key, { package: def.package, version: null, expected, compatible: false }]; }
  }));
}
