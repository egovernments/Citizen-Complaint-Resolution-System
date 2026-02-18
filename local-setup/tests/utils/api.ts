import { config } from './config';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = config.baseUrl) {
    this.baseUrl = baseUrl;
  }

  private buildUrl(port: number, path: string): string {
    return `${this.baseUrl}:${port}${path}`;
  }

  async request<T = unknown>(
    port: number,
    path: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const { method = 'GET', headers = {}, body, timeout = 10000 } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.buildUrl(port, path), {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      return {
        ok: response.ok,
        status: response.status,
        data: data as T,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async get<T = unknown>(port: number, path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(port, path, { ...options, method: 'GET' });
  }

  async post<T = unknown>(port: number, path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(port, path, { ...options, method: 'POST', body });
  }

  // Health check helper
  async healthCheck(port: number, path: string): Promise<boolean> {
    try {
      const response = await this.get(port, path);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// Standard RequestInfo for DIGIT APIs
export function createRequestInfo(options: {
  authToken?: string;
  userInfo?: {
    uuid: string;
    type: string;
    tenantId: string;
  };
} = {}) {
  return {
    apiId: 'Rainmaker',
    ver: '.01',
    ts: Date.now(),
    action: '_create',
    msgId: `test-${Date.now()}`,
    ...(options.authToken && { authToken: options.authToken }),
    ...(options.userInfo && { userInfo: options.userInfo }),
  };
}

export const api = new ApiClient();
export { ApiClient, ApiResponse };
