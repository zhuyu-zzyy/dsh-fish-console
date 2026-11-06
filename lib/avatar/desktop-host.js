import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { canonicalRecording } from './desktop/recording.js';
import { parseCue } from './cues.js';
import { idleRotation, validateIdleRotation } from './idle-rotation.js';

const assets = fileURLToPath(new URL('./', import.meta.url));
const helper = fileURLToPath(new URL('./desktop/FishPet', import.meta.url));
const fault = (message, status = 400) => Object.assign(new Error(message), { httpStatus: status });
function checkSession(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 256) throw fault('请先打开一个 DSH 聊天。');
}

// Project just the fields consumed by the avatar. Tool payloads, attachments and private reasoning never cross the pipe.
export function petEvent(e) {
  const d = e?.data;
  if (!d) return;
  let data;
  switch (e.type) {
    case 'turn/start':
    case 'step/start':
      data = { turn: d.turn };
      break;
    case 'turn/end':
      data = { turn: d.turn, reason: { kind: d.reason?.kind } };
      break;
    case 'tool/call':
      data = { turn: d.turn, callId: d.callId, name: d.name };
      break;
    case 'tool/result':
      data = { turn: d.turn, message: { toolCallId: d.message?.toolCallId ?? d.message?.source?.callId } };
      break;
    case 'agent/inbox/spliced':
      if (!d.inserted?.some((m) => m.source?.kind === 'user')) return;
      data = { inserted: [{ source: { kind: 'user' } }] };
      break;
    case 'assistant/message': {
      const parts = d.message?.content;
      if (!Array.isArray(parts)) return;
      data = {
        turn: d.turn,
        interrupted: d.interrupted,
        message: {
          content: parts
            .filter((b) => b?.type === 'text' && typeof b.text === 'string')
            .map((b) => ({ type: 'text', text: b.text })),
        },
      };
      break;
    }
    case 'fish-avatar/cue': {
      const cue = parseCue({ emotion: d.emotion, action: d.action, progress: d.progress, idleScene: d.idleScene, idleExpression: d.idleExpression });
      if (!cue) return;
      data = { turn: d.turn, ...cue };
      break;
    }
    default:
      return;
  }
  return { type: e.type, data, ...(e.surfaceOp ? { surfaceOp: e.surfaceOp } : {}) };
}
// Reopen on current activity only. A finished message must never be spoken again when detaching or reconnecting.
function currentActivity(session) {
  if (!session?.snapshotEvents) return { active: false, tools: [] };
  const seen = new Set(),
    tools = [];
  let end = session.seq;
  while (end > 0) {
    const start = Math.max(0, end - 64),
      events = session.snapshotEvents(start, end);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i],
        d = e.data;
      if (e.type === 'turn/end') return { active: false, tools: [] };
      if (e.type === 'turn/start') return { active: true, turn: d.turn, tools: tools.reverse() };
      if (e.type === 'tool/result') seen.add(d.message?.toolCallId ?? d.message?.source?.callId);
      if (e.type === 'tool/call' && !seen.has(d.callId)) {
        seen.add(d.callId);
        tools.push({ turn: d.turn, callId: d.callId, name: d.name });
      }
    }
    end = start;
  }
  return { active: false, tools: [] };
}
export function createDesktopPet(
  ctx,
  {
    synthesize,
    launch = () => spawn(helper, [assets], { stdio: ['pipe', 'pipe', 'ignore'] }),
    supported = process.platform === 'darwin',
    desktopByDefault = false,
    saveDefault,
    rotation,
    saveRotation,
  } = {},
) {
  let rotationSettings = idleRotation(rotation);
  let live,
    generation = 0,
    disposed = false,
    openedThisRun = false;
  const observers = new Set();
  const status = () => ({
    supported, sessionId: live?.id ?? null, generation, ready: !!live?.ready, desktopByDefault,
    rotation: { ...rotationSettings },
    canAutoOpen: supported && desktopByDefault && !openedThisRun && !disposed,
  });
  const broadcast = () => {
    for (const cb of observers) cb(status());
  };
  function write(p, msg) {
    if (live !== p || p.child.stdin.destroyed || !p.child.stdin.writable) return;
    if (p.child.stdin.writableLength > 8 * 1024 * 1024) {
      end(p, new Error('桌宠窗口未响应'));
      return;
    }
    p.child.stdin.write(JSON.stringify(msg) + '\n');
  }
  function send(p, kind, value = {}) {
    write(p, { kind, generation: p.generation, ...value });
  }
  function sessionFor(id) {
    return ctx.agents?.get(id)?.session ?? ctx.get?.('sessions')?.get(id);
  }
  function reset(p, id, voice) {
    p.binding?.abort();
    p.audio?.abort();
    p.binding = new AbortController();
    p.audio = null;
    p.id = id;
    p.voice = voice;
    p.generation = ++generation;
    p.dockMic = false;
    p.pending = [];
    p.snapshot = currentActivity(sessionFor(id));
    if (p.ready) bindPage(p);
    broadcast();
  }
  function bindPage(p) {
    send(p, 'bind', {
      sessionId: p.id,
      voice: p.voice,
      desktopByDefault,
      rotation: rotationSettings,
      listening: p.dockMic,
      canRecord: !!ctx.get?.('speechController'),
      ...p.snapshot,
    });
    for (const event of p.pending) send(p, 'event', { event });
    p.pending = [];
  }
  function deliver(id, event) {
    const p = live;
    if (!p || p.id !== id || !event) return;
    if (p.ready) send(p, 'event', { event });
    else if (p.pending.length < 256) p.pending.push(event);
    else {
      p.snapshot = currentActivity(sessionFor(id));
      p.pending = [];
    }
  }
  function end(p, error) {
    if (live !== p) return;
    live = null;
    p.binding?.abort();
    p.audio?.abort();
    clearTimeout(p.timer);
    p.reject(error ?? new Error('桌宠窗口已关闭'));
    p.child.stdin.end();
    p.child.kill();
    broadcast();
  }
  async function input(p, m) {
    if (p !== live) return;
    if (m.kind === 'error') {
      end(p, new Error(m.message || '桌宠无法渲染'));
      return;
    }
    if (m.kind === 'ready') {
      if (!p.ready) {
        p.ready = true;
        clearTimeout(p.timer);
        bindPage(p);
        p.resolve();
        broadcast();
      }
      return;
    }
    if (!p.ready || m.generation !== p.generation || typeof m.id !== 'string') return;
    const epoch = p.generation,
      signal = p.binding.signal;
    const reply = (kind, body) => {
      if (live === p && epoch === p.generation) send(p, kind, { id: m.id, ...body });
    };
    if (m.kind === 'setDefault') {
      try {
        setDefault(p.id, m.value);
      } catch (error) {
        reply('defaultMode', { value: desktopByDefault, error: error.message });
      }
      return;
    }
    if (m.kind === 'setRotation') {
      try {
        setRotation(m.value);
        reply('rotationSaved', { value: rotationSettings });
      } catch (error) {
        reply('rotationSaved', { value: rotationSettings, error: error.message });
      }
      return;
    }
    if (m.kind === 'cancelSpeech') {
      if (p.audio?.id === m.id) p.audio.abort();
      return;
    }
    if (m.kind === 'speech') {
      p.audio?.abort();
      const job = new AbortController(),
        task = { id: m.id, abort: () => job.abort() };
      p.audio = task;
      try {
        const bytes = await synthesize(m.text, AbortSignal.any([job.signal, signal]));
        if (!job.signal.aborted) reply('speechResult', { audio: bytes.toString('base64') });
      } catch (e) {
        if (!job.signal.aborted && !signal.aborted) reply('speechResult', { error: e.message });
      } finally {
        if (p.audio === task) p.audio = null;
      }
      return;
    }
    if (m.kind === 'send') {
      try {
        if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 4000)
          throw new Error('请输入 1 到 4000 字');
        const api = ctx.get?.('sessionController');
        if (!api?.prompt) throw new Error('当前 DSH 未提供会话输入，请在原聊天中发送。');
        await api.prompt(
          {
            sessionId: p.id,
            requestId: randomUUID(),
            mode: 'followup',
            content: [{ type: 'text', text: m.text.trim() }],
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          signal,
        );
        reply('sent', { text: m.text });
      } catch (e) {
        reply('sent', { error: e.message });
      }
      return;
    }
    if (m.kind === 'recorded') {
      try {
        const audioBase64 = canonicalRecording(m.audio);
        const api = ctx.get?.('speechController');
        if (!api?.transcribe) throw new Error('请在 DSH 启用中文语音输入。');
        const result = await api.transcribe(
          { audioBase64, providerId: 'sensevoice-local', language: 'zh' },
          signal,
        );
        reply('transcript', { text: result.text });
      } catch (e) {
        const msg = String(e.message || '');
        reply('transcript', {
          error: /prepare the local speech provider|speech provider is unavailable/i.test(msg)
            ? '请先在 DSH 聊天输入框的麦克风菜单中准备本地中文语音模型，再回来录音。'
            : msg || '本地语音转写失败，请重试。',
        });
      }
    }
  }
  async function open(id, voice = false) {
    if (!supported) throw fault('桌宠窗口目前支持 macOS。', 422);
    checkSession(id);
    if (disposed) throw fault('插件正在关闭，请重新打开 DSH。', 503);
    if (live) {
      const p = live;
      if (p.id !== id) reset(p, id, voice);
      if (p.ready) send(p, 'front');
      await p.started;
      return status();
    }
    openedThisRun = true;
    let child;
    try {
      child = launch();
    } catch (error) {
      broadcast();
      throw error;
    }
    const p = { child, ready: false };
    live = p;
    p.started = new Promise((resolve, reject) => {
      p.resolve = resolve;
      p.reject = reject;
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m && typeof m === 'object') void input(p, m).catch((e) => end(p, e));
    });
    child.stdin.on('error', (e) => end(p, e));
    child.once('error', (e) => end(p, e));
    child.once('exit', () => end(p, new Error('桌宠进程已结束')));
    p.timer = setTimeout(() => end(p, new Error('桌宠启动超时，请检查 macOS 窗口和 WebGL 是否可用。')), 20_000);
    p.timer.unref?.();
    reset(p, id, voice);
    await p.started;
    return status();
  }
  function setDefault(id, value, voice) {
    if (!supported || typeof value !== 'boolean') throw fault('桌宠默认模式设置无效');
    checkSession(id);
    if (desktopByDefault !== value) saveDefault(value);
    desktopByDefault = value;
    if (value && !live) return open(id, voice);
    if (live?.ready) send(live, 'defaultMode', { value });
    broadcast();
    return status();
  }
  function setRotation(value) {
    const next = validateIdleRotation(value);
    if (next.swing !== rotationSettings.swing || next.eat_rice !== rotationSettings.eat_rice) {
      saveRotation(next);
      rotationSettings = next;
    }
    if (live?.ready) send(live, 'rotation', { value: rotationSettings });
    broadcast();
    return status();
  }
  ctx.on(
    'session/event',
    (session, event) => {
      if (live?.id === session.id) deliver(session.id, petEvent(event));
    },
    { global: true },
  );
  ctx.on(
    'agent/assistant-stream',
    ({ agent, frame }) => {
      if (live?.id !== agent.session.id) return;
      if (frame.type === 'end') {
        deliver(agent.session.id, {
          type: 'assistant/settle',
          data: { turn: frame.turn, attemptId: frame.attemptId },
        });
        return;
      }
      if (frame.type !== 'chunk' || frame.chunk?.type !== 'text-delta') return;
      deliver(agent.session.id, {
        type: 'assistant/live-chunk',
        data: {
          turn: frame.turn,
          attemptId: frame.attemptId,
          chunk: { type: 'text-delta', text: frame.chunk.text },
        },
      });
    },
    { global: true },
  );
  ctx.effect(() => () => {
    disposed = true;
    if (live) end(live);
    observers.clear();
  });
  return {
    status,
    open,
    autoOpen(id, voice) {
      // The first foreground chat claims the single window. Closing it pauses automatic opening until restart.
      return status().canAutoOpen ? open(id, voice) : status();
    },
    setDefault,
    setRotation,
    observe(cb) {
      observers.add(cb);
      cb(status());
      return () => observers.delete(cb);
    },
    close(id, epoch) {
      if (live?.id === id && live.generation === epoch) end(live);
      return status();
    },
    listen(id, epoch, value) {
      if (live?.id === id && live.generation === epoch) {
        live.dockMic = value;
        if (live.ready) send(live, 'listen', { value });
      }
      return status();
    },
  };
}
