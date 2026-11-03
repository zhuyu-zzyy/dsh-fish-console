const fs = require('fs');
const os = require('os');
const path = require('path');
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profile = path.join(home, 'profiles', 'desktop');
const file = path.join(profile, 'package.json');
const link = path.join(profile, 'node_modules', 'dsh-fish-console');
const source = fs.realpathSync(__dirname);
const original = fs.readFileSync(file);
const json = JSON.parse(original.toString('utf8'));
if (!Array.isArray(json?.dsh?.profile?.bundles) || !json.dependencies) throw new Error('desktop profile 格式不兼容');
let existing;
try { existing = fs.lstatSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (existing && (!existing.isSymbolicLink() || fs.realpathSync(link) !== source)) throw new Error('已有同名插件，未覆盖');
const backup = path.join(profile, `package.json.fish-console-backup-${Date.now()}`);
fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
let linked = false;
try {
  if (!existing) { fs.symlinkSync(source, link, 'dir'); linked = true; }
  json.dependencies['dsh-fish-console'] = 'link:' + source;
  if (!json.dsh.profile.bundles.includes('dsh-fish-console')) json.dsh.profile.bundles.push('dsh-fish-console');
  const temporary = path.join(profile, `.package-fish-console-${process.pid}.tmp`);
  try { fs.writeFileSync(temporary, JSON.stringify(json, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
  console.log(JSON.stringify({ ok: true, profile, link, source, backup }));
} catch (error) {
  if (linked) try { fs.unlinkSync(link); } catch {}
  throw error;
}
