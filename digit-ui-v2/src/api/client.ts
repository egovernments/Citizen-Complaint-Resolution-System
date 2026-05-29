// DIGIT API Client
import { OAUTH_CONFIG, ENDPOINTS } from './config';
import type {
  RequestInfo,
  UserInfo,
  LoginRequest,
  LoginResponse,
  ApiResponse,
  ApiError,
} from './types';

class DigitApiClient {
  private baseUrl: string = '';
  private authToken: string | null = null;
  private userInfo: UserInfo | null = null;
  private tenantId: string = '';

  // Initialize the client with environment URL
  setEnvironment(url: string): void {
    this.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
  }

  // Get current environment URL
  getEnvironment(): string {
    return this.baseUrl;
  }

  // Set auth token and user info
  setAuth(token: string, user: UserInfo): void {
    this.authToken = token;
    this.userInfo = user;
    this.tenantId = user.tenantId;
  }

  // Get current auth state
  getAuth(): { token: string | null; user: UserInfo | null; tenantId: string } {
    return {
      token: this.authToken,
      user: this.userInfo,
      tenantId: this.tenantId,
    };
  }

  // Check if authenticated
  isAuthenticated(): boolean {
    return this.authToken !== null && this.userInfo !== null;
  }

  // Set tenant ID (can override user's tenant)
  setTenantId(tenantId: string): void {
    this.tenantId = tenantId;
  }

  // Clear auth
  logout(): void {
    this.authToken = null;
    this.userInfo = null;
    this.tenantId = '';
  }

  // Generate message ID
  private generateMsgId(): string {
    return `${Date.now()}|en_IN`;
  }

  // Build RequestInfo wrapper
  buildRequestInfo(overrides?: Partial<RequestInfo>): RequestInfo {
    return {
      apiId: 'Rainmaker',
      ver: '1.0',
      ts: Date.now(),
      msgId: this.generateMsgId(),
      authToken: this.authToken || '',
      userInfo: this.userInfo
        ? {
            ...this.userInfo,
            tenantId: this.tenantId || this.userInfo.tenantId,
          }
        : undefined,
      ...overrides,
    };
  }

  // Login / Authenticate
  async login(request: LoginRequest): Promise<LoginResponse> {
    const { username, password, tenantId, userType = 'EMPLOYEE' } = request;

    // Build OAuth form data
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('userType', userType);
    formData.append('tenantId', tenantId);
    formData.append('scope', OAUTH_CONFIG.scope);
    formData.append('grant_type', OAUTH_CONFIG.grantType);

    // Build Basic Auth header
    const basicAuth = btoa(`${OAUTH_CONFIG.clientId}:${OAUTH_CONFIG.clientSecret}`);

    const response = await fetch(`${this.baseUrl}${ENDPOINTS.AUTH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.error_description || error.message || `Login failed: ${response.status}`
      );
    }

    const data: LoginResponse = await response.json();

    // Store auth info
    this.setAuth(data.access_token, data.UserRequest);
    this.tenantId = tenantId;

    return data;
  }

  // Generic API request method
  async request<T = unknown>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
    body?: Record<string, unknown>,
    options?: {
      headers?: Record<string, string>;
      skipAuth?: boolean;
    }
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Add auth header if we have a token
    if (this.authToken && !options?.skipAuth) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    const data = await response.json();

    // Check for API errors
    if (!response.ok || data.Errors?.length > 0) {
      const errors: ApiError[] = data.Errors || [
        {
          code: `HTTP_${response.status}`,
          message: data.message || `Request failed: ${response.status}`,
          description: data.description,
        },
      ];
      throw new ApiClientError(errors, response.status);
    }

    return data;
  }

  // POST request helper
  async post<T = unknown>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'POST', body);
  }

  // GET request helper
  async get<T = unknown>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, 'GET');
  }

  // File upload
  async uploadFile(
    file: File,
    module: string = 'default'
  ): Promise<{ fileStoreId: string; fileName: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tenantId', this.tenantId);
    formData.append('module', module);

    const response = await fetch(`${this.baseUrl}${ENDPOINTS.FILESTORE_UPLOAD}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.authToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`File upload failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      fileStoreId: data.files[0].fileStoreId,
      fileName: data.files[0].fileName,
    };
  }
}

// Custom error class for API errors
export class ApiClientError extends Error {
  public errors: ApiError[];
  public statusCode: number;

  constructor(errors: ApiError[], statusCode: number) {
    super(errors.map((e) => e.message).join(', '));
    this.name = 'ApiClientError';
    this.errors = errors;
    this.statusCode = statusCode;
  }

  // Get first error message
  get firstError(): string {
    return this.errors[0]?.message || 'Unknown error';
  }

  // Get all error messages
  get allErrors(): string[] {
    return this.errors.map((e) => e.message);
  }
}

// Export singleton instance
export const apiClient = new DigitApiClient();

// Export class for testing
export { DigitApiClient };
