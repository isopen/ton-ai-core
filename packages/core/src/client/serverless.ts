import { MCPClient, Logger } from './mcp-client';
import { MCPConfig, NETWORK } from '../types/mcp.types';

export interface ServerlessRequest {
  headers?: Record<string, string>;
  body?: string;
  method?: string;
  path?: string;
}

export interface ServerlessResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface ServerlessHandler {
  (request: ServerlessRequest): Promise<ServerlessResponse>;
}

function extractConfigFromHeaders(headers: Record<string, string> = {}): MCPConfig {
  const config: MCPConfig = {
    mode: 'stdio',
    network: (headers['network'] as any) || NETWORK.MAINNET,
  };

  if (headers['private_key']) {
    config.privateKey = headers['private_key'];
  } else if (headers['mnemonic']) {
    config.mnemonic = headers['mnemonic'];
  }

  if (headers['toncenter_api_key']) {
    config.apiKey = headers['toncenter_api_key'];
  }

  if (headers['wallet_version']) {
    config.walletVersion = headers['wallet_version'] as any;
  }

  if (headers['agentic_collection_address']) {
    config.agenticCollectionAddress = headers['agentic_collection_address'];
  }

  return config;
}

export function createServerlessHandler(customLogger?: Logger): ServerlessHandler {
  let client: MCPClient | null = null;

  return async (request: ServerlessRequest): Promise<ServerlessResponse> => {
    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, mnemonic, private_key, network, toncenter_api_key, wallet_version',
    };

    if (request.method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    try {
      const config = extractConfigFromHeaders(request.headers);
      client = new MCPClient(config, customLogger);
      await client.initialize();

      const body = request.body ? JSON.parse(request.body) : {};
      const { method, params = {} } = body;

      if (!method) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing method' }),
        };
      }

      const result = await (client as any).request(method, params);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ result }),
      };
    } catch (error: any) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: error.message || 'Internal server error' }),
      };
    } finally {
      if (client) {
        await client.close();
        client = null;
      }
    }
  };
}
