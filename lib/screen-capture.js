import { execFile } from 'node:child_process';
import { chmod, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1800;
const TIMEOUT_MS = 15000;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function dimensions(header) {
  if (header.length < 33 || !header.subarray(0, 8).equals(PNG_SIGNATURE)
    || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR') {
    throw failure('SCREEN_CAPTURE_INVALID_IMAGE', '截图没有生成有效的 PNG 图片，请检查屏幕录制权限后重试。');
  }
  const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
  if (!width || !height || width > 32768 || height > 32768 || width * height > 100000000) {
    throw failure('SCREEN_CAPTURE_INVALID_IMAGE', '截图尺寸超出支持范围，请降低显示器分辨率后重试。');
  }
  return { width, height };
}
async function inspect(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size < 33 || info.size > MAX_CAPTURE_BYTES) {
    throw failure('SCREEN_CAPTURE_INVALID_IMAGE', '截图为空或文件过大，请检查屏幕录制权限或降低分辨率后重试。');
  }
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(33);
    await handle.read(header, 0, header.length, 0);
    return { ...dimensions(header), bytes: info.size };
  } finally { await handle.close(); }
}

/** Capture the main Mac display on demand. No command runs until capture(). */
export function createMacScreenCapture({ platform = process.platform, run = execute, temporaryRoot = os.tmpdir() } = {}) {
  const supported = platform === 'darwin';
  return {
    supported,
    async capture({ signal } = {}) {
      if (!supported) throw failure('SCREEN_CAPTURE_UNSUPPORTED', '第一版屏幕感知仅支持 macOS。');
      if (signal?.aborted) throw failure('SCREEN_CAPTURE_ABORTED', '截图已取消。');
      const deadline = AbortSignal.timeout(TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const options = { signal: combined, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024, encoding: 'utf8' };
      let directory;
      try {
        directory = await mkdtemp(path.join(temporaryRoot, 'fish-screen-'));
        await chmod(directory, 0o700);
        const file = path.join(directory, 'screen.png');
        await writeFile(file, Buffer.alloc(0), { mode: 0o600, flag: 'wx' });
        await run('/usr/sbin/screencapture', ['-x', '-D', '1', '-t', 'png', file], options);
        combined.throwIfAborted();
        await chmod(file, 0o600);
        let info = await inspect(file);
        if (Math.max(info.width, info.height) > MAX_IMAGE_EDGE) {
          await run('/usr/bin/sips', ['-Z', String(MAX_IMAGE_EDGE), '-s', 'format', 'png', file], options);
          combined.throwIfAborted();
          await chmod(file, 0o600);
          info = await inspect(file);
        }
        if (Math.max(info.width, info.height) > MAX_IMAGE_EDGE || info.bytes > MAX_IMAGE_BYTES) {
          throw failure('SCREEN_CAPTURE_TOO_LARGE', '截图压缩后仍超出图片大小限制，请降低显示器分辨率后重试。');
        }
        const data = await readFile(file);
        combined.throwIfAborted();
        return { data, mediaType: 'image/png', width: info.width, height: info.height };
      } catch (error) {
        if (signal?.aborted) throw failure('SCREEN_CAPTURE_ABORTED', '截图已取消。');
        if (deadline.aborted || error?.killed || error?.code === 'ETIMEDOUT') {
          throw failure('SCREEN_CAPTURE_TIMEOUT', '截图超时，请确认屏幕可用及屏幕录制权限后重试。');
        }
        if (String(error?.code || '').startsWith('SCREEN_CAPTURE_')) throw error;
        // Native stderr can contain filenames or screen details; keep it local.
        throw failure('SCREEN_CAPTURE_FAILED', '无法截取屏幕。请在 macOS「系统设置 → 隐私与安全性 → 屏幕录制」允许 DeepSeek Harness 或实际启动它的程序，按系统提示重启后重试。锁屏或受保护画面也可能无法采集。');
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
