import { apiGet, apiSend } from "../api/client";

/** Shapes of the configuration editor's API (`docs/web-interface.md`, "Configuration editor"). */
export interface ConfigFileEntry {
  id: string;
  agent: "claude" | "cursor";
  scope: "project" | "global";
  label: string;
  displayPath: string;
  isRule: boolean;
  exists: boolean;
}

export interface ConfigFileContent {
  id: string;
  exists: boolean;
  content: string;
  hash: string;
  json: boolean;
}

export interface ConfigWriteResult {
  hash: string;
  backupPath?: string;
}

export const listConfigFiles = async (): Promise<ConfigFileEntry[]> => (await apiGet<{ files: ConfigFileEntry[] }>("/api/config/files")).files;

export const readConfigFile = (id: string): Promise<ConfigFileContent> => apiGet<ConfigFileContent>(`/api/config/file?id=${encodeURIComponent(id)}`);

export const saveConfigFile = (id: string, content: string, expectedHash: string): Promise<ConfigWriteResult> =>
  apiSend<ConfigWriteResult>("PUT", "/api/config/file", { id, content, expectedHash });
