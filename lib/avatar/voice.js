import { speechChunks } from './speech-text.js';

// Audio is synthesized locally. Read RMS from the same decoded samples that reach the speakers.
export function createVoice({
  playback,
  notice,
  sessionId,
  Audio = globalThis.AudioContext || globalThis.webkitAudioContext,
  request = fetch,
}) {
  let context,
    analyser,
    samples,
    enabled = false,
    current,
    serial = 0,
    enableEpoch = 0,
    pending = false;
  const queue = [];
  async function pump() {
    if (pending || !enabled) return;
    const id = serial;
    pending = true;
    try {
      while (enabled && id === serial && queue.length) {
        const text = queue.shift(),
          abort = new AbortController();
        current = { abort };
        const res = await request('/fish-console/avatar/speech', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, sessionId }),
          signal: abort.signal,
        });
        if (res.status === 204) continue;
        if (!res.ok) {
          const info = await res.json();
          throw new Error(info.error || '语音生成失败');
        }
        const buffer = await context.decodeAudioData(await res.arrayBuffer());
        if (!enabled || id !== serial) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(analyser);
        await new Promise((resolve, reject) => {
          current = { abort, source, finish: resolve };
          source.onended = resolve;
          try {
            source.start();
            playback(true);
          } catch (e) {
            reject(e);
          }
        });
        source.onended = null;
        source.disconnect();
        if (id === serial) playback(false);
      }
    } catch (e) {
      if (id === serial && e.name !== 'AbortError') {
        queue.length = 0;
        notice(e.message || '无法播放角色语音');
      }
    } finally {
      if (id === serial) {
        current = undefined;
        pending = false;
        playback(false);
      }
    }
  }
  function cancel() {
    serial++;
    queue.length = 0;
    pending = false;
    const job = current;
    current = undefined;
    job?.abort.abort();
    if (job?.source)
      try {
        job.source.stop();
      } catch {}
    job?.finish?.();
    playback(false);
  }
  return {
    async enable() {
      if (!Audio) throw new Error('当前窗口没有 Web Audio 播放能力');
      context ??= new Audio();
      if (!analyser) {
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        samples = new Float32Array(analyser.fftSize);
        analyser.connect(context.destination);
      }
      const attempt = ++enableEpoch;
      await context.resume();
      if (enableEpoch !== attempt) return false;
      if (context.state !== 'running') throw new Error('请再次点击开启朗读以允许音频播放');
      enabled = true;
      return true;
    },
    disable() {
      enableEpoch++;
      enabled = false;
      cancel();
    },
    cancel,
    enqueue(text) {
      if (!enabled) return;
      const chunks = speechChunks(text);
      if (!chunks.length) return;
      queue.push(...chunks);
      void pump();
    },
    level() {
      if (!enabled) return null;
      if (!current?.source) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.max(0, Math.min(1, (Math.sqrt(sum / samples.length) - 0.009) * 7));
    },
    dispose() {
      enableEpoch++;
      enabled = false;
      cancel();
      analyser?.disconnect();
      void context?.close().catch(() => {});
    },
  };
}
