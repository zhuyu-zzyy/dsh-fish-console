import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const avatar = fileURLToPath(new URL('../lib/avatar/', import.meta.url));

// Runs inside the real bundled WKWebView after startup, using the production controls and pipe protocol.
async function exercise() {
  const canvas = document.getElementById('avatar');
  const select = document.getElementById('scene');
  const frames = [];
  function choose(value) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }
  async function visible(id) {
    const deadline = performance.now() + 7000;
    while (canvas.dataset.fishScene !== id && performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 25));
    }
    if (canvas.dataset.fishScene !== id) throw Error(id + ': ' + document.getElementById('notice').textContent);
    frames.push(id);
  }
  window.fishReceive({kind:'bind',generation:1,canRecord:false,active:false,voice:false});
  // An unfolded pane is needed when a user's saved desktop is parked at the right edge.
  canvas.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true}));
  for (const id of ['swing','eat_rice','sleep']) {
    choose(id);
    await visible(id);
  }
  window.fishReceive({kind:'listen',generation:1,value:true});
  await visible('main');
  window.fishReceive({kind:'listen',generation:1,value:false});
  choose('eat_rice');await visible('eat_rice');
  const event = (type,data) => window.fishReceive({kind:'event',generation:1,event:{type,data}});
  event('turn/start',{turn:'test'});await visible('main');
  event('fish-avatar/cue',{turn:'test',idleScene:'swing',idleExpression:'innocent'});
  event('turn/end',{turn:'test',reason:{kind:'completed'}});await visible('swing');
  await visible('main');
  return frames;
}

test('原生窗口可试播三个模型，录音及新消息唤回聊天，Agent 提示播放一轮', {
  skip: process.platform !== 'darwin' || process.env.FISH_CONSOLE_NATIVE_LAYOUT !== '1',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'fish-idle-native-'));
  try {
    await cp(avatar,root,{recursive:true});
    await appendFile(path.join(root,'desktop/pet.js'), '\nconst originalReceive = window.fishReceive;\n' +
      'window.fishReceive = async message => { originalReceive(message); if (message.kind !== "initialScale") return;\n' +
      'try { post({kind:"idleProbe", scenes: await (' + exercise.toString() + ')()}); } ' +
      'catch(error){post({kind:"idleProbe", error:error.message});} $("close").click(); };\n');
    const {stdout}=await run(path.join(avatar,'desktop/FishPet'),[root],{timeout:40000});
    const result=stdout.trim().split('\n').map(s=>JSON.parse(s)).find(m=>m.kind==='idleProbe');
    assert.deepEqual(result?.scenes,['swing','eat_rice','sleep','main','eat_rice','main','swing','main'],stdout);
  } finally { await rm(root,{recursive:true,force:true}); }
});
