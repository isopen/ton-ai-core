export interface GramDbConfig {}

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
