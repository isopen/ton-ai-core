export type Network = 'mainnet' | 'testnet';
export type WalletVersion = 'v5r1' | 'v4r2';
export type TransportMode = 'stdio' | 'http' | 'https';

export interface MCPConfig {
  mnemonic?: string;
  walletAddress?: string;
  network?: Network;
  apiKey?: string;
  mode?: TransportMode;
  port?: number;
  host?: string;
  walletVersion?: WalletVersion;
  protocol?: 'http' | 'https';
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
  hash: string;
  lt: string;
  time: number;
  events: TransactionEvent[];
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
