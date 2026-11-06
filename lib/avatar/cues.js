import { idleScenes, sceneExpressions } from './scenes.js';

export const cueTool = 'fish_avatar_cue';
export const emotionIds = ['neutral', 'happy', 'curious', 'thinking', 'surprised', 'confused', 'sad'];
export const actionIds = ['nod', 'listen', 'ponder', 'blink', 'turn', 'glance'];
export function parseCue(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  if (Object.keys(args).some((k) => !['emotion', 'action', 'progress', 'idleScene', 'idleExpression'].includes(k))) return null;
  const { emotion, action, progress, idleScene, idleExpression } = args;
  if (emotion !== undefined && !emotionIds.includes(emotion)) return null;
  if (action !== undefined && !actionIds.includes(action)) return null;
  if (progress !== undefined && (typeof progress !== 'string' || progress.length > 100)) return null;
  if (idleScene !== undefined && (typeof idleScene !== 'string' || !Object.hasOwn(idleScenes, idleScene))) return null;
  if (idleExpression !== undefined && (!idleScene || typeof idleExpression !== 'string' || !Object.hasOwn(sceneExpressions, idleExpression))) return null;
  if (idleScene === 'sleep' && idleExpression && idleExpression !== 'closed') return null;
  if (!emotion && !action && !progress?.trim() && !idleScene) return null;
  return { emotion, action, progress: progress?.trim(), idleScene, idleExpression };
}
