import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { defaultConfig } from '../lib/roles.js';
import { identityTargets, moodWorkspaceKey } from '../lib/identity-targets.js';
import { syncMemory, syncMood } from '../lib/identity-adapters.js';

test('实际心情插件接口更新默认与工作区称呼，稳定份 ID 和历史账本不变', { skip: !process.env.FISH_CONSOLE_PLUGIN_ROOT }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-native-names-')); process.env.DSH_HOME = home;
  const cleanups = [];
  try {
    const workspace = fs.realpathSync(home), directory = path.join(home, 'feiyu-mood'); fs.mkdirSync(directory);
    const slot = { id: 'keep-state-id', 工作区: moodWorkspaceKey(workspace), sessions: [], selfName: '旧名字', ownerName: '管理员' };
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ 模式: 'workspace', selfName: '伙伴', ownerName: '用户', selfAliases: '原昵称', slots: [slot] }));
    const ledger = Buffer.from('{"version":1,"moods":{"keep-state-id":{"mood":74}}}'); fs.writeFileSync(path.join(directory, 'state.json'), ledger);
    const { apply } = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_PLUGIN_ROOT, 'dsh-feiyu-mood/lib/index.js')).href);
    const routes = new Map(), ctx = { get: () => undefined, on: () => () => {}, interval: () => () => {}, agents: { list: () => [], roots: () => [] },
      effect: fn => { const off = fn(); if (typeof off === 'function') cleanups.push(off); return off; },
      webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } } };
    apply(ctx);
    const request = async (route, body) => {
      const req = Readable.from(body ? [JSON.stringify(body)] : []); req.method = body ? 'POST' : 'GET'; let value, status;
      await routes.get(route)(req, { writeHead: code => { status = code; }, end: text => { value = JSON.parse(text); } });
      assert.equal(status, 200); assert.equal(value.ok, true); return value;
    };
    const config = defaultConfig(); config.roles[0].selfName = '小肥鱼001'; config.roles[0].ownerName = '老大'; config.bindings.workspaces = [{ workspace, roleId: 'role-default' }];
    const targets = identityTargets(config, { sessions: [], lookup: () => undefined });
    assert.equal((await syncMood({ backupDir: path.join(home, 'backups'), targets, request })).state, 'synced');
    const saved = (await request('/dsh-feiyu-mood/config')).config;
    assert.equal(saved.selfName, '小肥鱼001'); assert.equal(saved.ownerName, '老大'); assert.equal(saved.selfAliases, '原昵称');
    assert.equal(saved.slots[0].id, slot.id); assert.deepEqual(saved.slots[0].sessions, []); assert.equal(saved.slots[0].ownerName, '老大');
    assert.deepEqual(fs.readFileSync(path.join(directory, 'state.json')), ledger);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'))).ownerName, '老大');
  } finally { for (const off of cleanups.reverse()) off(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('实际记忆 1.4.6 按会话读取控制台同步的名字和称呼，不改历史记忆', { skip: !process.env.FISH_CONSOLE_PLUGIN_ROOT }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-native-memory-')); process.env.DSH_HOME = home;
  try {
    fs.mkdirSync(path.join(home, 'fish-memory'));
    const ledger = Buffer.from('{"version":1,"memories":[{"text":"原有历史记忆"}]}');
    fs.writeFileSync(path.join(home, 'fish-memory/session-a.json'), ledger);
    fs.writeFileSync(path.join(home, 'fish-memory-config.json'), JSON.stringify({ userPronoun: '旧称呼', unrelated: '保留字段' }));
    const memory = await import(pathToFileURL(path.join(process.env.FISH_CONSOLE_PLUGIN_ROOT, 'dsh-fish-memory/lib/index.js')).href);
    const config = defaultConfig(), role = config.roles[0], workspace = fs.realpathSync(home);
    role.selfName = '测试鱼'; role.ownerName = '通用称呼';
    config.bindings.workspaces = [{ workspace, roleId: role.id }];
    role.privateChat = { ...role.privateChat, enabled: true, ownerName: '专属称呼', localSessions: ['a'] };
    const session = { id: 'a', nativeId: 'session-a', workspace }, catalog = { sessions: [session], lookup: id => ['a', 'session-a'].includes(id) ? session : undefined };
    const routes = { bili: { compatible: false }, qq: { compatible: false } };
    const targets = identityTargets(config, catalog, routes);
    assert.equal((await syncMemory({ home, backupDir: path.join(home, 'backups'), targets })).state, 'synced');
    assert.equal(memory.selfNameOf('session-a'), '测试鱼'); assert.equal(memory.ownerNameOf('session-a'), '专属称呼');
    assert.equal(memory.loadCfg().userPronoun, '通用称呼'); assert.equal(memory.loadCfg().unrelated, '保留字段');
    assert.deepEqual(fs.readFileSync(path.join(home, 'fish-memory/session-a.json')), ledger);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
