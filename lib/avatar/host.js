import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createDesktopPet } from './desktop-host.js';
import { spokenText } from './speech-text.js';
import { actionIds, cueTool, emotionIds, parseCue } from './cues.js';
import { idleScenes, sceneExpressions } from './scenes.js';
import { readJson, updateJson } from '../json-store.js';
const folder = new URL('./', import.meta.url);
function modelFiles(manifest) {
  const { FileReferences: model } = JSON.parse(readFileSync(new URL(manifest, folder), 'utf8'));
  const resources = [model.Moc, model.DisplayInfo, model.Physics, ...model.Textures,
    ...model.Expressions.map(e => e.File), ...Object.values(model.Motions).flat().map(m => m.File)];
  return [manifest, ...resources.filter(Boolean).map(file => path.posix.join(path.posix.dirname(manifest), file))];
}
const files = new Set([
  'panel.js',
  'controller.js',
  'actions.js',
  'scenes.js',
  'idle-rotation.js',
  'cues.js',
  'voice.js',
  'speech-text.js',
  'renderer.js',
  'core.js',
  'purism.wasm',
  'model/portrait.png',
  ...modelFiles('model/fish.model3.json'),
  ...Object.keys(idleScenes).flatMap(id => modelFiles('scenes/' + id + '/' + id + '.model3.json')),
]);
const mime = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.moc3': 'application/octet-stream',
  '.png': 'image/png',
};
function hasSamples(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return false;
  for (let i = 12; i + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(i + 4);
    if (wav.toString('ascii', i, i + 4) === 'data') return size > 0 && i + 8 + size <= wav.length;
    i += 8 + size + (size % 2);
  }
  return false;
}
export async function synthesize(text, signal) {
  if (process.platform !== 'darwin') throw new Error('本机语音朗读需要 macOS 系统语音');
  if (typeof text !== 'string' || text.length > 4096) throw new Error('朗读文本无效或过长');
  text = spokenText(text);
  if (!/[\p{L}\p{N}]/u.test(text) || Array.from(text).length > 220)
    throw new Error('请提供 1 到 220 字的朗读文本');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fish-avatar-voice-'));
  try {
    const file = path.join(dir, 'reply.wav');
    // stdin treats speech as plain text, including leading dashes. Disable Apple's embedded speech commands.
    const job = execFile(
      '/usr/bin/say',
      ['-v', 'Tingting', '-o', file, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', '-'],
      { signal, timeout: 30000 },
    );
    const done = new Promise((resolve, reject) => {
      job.once('error', reject);
      job.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error('系统语音合成失败，请检查“婷婷”中文语音是否可用')),
      );
    });
    job.stdin.on('error', () => {});
    job.stdin.end(text.replaceAll('[[', '［［'));
    await done;
    const bytes = await readFile(file);
    if (!hasSamples(bytes)) throw new Error('系统语音没有返回声音，请检查 macOS 中文语音');
    return bytes;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function registerAvatar(ctx, route, readBody, respond, directory) {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  const preferencesFile = path.join(directory, 'desktop-pet.json');
  let preferences = {};
  try {
    preferences = readJson(preferencesFile, {}) || {};
  } catch {
    // Keep manual mode available if the saved preference cannot be read.
  }
  const pet = createDesktopPet(ctx, {
    synthesize,
    desktopByDefault: preferences.desktopByDefault === true,
    rotation: preferences.rotation,
    saveDefault(value) {
      updateJson(preferencesFile, (current) => ({ ...current, desktopByDefault: value }),
        path.join(directory, 'backups'), 'desktop-pet');
    },
    saveRotation(value) {
      updateJson(preferencesFile, current => ({ ...current, rotation: value }),
        path.join(directory, 'backups'), 'desktop-pet');
    },
  });
  route('/fish-console/avatar/pet-updates', async (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: '请使用 GET' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const off = pet.observe((state) => res.write('data: ' + JSON.stringify(state) + '\n\n'));
    const close = () => res.end();
    lifetime.signal.addEventListener('abort', close, { once: true });
    res.once('close', () => {
      off();
      lifetime.signal.removeEventListener('abort', close);
    });
  });
  route('/fish-console/avatar/pet', async (req, res) => {
    if (req.method === 'GET') return respond(res, 200, pet.status());
    const data = await readBody(req);
    let state;
    if (data.action === 'open') state = await pet.open(data.sessionId, data.voice === true);
    else if (data.action === 'autoOpen') state = await pet.autoOpen(data.sessionId, data.voice === true);
    else if (data.action === 'setDefault') state = await pet.setDefault(data.sessionId, data.value, data.voice === true);
    else if (data.action === 'setRotation') state = pet.setRotation(data.value);
    else if (data.action === 'close') state = pet.close(data.sessionId, data.generation);
    else if (data.action === 'listen') state = pet.listen(data.sessionId, data.generation, data.value === true);
    else return respond(res, 400, { ok: false, error: '未知的桌宠操作' });
    respond(res, 200, state);
  });
  let voices = 0;
  if (typeof ctx.tools?.register === 'function')
    ctx.effect(() =>
      ctx.tools.register({
        name: cueTool,
        description: '可选。向当前会话的小肥鱼表达情绪、做一次动作或展示简短进度。idleScene 在本轮回复及朗读结束后播放一轮，可搭配 idleExpression。睡觉搭配 closed。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            emotion: { type: 'string', enum: emotionIds },
            action: { type: 'string', enum: actionIds },
            idleScene: { type: 'string', enum: Object.keys(idleScenes) },
            idleExpression: { type: 'string', enum: Object.keys(sceneExpressions) },
            progress: { type: 'string', maxLength: 100 },
          },
        },
        output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: '角色提示已收到。' }] },
        isConcurrencySafe: () => true,
        execute(args, exec) {
          const cue = parseCue(args);
          if (!cue || !exec.agent?.session) throw new Error('角色提示需要有效的会话和语义状态');
          exec.signal?.throwIfAborted();
          exec.agent.session.append('fish-avatar/cue', {
            turn: exec.agent.phase?.turn,
            ...Object.fromEntries(Object.entries(cue).filter(([, v]) => v !== undefined)),
          });
          return true;
        },
      }),
    );
  for (const file of files)
    route('/fish-console/avatar/' + file, async (req, res) => {
      if (req.method !== 'GET') return respond(res, 405, { ok: false, error: '请使用 GET' });
      const bytes = await readFile(fileURLToPath(new URL(file, folder)));
      res.writeHead(200, {
        'content-type': mime[path.extname(file)],
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      res.end(bytes);
    });
  route('/fish-console/avatar/speech', async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { ok: false, error: '请使用 POST' });
    if (voices >= 3) return respond(res, 429, { ok: false, error: '语音合成繁忙，请稍后重试' });
    const aborted = new AbortController(),
      close = () => aborted.abort();
    res.once('close', close);
    voices++;
    try {
      const body = await readBody(req);
      const silenced = () => body.sessionId && pet.status().sessionId === body.sessionId;
      if (silenced()) {
        res.writeHead(204);
        res.end();
        return;
      }
      const bytes = await synthesize(body.text, AbortSignal.any([lifetime.signal, aborted.signal]));
      if (!res.destroyed && silenced()) {
        res.writeHead(204);
        res.end();
        return;
      }
      if (!res.destroyed) {
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' });
        res.end(bytes);
      }
    } catch (error) {
      if (!res.destroyed) return respond(res, 422, { ok: false, error: error.message });
    } finally {
      voices--;
      res.off('close', close);
    }
  });
}
