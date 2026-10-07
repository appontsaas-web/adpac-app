// The AdPac agent roster (names/titles match the website pricing section).
// Avatars are served from the marketing site: adpac.to/images/agents/<key>.jpg
export const AGENTS = {
  jack: { name: 'Jack', title: 'Restaurants & Cafés' },
  sara: { name: 'Sara', title: 'Clinics, Beauty & Wellness' },
  adam: { name: 'Adam', title: 'Real Estate & Developers' },
  lina: { name: 'Lina', title: 'Retail & E-commerce' },
  karim: { name: 'Karim', title: 'Multi-platform Director' },
  maya: { name: 'Maya', title: 'Custom agent, built around you' },
} as const;

export type AgentKey = keyof typeof AGENTS;

export function isAgentKey(k: unknown): k is AgentKey {
  return typeof k === 'string' && k in AGENTS;
}

export function agentAvatar(key: AgentKey): string {
  return `https://adpac.to/images/agents/${key}.jpg`;
}
