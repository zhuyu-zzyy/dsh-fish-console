// Each card uses the same motion and parameters as the live character.
export const referenceCards = [
  { id: 'front', label: '正面待机', peak: 0 },
  { id: 'blink', label: '双眼闭合', peak: 0.15 },
  { id: 'glance', label: '眼球移动与张嘴', peak: 0.66 },
  { id: 'turn', label: '小幅转头', peak: 1.06 },
];
const stateClips = {
  LISTENING: 'listen',
  THINKING: 'ponder',
  TOOL_CALLING: 'tool_wait',
  SPEAKING: 'speak',
  ERROR: 'error',
};
const rest = Object.freeze({
  ParamAngleX: 0,
  ParamAngleY: 0,
  ParamAngleZ: 0,
  ParamBodyAngleX: 0,
  ParamBreath: 0,
  ParamEyeLOpen: 1,
  ParamEyeROpen: 1,
  ParamEyeSmile: 0,
  ParamEyeBallX: 0,
  ParamEyeBallY: 0,
  ParamMouthOpenY: 0,
  ParamMouthForm: 0,
  ParamBrowLY: 0,
  ParamBrowRY: 0,
  ParamHairSwing: 0,
  ParamArmL: 0,
  ParamArmR: 0,
});
const eyelid = (id) => id === 'ParamEyeLOpen' || id === 'ParamEyeROpen';
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// Motion3 restricted Bézier segments place their control times at one and two thirds of the interval.
// The file format also permits linear and stepped tracks; endpoints hold until the next key.
export function sampleCurve(curve, seconds) {
  const s = curve.Segments;
  let t = s[0],
    v = s[1];
  if (seconds <= t) return v;
  for (let i = 2; i < s.length; ) {
    const type = s[i++],
      cubic = type === 1,
      end = s[i + (cubic ? 4 : 0)],
      next = s[i + (cubic ? 5 : 1)];
    if (seconds < end) {
      const u = clamp((seconds - t) / (end - t));
      if (cubic) {
        if (v === next && s[i + 1] === v && s[i + 3] === v) return v;
        const a = 1 - u;
        return a * a * a * v + 3 * a * a * u * s[i + 1] + 3 * a * u * u * s[i + 3] + u * u * u * next;
      }
      if (type === 2) return v;
      if (type === 3) return next;
      return v + (next - v) * u;
    }
    i += cubic ? 6 : 2;
    t = end;
    v = next;
  }
  return v;
}
function layer(pose, clip, elapsed, mode = 'all') {
  if (!clip || elapsed < 0 || (!clip.Meta.Loop && elapsed > clip.Meta.Duration)) return;
  const t = clip.Meta.Loop ? elapsed % clip.Meta.Duration : elapsed;
  for (const curve of clip.Curves) {
    const id = curve.Id;
    if (!(id in pose)) continue;
    if (mode === 'mouth-only' && id !== 'ParamMouthOpenY') continue;
    if (mode === 'no-mouth' && id === 'ParamMouthOpenY') continue;
    const v = sampleCurve(curve, t);
    if (eyelid(id)) pose[id] *= v;
    else if (id === 'ParamMouthOpenY') pose[id] = v;
    else pose[id] += v;
  }
}
export function referencePose(id, assets, seconds) {
  const card = referenceCards.find((c) => c.id === id);
  if (!card) throw new Error('未知角色动作');
  const p = { ...rest };
  if (id !== 'front') layer(p, assets.motions[id], seconds ?? card.peak);
  return p;
}
export function createPlayer(controller, mouth, reduceMotion = false) {
  let previous = { ...rest },
    preview,
    previousState,
    blinkTime,
    gestureAt,
    velocity = 0,
    swing = 0;
  const now = () => performance.now();
  function previewAction(id, t = now()) {
    const card = referenceCards.find((c) => c.id === id);
    if (!card || controller.pose(t).state !== 'IDLE') return false;
    preview = { card, at: t };
    return true;
  }
  function frame(t, assets) {
    const { state, since, emotion, explicitEmotion, gesture, dt } = controller.pose(t);
    if (state !== 'IDLE') preview = undefined;
    if (preview) {
      const { card, at } = preview,
        elapsed = Math.max(0, (t - at) / 1000),
        clip = assets.motions[card.id],
        hold = 0.92;
      const duration = (clip?.Meta.Duration ?? 0.3) + hold;
      if (elapsed <= duration) {
        // Hold the recognizable reference drawing long enough to inspect it, then play the release.
        const phase = reduceMotion ? card.peak : elapsed < card.peak ? elapsed : Math.max(card.peak, elapsed - hold);
        previous = referencePose(card.id, assets, phase);
        blinkTime = t + 3000;
        swing = 0;
        velocity = 0;
        return previous;
      }
      preview = undefined;
    }
    const age = Math.max(0, (t - since) / 1000),
      p = { ...rest };
    const em = state === 'ERROR' ? 'confused' : explicitEmotion || (state === 'THINKING' ? 'thinking' : emotion);
    for (const { Id, Value } of assets.expressions[em] || []) if (Id in p) p[Id] = Value;
    if (!reduceMotion) layer(p, assets.motions.idle, t / 1000);
    layer(p, assets.motions[stateClips[state]], age, reduceMotion ? 'mouth-only' : 'all');
    let eyeGesture = false;
    if (gesture) {
      const clip = assets.motions[gesture.id],
        elapsed = (t - gesture.at) / 1000;
      if (clip && elapsed >= 0 && elapsed <= clip.Meta.Duration) {
        eyeGesture = clip.Curves.some((c) => eyelid(c.Id));
        if (!reduceMotion || eyeGesture) layer(p, clip, elapsed, 'no-mouth');
        if (eyeGesture && gestureAt !== gesture.at) {
          blinkTime = gesture.at + clip.Meta.Duration * 1000 + 2100;
          gestureAt = gesture.at;
        }
      }
    }
    if (blinkTime === undefined) blinkTime = t + 2900;
    if (!reduceMotion && !eyeGesture && t >= blinkTime) {
      const elapsed = (t - blinkTime) / 1000,
        clip = assets.motions.blink;
      if (clip && elapsed <= clip.Meta.Duration) layer(p, clip, elapsed);
      else blinkTime = t + 3000 + Math.random() * 2200;
    }
    if (state === 'SPEAKING') {
      const level = mouth();
      if (Number.isFinite(level)) p.ParamMouthOpenY = clamp(level);
    } else p.ParamMouthOpenY = 0;
    if (!reduceMotion) {
      const phys = assets.physics,
        tip = phys.Vertices.at(-1),
        out = phys.Output[0];
      const input = phys.Input.reduce(
        (sum, v) => sum + ((p[v.Source.Id] || 0) * v.Weight * (v.Reflect ? -1 : 1)) / 100,
        0,
      );
      const target = (input * out.Scale * (out.Reflect ? -1 : 1) * out.Weight) / 100;
      velocity += ((target - swing) * 42 - velocity * (6 + tip.Mobility * 2)) * dt;
      swing += velocity * dt;
      p.ParamHairSwing = clamp(swing, -1, 1);
    }
    const mix = 1 - Math.exp(-dt * 13);
    // Gaze, head and emotion ease from the current pose across state changes. Eyelid timing and the audio
    // envelope are already authored in real time and must reach full contact or silence in the same frame.
    for (const id of Object.keys(p)) {
      if (!eyelid(id) && id !== 'ParamMouthOpenY' && previousState !== undefined)
        p[id] = previous[id] + (p[id] - previous[id]) * mix;
    }
    p.ParamEyeLOpen = clamp(p.ParamEyeLOpen, 0, 1.2);
    p.ParamEyeROpen = clamp(p.ParamEyeROpen, 0, 1.2);
    p.ParamEyeBallX = clamp(p.ParamEyeBallX, -1, 1);
    p.ParamEyeBallY = clamp(p.ParamEyeBallY, -1, 1);
    previousState = state;
    previous = p;
    return p;
  }
  return { frame, preview: previewAction, cancelPreview() { preview = undefined; } };
}
export function poseDriver(controller, mouth, reduceMotion = false) {
  return createPlayer(controller, mouth, reduceMotion).frame;
}
