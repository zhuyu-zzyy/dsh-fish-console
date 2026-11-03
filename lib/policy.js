import { workspacePath } from './paths.js';
import { roleSections } from './roles.js';
import { protectedTool } from './tool-rules.js';

export function disabledForWorkspace(config, workspace) {
  return config.toolPolicies.find(policy => policy.workspace === workspacePath(workspace))?.disabledTools || [];
}
export function deniedTool(name, config, workspace) {
  return !protectedTool(name) && disabledForWorkspace(config, workspace).includes(name);
}
export function applyAssembly(assembly, config, descriptor, resolution, personal) {
  const retained = assembly.sections.filter(s => !['fish-console.persona', 'fish-console.identity', 'fish-console.private'].includes(s.name));
  const sections = resolution.status === 'bound'
    ? [...retained, ...roleSections(resolution.role), ...(personal?.sections || [])]
    : retained;
  const tools = assembly.tools.filter(t => !deniedTool(t.name, config, descriptor.workspace));
  return { ...assembly, sections, tools };
}
