import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMacScreenCapture } from '../lib/screen-capture.js';

// Synthetic capture bytes exercise the adapter without reading the real screen.
function png(width = 1200, height = 800) {
  const data = Buffer.alloc(50);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8); data.write('IHDR', 12);
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20);
  return data;
}
async function fixture(fn) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'fish-screen-test-'));
  try { await fn(temporaryRoot); } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
}

test('只在调用时截图；主屏幕命令无 shell，临时文件私有且完成后清理', async () => fixture(async temporaryRoot => {
  const calls = [];
  const capture = createMacScreenCapture({ platform: 'darwin', temporaryRoot, run: async (file, args, options) => {
    calls.push({ file, args });
    assert.equal(options.timeout, 15000); assert.equal(options.maxBuffer, 64 * 1024); assert.equal(options.shell, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    const output = args.at(-1);
    assert.equal((await stat(path.dirname(output))).mode & 0o777, 0o700);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    await writeFile(output, png());
    return { stdout: '', stderr: '' };
  } });
  assert.equal(calls.length, 0); assert.equal(capture.supported, true);
  const result = await capture.capture();
  assert.deepEqual(calls[0].args.slice(0, -1), ['-x', '-D', '1', '-t', 'png']);
  assert.equal(calls[0].file, '/usr/sbin/screencapture'); assert.equal(calls.length, 1);
  assert.deepEqual(result, { data: png(), mediaType: 'image/png', width: 1200, height: 800 });
  assert.deepEqual(await readdir(temporaryRoot), []);
}));

test('大屏截图先缩放；返回缩放后的尺寸和图片，缩放失败也清理', async () => fixture(async temporaryRoot => {
  const calls = [];
  const capture = createMacScreenCapture({ platform: 'darwin', temporaryRoot, run: async (file, args) => {
    calls.push(file); await writeFile(args.at(-1), png(calls.length === 1 ? 3600 : 1800, calls.length === 1 ? 2400 : 1200));
    return { stdout: '', stderr: '' };
  } });
  const result = await capture.capture();
  assert.deepEqual(calls, ['/usr/sbin/screencapture', '/usr/bin/sips']);
  assert.equal(result.width, 1800); assert.equal(result.height, 1200); assert.deepEqual(result.data, png(1800, 1200));
  assert.deepEqual(await readdir(temporaryRoot), []);
  const failed = createMacScreenCapture({ platform: 'darwin', temporaryRoot, run: async (file, args) => {
    if (file.endsWith('/sips')) throw new Error('PRIVATE-SCREEN-DETAILS');
    await writeFile(args.at(-1), png(3600, 2400));
  } });
  await assert.rejects(failed.capture(), error => error.code === 'SCREEN_CAPTURE_FAILED' && !error.message.includes('PRIVATE'));
  assert.deepEqual(await readdir(temporaryRoot), []);
}));

test('拒绝截屏、无效图片及超限图片不会泄漏原错误，临时文件始终清理', async () => fixture(async temporaryRoot => {
  for (const scenario of ['denied', 'invalid', 'oversized', 'unscaled']) {
    const capture = createMacScreenCapture({ platform: 'darwin', temporaryRoot, run: async (_file, args) => {
      if (scenario === 'denied') throw Object.assign(new Error('PRIVATE-CREDENTIAL'), { stderr: 'PRIVATE-CREDENTIAL' });
      if (scenario === 'invalid') await writeFile(args.at(-1), Buffer.from('PRIVATE-CREDENTIAL'));
      if (scenario === 'oversized') await writeFile(args.at(-1), png(32769, 900));
      if (scenario === 'unscaled') await writeFile(args.at(-1), png(3600, 2400));
    } });
    await assert.rejects(capture.capture(), error => String(error.code).startsWith('SCREEN_CAPTURE_') && !error.message.includes('PRIVATE'));
    assert.deepEqual(await readdir(temporaryRoot), []);
  }
}));

test('不支持的平台、已取消请求不调用系统命令；运行中取消清理截图', async () => fixture(async temporaryRoot => {
  let called = 0;
  const run = async () => { called++; };
  const unsupported = createMacScreenCapture({ platform: 'linux', temporaryRoot, run });
  assert.equal(unsupported.supported, false);
  await assert.rejects(unsupported.capture(), { code: 'SCREEN_CAPTURE_UNSUPPORTED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createMacScreenCapture({ platform: 'darwin', temporaryRoot, run }).capture({ signal: controller.signal }), { code: 'SCREEN_CAPTURE_ABORTED' });
  assert.equal(called, 0);
  const active = new AbortController();
  const capture = createMacScreenCapture({ platform: 'darwin', temporaryRoot, run: async (_file, args) => {
    await writeFile(args.at(-1), png()); active.abort();
  } });
  await assert.rejects(capture.capture({ signal: active.signal }), { code: 'SCREEN_CAPTURE_ABORTED' });
  assert.deepEqual(await readdir(temporaryRoot), []);
}));

test('系统命令超时给出明确错误，且不会保留已经产生的截图', async () => fixture(async temporaryRoot => {
  const capture = createMacScreenCapture({ platform: 'darwin', temporaryRoot, run: async (_file, args) => {
    await writeFile(args.at(-1), png());
    throw Object.assign(new Error('PRIVATE-SCREEN-CONTENT'), { killed: true });
  } });
  await assert.rejects(capture.capture(), error => error.code === 'SCREEN_CAPTURE_TIMEOUT' && error.message.includes('超时') && !error.message.includes('PRIVATE'));
  assert.deepEqual(await readdir(temporaryRoot), []);
}));
