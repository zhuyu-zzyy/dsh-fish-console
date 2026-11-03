import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

test('B站配置应读取真实 DSH volatile 值，改称呼不覆盖自动任务且模型切换立即生效', { skip: !process.env.FISH_CONSOLE_BILI_ROOT || !process.env.FISH_CONSOLE_DSH_MODULES, timeout: 10000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-bili-volatile-'));
  const oldHome = process.env.DSH_HOME, oldModules = process.env.DSH_HOST_MODULES, cleanup = [];
  process.env.DSH_HOME = home; process.env.DSH_HOST_MODULES = path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai');
  try {
    const plugin = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_BILI_ROOT, 'index.js')).href);
    const { resolveConfig } = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai/cordis/lib/index.js')).href);
    const { createVolatile, updateVolatile } = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_DSH_MODULES, '@deepseek-ai/cosmokit/lib/index.js')).href);
    const raw = { perDay: 2, mentionName: '', autoComment: false, autoMode: 'valley', gapMin: 60, dmMode: 'only', dmUid: 555888999, targetSession: 'session-a', ownerName: '通用称呼', inboxOn: false, watchOn: true, watchDm: true, watchAt: true, watchScope: 'always', dynamicOn: true, dynamicAutoOn: true, dynamicSession: 'session-public', subModel: 'model-A' };
    fs.mkdirSync(path.join(home, 'bili-duty')); fs.writeFileSync(path.join(home, 'bili-duty/config.json'), JSON.stringify(raw));
    const hot = resolveConfig({ Config: plugin.Config }, raw);
    assert.equal(typeof hot.dmUid.get, 'function'); assert.equal(typeof hot.watchOn.get, 'function');
    const row = { ns: 'bili-scroll', revision: 'test', value: { ...raw }, user: { ...raw } }, routes = new Map();
    const ctx = { tools: { register: () => () => {} }, agents: { list: () => [] }, subagents: {}, llm: {},
      settings: { describe: () => [row], update: async (_ns, patch) => { for (const [key, value] of Object.entries(patch)) { updateVolatile(hot[key], createVolatile(value)); row.value[key] = value; row.user[key] = value; } } },
      effect: fn => { const off = fn(); if (typeof off === 'function') cleanup.push(off); },
      webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } } };
    plugin.apply(ctx, hot);
    const request = async body => {
      const req = Readable.from(body ? [JSON.stringify(body)] : []); req.method = body ? 'POST' : 'GET'; req.url = '/api/bili-duty/config'; let result;
      await routes.get('/api/bili-duty')(req, { writeHead: () => {}, end: text => { result = JSON.parse(text); } }); assert.equal(result.ok, true); return result;
    };
    const before = (await request()).config;
    for (const [key, value] of Object.entries(raw)) assert.equal(before[key], value, key);
    await request({ ownerName: '老大' });
    const after = (await request()).config, disk = JSON.parse(fs.readFileSync(path.join(home, 'bili-duty/config.json')));
    for (const [key, value] of Object.entries(raw)) if (key !== 'ownerName') { assert.equal(after[key], value, key); assert.equal(disk[key], value, key); }
    assert.equal(after.ownerName, '老大');
    updateVolatile(hot.subModel, createVolatile('model-B'));
    assert.equal((await request()).config.subModel, 'model-B');
  } finally {
    for (const off of cleanup.reverse()) off();
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    if (oldModules === undefined) delete process.env.DSH_HOST_MODULES; else process.env.DSH_HOST_MODULES = oldModules;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
