import { roleSections } from './roles.js';

export function applyAssembly(assembly, resolution, personal) {
  const retained = assembly.sections.filter(s => !['fish-console.persona', 'fish-console.identity', 'fish-console.private', 'fish-console.tools'].includes(s.name));
  const sections = resolution.status === 'bound'
    ? [...retained, ...roleSections(resolution.role), ...(personal?.sections || [])]
    : retained;
  return { ...assembly, sections };
}
