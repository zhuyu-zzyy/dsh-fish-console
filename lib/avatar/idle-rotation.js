export const defaultIdleRotation = Object.freeze({ swing: 84, eat_rice: 36 });
export const rotationLimits = Object.freeze({ min: 5, max: 3600 });
const validSeconds = value => Number.isInteger(value) && value >= rotationLimits.min && value <= rotationLimits.max;

// Old installations and partially damaged preferences keep usable per-scene defaults.
export function idleRotation(value) {
  return Object.fromEntries(Object.entries(defaultIdleRotation).map(([id, fallback]) =>
    [id, validSeconds(value?.[id]) ? value[id] : fallback]));
}

export function validateIdleRotation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !Object.keys(defaultIdleRotation).every(id => validSeconds(value[id]))) {
    throw Object.assign(new Error('请将两个轮换时长都设为 5 到 3600 秒的整数。'), { httpStatus: 400 });
  }
  return idleRotation(value);
}
