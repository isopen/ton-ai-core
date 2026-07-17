export type EngineType = 'opfs' | 'binlog';

export interface GramDbConfig {
  pbkdf2Iterations?: number;
  engineType?: EngineType;
}

export interface StoredSession {
  authKey: string;
  authKeyId: string;
  serverSalt: string;
  serverTimeOffset: number;
  dcId: number;
  authenticated: boolean;
  homeAuthKey?: string;
  homeAuthKeyId?: string;
  homeServerSalt?: string;
  homeDcId?: number;
  pendingCodeHash?: string;
  passwordPending?: boolean;
}
