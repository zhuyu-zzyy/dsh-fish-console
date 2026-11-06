import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectIntegrations } from '../lib/integrations.js';
import { defaultConfig } from '../lib/roles.js';
test('后台目标检查只读取已适配字段；绑定目标工作区后无需改其他插件配置', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-console-route-'));
  try {
    fs.mkdirSync(path.join(home, 'bili-duty'));
    const file = path.join(home, 'bili-duty/config.json'); const bytes = Buffer.from('{"targetSession":"a","dynamicSession":"session-b","dynamicOn":true,"dynamicAutoOn":true,"ownerName":"原配置"}'); fs.writeFileSync(file, bytes);
    const config = defaultConfig(); config.bindings.workspaces = [{ workspace: '/a', roleId: 'role-default' }];
    const sessions = { a: { id: 'a', workspace: '/a', title: '刷B站' }, b: { id: 'b', workspace: '/b', title: '发动态' } };
    const catalog = { lookup: id => sessions[id] };
    const versions = { bili: { compatible: true }, qq: { compatible: true } };
    assert.deepEqual(inspectIntegrations(home, versions, config, catalog).tasks.map(t => t.state), ['bound', 'unbound']);
    config.bindings.workspaces.push({ workspace: '/b', roleId: 'role-default' });
    assert.equal(inspectIntegrations(home, versions, config, catalog).tasks[1].roleId, 'role-default');
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(inspectIntegrations(home, {}, config, catalog).tasks.length, 0);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
