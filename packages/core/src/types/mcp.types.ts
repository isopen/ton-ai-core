export type Network = 'mainnet' | 'testnet';
export type WalletVersion = 'v5r1' | 'v4r2' | 'agentic';
export type TransportMode = 'stdio' | 'http' | 'https' | 'serverless';

export const NETWORK = {
  MAINNET: 'mainnet' as const,
  TESTNET: 'testnet' as const,
} as const;

export const WALLET_VERSION = {
  V5R1: 'v5r1' as const,
  V4R2: 'v4r2' as const,
  AGENTIC: 'agentic' as const,
} as const;

export const TRANSPORT_MODE = {
  STDIO: 'stdio' as const,
  HTTP: 'http' as const,
  HTTPS: 'https' as const,
  SERVERLESS: 'serverless' as const,
} as const;

export interface MCPConfig {
  mnemonic?: string;
  privateKey?: string;
  walletAddress?: string;
  network?: Network;
  apiKey?: string;
  mode?: TransportMode;
  port?: number;
  host?: string;
  walletVersion?: WalletVersion;
  protocol?: 'http' | 'https';
  debug?: boolean;
  configPath?: string;
  agenticCollectionAddress?: string;
  agenticWalletIndex?: number;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface BalanceResponse {
  ton: string;
  nano: string;
}

export interface JettonBalanceResponse {
  balance: string;
  walletAddress: string;
}

export interface JettonInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
}

export interface JettonWithBalance {
  address: string;
  balance: string;
  walletAddress: string;
  jetton: JettonInfo;
}

export interface TransactionEvent {
  type: string;
  amount?: string;
  jetton?: string;
  nft?: string;
  from?: string;
  to?: string;
  comment?: string;
}

export interface Transaction {
  eventId: string;
  timestamp: number;
  date: string;
  type: string;
  status: string;
  description?: string;
  isScam?: boolean;
  from?: string;
  to?: string;
  amount?: { ton: string; nanoTon: string };
  comment?: string;
  jettonAddress?: string;
  jettonSymbol?: string;
  jettonAmount?: string;
  dex?: string;
  amountIn?: string;
  amountOut?: string;
  hash?: string;
  lt?: string;
  events?: TransactionEvent[];
}

export interface SendTONResponse {
  hash: string;
}

export interface SendJettonResponse {
  hash: string;
}

export interface Message {
  address: string;
  amount: string;
  payload?: string;
  stateInit?: string;
}

export interface SendRawTransactionParams {
  messages: Message[];
  validUntil?: number;
  fromAddress?: string;
}

export interface SendRawTransactionResponse {
  hash: string;
}

export interface SwapQuoteParams {
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps?: number;
}

export interface SwapQuoteResponse {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  exchangeRate: string;
  fee: string;
  slippage: number;
  route: string[];
  transactionParams: {
    messages: Message[];
    validUntil?: number;
  };
}

export interface NFT {
  address: string;
  index: number;
  owner: string;
  collection?: {
    address: string;
    name: string;
  };
  metadata?: {
    name?: string;
    description?: string;
    image?: string;
  };
}

export interface SendNFTResponse {
  hash: string;
}

export interface ResolveDNSResponse {
  address: string;
}

export interface BackResolveDNSResponse {
  domain: string;
}

export interface KnownJetton {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}
