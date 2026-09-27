import { SystemConfig } from 'src/dtos/config.dto.js';

export type AgentConfig = SystemConfig['agent'];
export type AgentProfile = AgentConfig['profiles'][number];

export const getAgentProfile = (config: AgentConfig, name: string): AgentProfile | undefined =>
  config.profiles.find((profile) => profile.name === name);

export const isAssistantEnabled = (config: AgentConfig) =>
  config.enabled && !!getAgentProfile(config, config.chatProfile);

export const isArtEnabled = (config: AgentConfig) =>
  config.enabled && !!config.artProfile && !!getAgentProfile(config, config.artProfile);
