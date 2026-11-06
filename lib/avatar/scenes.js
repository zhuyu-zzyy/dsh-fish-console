import { createPlayer, sampleCurve } from './actions.js';
import { idleRotation } from './idle-rotation.js';

export const idleScenes = {
  swing: { label: '荡秋千', expression: 'happy', still: 1 },
  eat_rice: { label: '吃白米饭', expression: 'content', still: 37 / 30 },
  sleep: { label: '躺床睡觉', expression: 'closed', still: 0 },
};
export const sceneExpressions = { happy: '开心', innocent: '呆萌', content: '满足', drowsy: '困倦', closed: '闭眼' };

function automaticScene(ms, hour, rotation, elapsed = ms - 20000, first = 'swing') {
  if (ms < 20000) return 'main';
  if (ms >= 120000 && (hour >= 22 || hour < 6)) return 'sleep';
  const second = first === 'swing' ? 'eat_rice' : 'swing';
  const cycle = (rotation[first] + rotation[second]) * 1000;
  return Math.max(0, elapsed) % cycle < rotation[first] * 1000 ? first : second;
}

// Expressions are applied to the current motion pose afresh every frame. Changing an expression
// during a fade starts from the weights that were actually on screen.
function expressionMixer() {
  let previous = {}, weights = {}, target, since;
  return (pose, definitions, wanted, time) => {
    if (wanted !== target) {
      previous = weights;
      target = wanted;
      since = time;
    }
    weights = {};
    for (const [name, expression] of Object.entries(definitions)) {
      const active = wanted === name;
      const duration = active ? expression.FadeInTime : expression.FadeOutTime;
      const u = duration > 0 ? Math.min(1, (time - since) / (duration * 1000)) : 1;
      const eased = (1 - Math.cos(Math.PI * Math.max(0, u))) / 2;
      const weight = (previous[name] || 0) * (1 - eased) + (active ? eased : 0);
      weights[name] = weight;
      if (!weight) continue;
      for (const { Id, Value, Blend } of expression.Parameters) {
        if (!(Id in pose)) continue;
        if (Blend === 'Multiply') pose[Id] *= 1 + (Value - 1) * weight;
        else if (Blend === 'Overwrite') pose[Id] += (Value - pose[Id]) * weight;
        else pose[Id] += Value * weight;
      }
    }
  };
}

export function createAvatarPlayer(controller, mouth, reduced = false, options = {}) {
  const chat = createPlayer(controller, mouth, reduced);
  const now = options.now || (() => performance.now());
  const hour = options.hour || (() => new Date().getHours());
  let mode = 'auto', expression = 'auto', active = 'main', started, lastInput = now();
  let once, seenCue;
  let rotation = idleRotation(options.rotation), rotationStart;
  let revision = controller.activity().revision, mix = expressionMixer();
  function setMode(value) {
    if (mode === value) return;
    mode = value;
    options.onMode?.(mode);
  }
  function wake(time = now()) {
    lastInput = time;
    rotationStart = undefined;
    once = undefined;
    seenCue = controller.activity().idleCue;
    setMode('auto');
  }
  function scene(time) {
    const status = controller.activity();
    if (status.revision !== revision) {
      revision = status.revision;
      lastInput = time;
      rotationStart = undefined;
      once = undefined;
      setMode('auto');
    }
    if (once && time >= once.until) once = undefined;
    if (status.state === 'IDLE' && mode === 'auto' && !reduced && status.idleCue && status.idleCue !== seenCue) {
      seenCue = status.idleCue;
      once = { ...seenCue, until: time + 10000, playing: false };
      if (active === once.scene) { started = undefined; mix = expressionMixer(); }
    }
    const idle = time - Math.max(lastInput, status.since);
    const next = status.state !== 'IDLE' ? 'main' : mode !== 'auto' ? mode
      : reduced ? 'main' : once?.scene || automaticScene(idle, hour(), rotation,
        rotationStart && time - rotationStart.at, rotationStart?.first);
    if (next !== active) {
      active = next;
      started = undefined;
      mix = expressionMixer();
    }
    return active;
  }
  function frame(time, assets, model = 'main') {
    if (model === 'main') return chat.frame(time, assets);
    const spec = idleScenes[model], motion = assets.motions.idle;
    started ??= time;
    if (once && !once.playing) {
      once.playing = true;
      once.until = time + motion.Meta.Duration * 1000;
    }
    const elapsed = Math.max(0, time - started) / 1000;
    let t = reduced ? spec.still : elapsed % motion.Meta.Duration;
    // Make an exact frame boundary stable across repeated modulo operations, including stepped opacity.
    const grid = Math.round(t * motion.Meta.Fps) / motion.Meta.Fps;
    if (Math.abs(t - grid) < 1e-9) t = grid % motion.Meta.Duration;
    const eye = model === 'sleep' ? 0 : 1;
    const pose = { ParamEyeLOpen: eye, ParamEyeROpen: eye, ParamEyeSmile: 0, ParamBrowLY: 0, ParamBrowRY: 0, ParamMouthForm: 0 };
    for (const curve of motion.Curves) pose[curve.Id] = sampleCurve(curve, t);
    const requested = expression === 'auto' ? once?.expression : expression;
    const chosen = requested === 'neutral' || Object.hasOwn(assets.expressions, requested) ? requested : spec.expression;
    mix(pose, assets.expressions, chosen, time);
    pose.ParamEyeLOpen = Math.max(0, Math.min(1.2, pose.ParamEyeLOpen));
    pose.ParamEyeROpen = Math.max(0, Math.min(1.2, pose.ParamEyeROpen));
    return pose;
  }
  return {
    scene, frame, wake,
    rotation(value, time = now()) {
      const next = idleRotation(value);
      if (next.swing === rotation.swing && next.eat_rice === rotation.eat_rice) return;
      const current = scene(time);
      rotation = next;
      if (mode === 'auto' && !once && (current === 'swing' || current === 'eat_rice')) {
        rotationStart = { at: time, first: current };
      }
    },
    select(value, time = now()) {
      if (value !== 'auto' && value !== 'main' && !Object.hasOwn(idleScenes, value)) return false;
      scene(time);
      if (value !== 'auto' && controller.activity().state !== 'IDLE') return false;
      wake(time);
      setMode(value);
      scene(time);
      return true;
    },
    expression(value) {
      if (value === 'auto' || value === 'neutral' || Object.hasOwn(sceneExpressions, value)) expression = value;
    },
    preview(id, time = now()) {
      if (!chat.preview(id, time)) return false;
      wake(time);
      return true;
    },
  };
}
