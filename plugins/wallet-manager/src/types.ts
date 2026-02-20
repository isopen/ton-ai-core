import { MCPConfig } from '@ton-ai/core';

export interface WalletConfig extends MCPConfig {
  autoConnect?: boolean;
  monitorInterval?: number;
  maxTransactions?: number;
}

export interface WalletInfo {
  address?: string;
  network?: string;
  isReady: boolean;
}

export interface WalletBalance {
  ton: string;
  nano: string;
  formatted: string;
}

export interface TransactionResult {
  hash: string;
  success: boolean;
}

export interface SendTONParams {
  to: string;
  amount: string;
  comment?: string;
}

export interface SendJettonParams {
  to: string;
  jettonAddress: string;
  amount: string;
  comment?: string;
}

export interface SwapQuoteParams {
  fromToken: string;
  toToken: string;
  amount: string;
  slippageBps?: number;
}

export interface SwapResult {
  hash: string;
  quote: any;
  success: boolean;
}

export interface TransactionEvent {
  hash: string;
  from: string;
  to: string;
  amount?: string;
  comment?: string;
  jetton?: string;
  nft?: string;
  timestamp: number;
  lt: string;
}

export interface TransactionHistory {
  total: number;
  byType: Record<string, number>;
  lastTransaction?: TransactionEvent;
  oldestTransaction?: TransactionEvent;
}

export interface SendTONResponse {
  hash: string;
}

export interface SendJettonResponse {
  hash: string;
}

export interface SendNFTResponse {
  hash: string;
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

export interface Message {
  address: string;
  amount: string;
  payload?: string;
  stateInit?: string;
}

export interface SendRawTransactionResponse {
  hash: string;
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
