import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

export function readJson(file, missing) {
  try { return JSON.parse(decode(fs.readFileSync(file))); }
  catch (error) { if (error.code === 'ENOENT') return missing; throw error; }
}

// Update configuration only; historical memory records never pass here.
// Re-read before replacing so an edit made while preparing the change is retried.
export function updateJson(file, transform, backupDir, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let before;
    try { before = fs.readFileSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const current = before ? JSON.parse(decode(before)) : {};
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('配置格式不兼容');
    const next = transform(structuredClone(current));
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    let latest;
    try { latest = fs.readFileSync(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before === undefined ? latest !== undefined : latest === undefined || !before.equals(latest)) continue;
    if (before) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(backupDir, `${label}-${Date.now()}-${randomUUID()}.json`), before, { flag: 'wx', mode: 0o600 });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    return true;
  }
  throw new Error('配置正在被其他页面修改，请稍后重试');
}
