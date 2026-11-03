import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MODERN_URL = 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture';
const LEGACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

// This opens the pane only. It never requests or changes the permission itself.
export function createScreenPermissionGuide({ platform = process.platform, release = os.release(), run = execute } = {}) {
  const supported = platform === 'darwin';
  const url = Number.parseInt(release, 10) >= 22 ? MODERN_URL : LEGACY_URL;
  return {
    supported,
    async open({ signal } = {}) {
      if (!supported) throw new Error('屏幕录制权限引导仅支持 macOS；请在本机系统设置中检查对应权限。');
      if (signal?.aborted) throw new Error('打开屏幕录制设置已取消。');
      try {
        await run('/usr/bin/open', [url], { signal, timeout: 5000, maxBuffer: 16 * 1024, encoding: 'utf8' });
      } catch {
        throw new Error('未能打开屏幕录制设置，请手动前往 macOS「系统设置 → 隐私与安全性 → 屏幕录制」。');
      }
      return { message: '已打开屏幕录制设置。请自行允许 DeepSeek Harness 或实际启动它的程序，并按系统提示重启后返回重试。' };
    },
  };
}
