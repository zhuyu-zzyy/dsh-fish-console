import { parseCue } from './cues.js';

// Semantic events never give the Agent direct access to model parameters.
export const labels = {
  IDLE: '待机',
  LISTENING: '倾听',
  THINKING: '思考中',
  TOOL_CALLING: '正在调用工具',
  SPEAKING: '回答中',
  ERROR: '遇到问题',
};
export function inferEmotion(text) {
  if (/难过|遗憾|伤心|失落|心疼|抱歉|sad\b/i.test(text)) return 'sad';
  if (/不确定|没明白|困惑|弄不清|疑惑|confus/i.test(text)) return 'confused';
  if (/没想到|竟然|居然|哇[！!，]|惊讶|天哪|surpris/i.test(text)) return 'surprised';
  if (/太好了|开心|高兴|喜欢|谢谢|好耶|真棒|恭喜|完成啦|😊|🎉|happy\b/i.test(text)) return 'happy';
  if (/[？?]|好奇|想知道|curious/i.test(text)) return 'curious';
  if (/我想想|让我想|我在考虑|需要分析/i.test(text)) return 'thinking';
  return 'neutral';
}
const visibleText = (message) =>
  Array.isArray(message?.content)
    ? message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
    : '';
export function createController({ publish, speak, cancel, now = () => performance.now() }) {
  let turn,
    active = false,
    mic = false,
    audio = false,
    error = false,
    caption = '',
    emotion = 'neutral',
    state = '',
    since = now(),
    revision = 0,
    last = 0;
  let attempt,
    partial = '',
    committed = '',
    liveUntil = 0,
    listenUntil = 0,
    previousSeq = -1;
  let idleCue, explicitEmotion = '',
    gesture = null,
    progress = '';
  const tools = new Map();
  let ambient = { count: 0, tools: [], progress: '' };
  const update = () => {
    const next = error
      ? 'ERROR'
      : mic || listenUntil > now()
        ? 'LISTENING'
        : tools.size || ambient.tools.length
          ? 'TOOL_CALLING'
          : audio || liveUntil > now()
            ? 'SPEAKING'
            : active || ambient.count
              ? 'THINKING'
              : 'IDLE';
    if (next !== state) {
      state = next;
      since = now();
      revision++;
    }
    publish({
      state,
      emotion: state === 'ERROR' ? 'confused' : explicitEmotion || (state === 'THINKING' ? 'thinking' : emotion),
      tool: [...new Set([...tools.values(), ...ambient.tools])].join('、'),
      caption,
      progress: progress || ambient.progress,
    });
  };
  function clear() {
    cancel();
    audio = false;
    active = false;
    error = false;
    liveUntil = 0;
    listenUntil = 0;
    attempt = undefined;
    partial = '';
    committed = '';
    tools.clear();
    emotion = 'neutral';
    explicitEmotion = '';
    idleCue = undefined;
    gesture = null;
    progress = '';
    caption = '';
  }
  function settleAttempt(id) {
    if (attempt === id && committed !== id) {
      partial = '';
      caption = '';
      liveUntil = 0;
      emotion = 'neutral';
    }
    if (attempt === id) attempt = undefined;
    update();
  }
  function event(e) {
    if (!e || !e.data || e.seq <= previousSeq) return;
    previousSeq = e.seq;
    const d = e.data;
    if (e.type === 'agent/inbox/spliced' && d.inserted?.some((m) => m.source?.kind === 'user')) {
      cancel();
      idleCue = undefined;
      error = false;
      listenUntil = now() + 240;
    } else if (e.type === 'turn/start') {
      const until = listenUntil;
      clear();
      listenUntil = until;
      turn = d.turn;
      active = true;
    } else if (d.turn !== undefined && turn !== undefined && d.turn !== turn) return;
    else if (e.type === 'step/start') {
      active = true;
      liveUntil = 0;
    } else if (e.type === 'tool/call') {
      tools.set(d.callId, d.name);
      active = true;
      liveUntil = 0;
      listenUntil = 0;
    } else if (e.type === 'tool/result') tools.delete(d.message?.toolCallId ?? d.message?.source?.callId);
    else if (e.type === 'fish-avatar/cue') {
      const cue = parseCue({ emotion: d.emotion, action: d.action, progress: d.progress, idleScene: d.idleScene, idleExpression: d.idleExpression });
      if (!cue) return;
      if (cue.emotion) explicitEmotion = cue.emotion;
      if (cue.idleScene) idleCue = { scene: cue.idleScene, expression: cue.idleExpression };
      if (cue.action) gesture = { id: cue.action, at: now() };
      if (cue.progress) {
        progress = cue.progress;
        if (!mic) speak(progress);
      }
    } else if (e.type === 'assistant/settle') {
      return settleAttempt(d.attemptId);
    } else if (e.type === 'assistant/live-chunk') {
      if (d.chunk?.type !== 'text-delta') return;
      if (attempt !== d.attemptId) {
        attempt = d.attemptId;
        partial = '';
        committed = '';
      }
      partial = (partial + (d.chunk.text || '')).slice(-180);
      caption = partial;
      emotion = inferEmotion(caption);
      active = true;
      liveUntil = now() + 750;
    } else if (e.type === 'assistant/message') {
      if (d.interrupted || (e.surfaceOp && e.surfaceOp !== 'append')) {
        partial = '';
        liveUntil = 0;
        return update();
      }
      const text = visibleText(d.message).trim();
      if (text) {
        caption = text.slice(-180);
        emotion = inferEmotion(caption);
        liveUntil = now() + Math.min(4200, Math.max(800, text.length * 85));
        if (!mic) speak(text);
      }
      committed = attempt;
      partial = '';
    } else if (e.type === 'turn/end') {
      active = false;
      tools.clear();
      if (['aborted', 'error', 'blocked'].includes(d.reason?.kind)) {
        clear();
        error = d.reason.kind === 'error';
      }
    } else return;
    update();
  }
  function watch(feed, running = false) {
    active = running;
    update();
    if (!feed) return () => {};
    // A replaced history window may contain an in-flight tool. Reconstruct only current
    // activity, never play assistant text or cues from an initial/reconnected window.
    function rebase(snap, runningHint) {
      clear();
      turn = undefined;
      const entries = snap.entries || [];
      previousSeq = entries.at(-1)?.event?.seq ?? -1;
      let start = entries.length - 1;
      while (start >= 0 && !['turn/start', 'turn/end'].includes(entries[start].event.type)) start--;
      active = start >= 0 ? entries[start].event.type === 'turn/start' : runningHint;
      if (active) {
        turn = start >= 0 ? entries[start].event.data.turn : undefined;
        for (let i = start + 1; i < entries.length; i++) {
          const e = entries[i].event;
          if (e.type === 'tool/call') tools.set(e.data.callId, e.data.name);
          if (e.type === 'tool/result') tools.delete(e.data.message?.toolCallId ?? e.data.message?.source?.callId);
        }
      }
      update();
    }
    const initial = feed.getSnapshot();
    let revision = initial.revision;
    rebase(initial, running);
    return feed.subscribe(() => {
      const snap = feed.getSnapshot();
      if (snap.revision === revision) return;
      revision = snap.revision;
      const change = snap.change;
      if (change.kind === 'replace') {
        rebase(snap, false);
        return;
      }
      if (change.kind === 'append') for (const entry of change.entries) event(entry.event);
      if (change.kind === 'settle-assistant') {
        if (change.entry) event(change.entry.event);
        settleAttempt(change.attemptId);
      }
    });
  }
  return {
    event,
    watch,
    ambient(value) {
      ambient = { count: Math.max(0, Number(value?.count) || 0),
        tools: Array.isArray(value?.tools) ? value.tools.filter(name => typeof name === 'string') : [],
        progress: typeof value?.progress === 'string' ? value.progress : '' };
      update();
    },
    reset() {
      clear();
      turn = undefined;
      previousSeq = -1;
      mic = false;
      revision++;
      since = now();
      update();
    },
    listen(value) {
      if (mic === value) return;
      mic = value;
      if (value) {
        cancel();
        idleCue = undefined;
        audio = false;
        liveUntil = 0;
      }
      update();
    },
    playback(value) {
      if (value === audio) return;
      audio = value;
      if (!value) liveUntil = 0;
      update();
    },
    tick() {
      if ((liveUntil && liveUntil <= now()) || (listenUntil && listenUntil <= now())) {
        if (liveUntil <= now()) liveUntil = 0;
        if (listenUntil <= now()) listenUntil = 0;
        update();
      }
    },
    activity() {
      this.tick();
      return { state, since, revision, idleCue };
    },
    pose(time) {
      this.tick();
      const dt = Math.min(0.05, Math.max(0, (time - last) / 1000));
      last = time;
      return { state, since, emotion: explicitEmotion || emotion, explicitEmotion, gesture, dt };
    },
  };
}
export { poseDriver } from './actions.js';
