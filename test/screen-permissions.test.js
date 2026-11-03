import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenPermissionGuide } from '../lib/screen-permissions.js';

test('权限引导只用固定系统命令打开屏幕录制设置，不接受客户端地址', async () => {
  for (const [release, expected] of [
    ['22.0.0', 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'],
    ['25.1.0', 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'],
    ['21.6.0', 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'],
  ]) {
    const calls = [];
    const guide = createScreenPermissionGuide({ platform: 'darwin', release, run: async (...args) => { calls.push(args); } });
    assert.equal(calls.length, 0, '创建引导不得自动打开系统设置');
    const result = await guide.open({ url: 'https://attacker.invalid', command: 'arbitrary' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/usr/bin/open');
    assert.deepEqual(calls[0][1], [expected]);
    assert.equal(calls[0][2].timeout, 5000);
    assert.equal(calls[0][2].shell, undefined);
    assert.match(result.message, /自行允许 DeepSeek Harness/);
  }
});

test('不支持的平台或已取消请求不运行命令，系统错误不泄漏原始输出', async () => {
  let calls = 0;
  const run = async () => { calls++; throw new Error('PRIVATE-ERROR-CONTENT'); };
  const unsupported = createScreenPermissionGuide({ platform: 'linux', run });
  assert.equal(unsupported.supported, false);
  await assert.rejects(unsupported.open(), /仅支持 macOS/);
  const guide = createScreenPermissionGuide({ platform: 'darwin', release: '25.1.0', run });
  await assert.rejects(guide.open({ signal: AbortSignal.abort() }), /已取消/);
  assert.equal(calls, 0);
  await assert.rejects(guide.open(), error => /未能打开屏幕录制设置/.test(error.message) && !error.message.includes('PRIVATE-ERROR-CONTENT'));
  assert.equal(calls, 1);
});
