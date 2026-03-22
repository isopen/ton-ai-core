export interface LevlamClawConfig {
  name?: string;
  telegram: {
    botToken: string;
    apiId: number;
    apiHash: string;
  };
  openrouter: {
    apiKey: string;
    defaultModel?: string;
  };
  tdlib?: {
    libraryPath?: string;
    databaseDirectory?: string;
    filesDirectory?: string;
  };
  allowedChats?: number[];
  adminIds?: number[];
  silentMode?: boolean;
}

export interface LevlamClawStatus {
  ready: boolean;
  botInfo: any;
  openRouterReady: boolean;
  uptime: string;
  processedMessages: number;
}
