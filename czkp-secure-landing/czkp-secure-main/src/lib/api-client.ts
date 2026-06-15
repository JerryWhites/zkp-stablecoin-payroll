// Backend API client for authentication and API calls
// Replaces Supabase client — includes CSRF protection

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api';
const CSRF_COOKIE_NAME = '__csrf';

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

interface AuthUser {
  id: string;
  email: string;
  role: string;
  company_id?: string;
  is_2fa_enabled?: boolean;
}

interface AuthResponse {
  success: boolean;
  user?: AuthUser;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
  requires_2fa?: boolean;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    // 🔐 FIXED: No longer restoring tokens from sessionStorage
    // Tokens are managed via httpOnly cookies set by the backend
    // The in-memory accessToken is only used as a transient fallback
  }

  /**
   * Read the CSRF token from the cookie set by the backend.
   * The cookie is httpOnly: false so JS can read it.
   */
  private getCSRFToken(): string | undefined {
    const match = document.cookie
      .split('; ')
      .find(row => row.startsWith(`${CSRF_COOKIE_NAME}=`));
    return match?.split('=')[1];
  }

  private saveTokens(accessToken: string) {
    // 🔐 FIXED: Only keep in-memory for Authorization header fallback
    // Actual auth is via httpOnly cookies set by backend
    this.accessToken = accessToken;
  }

  clearTokens() {
    this.accessToken = null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  async register(email: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Surface specific validation errors from the backend
      const errorMsg = data.details
        ? data.details.map((d: any) => d.message).join('. ')
        : data.error || 'Registration failed';
      return { success: false, error: errorMsg };
    }
    return data;
  }

  async login(email: string, password: string, totp_code?: string): Promise<AuthResponse> {
    const csrfToken = this.getCSRFToken();
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ email, password, ...(totp_code ? { totp_code } : {}) }),
    });
    const data = await res.json();
    
    if (data.success && data.accessToken) {
      this.saveTokens(data.accessToken);
    }
    
    return data;
  }

  async logout(): Promise<void> {
    try {
      if (this.accessToken) {
        const csrfToken = this.getCSRFToken();
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`,
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          credentials: 'include',
        });
      }
    } catch {
      // Ignore logout errors
    } finally {
      this.clearTokens();
    }
  }

  async refreshAuth(): Promise<boolean> {
    // Prevent concurrent refresh requests
    if (this.refreshPromise) return this.refreshPromise;
    
    this.refreshPromise = (async () => {
      try {
        // 🔐 FIXED: Rely on httpOnly cookie for refresh (no body token)
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        
        if (res.ok) {
          const data = await res.json();
          // New tokens are set via httpOnly cookies by the server
          // If server still provides accessToken in body, use it transiently
          if (data.accessToken) {
            this.saveTokens(data.accessToken);
          }
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();
    
    return this.refreshPromise;
  }

  async getMe(): Promise<AuthUser | null> {
    if (!this.accessToken) return null;
    
    try {
      const res = await this.authenticatedFetch(`${API_BASE}/auth/me`);
      if (res.ok) {
        const data = await res.json();
        return data.user;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    // If a relative path is passed (e.g. "/credits/balance"), prepend API_BASE
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;

    const headers = new Headers(options.headers || {});
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    
    // Attach CSRF token for state-changing requests
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrfToken = this.getCSRFToken();
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }
    
    let res = await fetch(fullUrl, {
      ...options,
      headers,
      credentials: 'include',
    });
    
    // If unauthorized, try refreshing via cookie
    if (res.status === 401) {
      const refreshed = await this.refreshAuth();
      if (refreshed) {
        headers.set('Authorization', `Bearer ${this.accessToken}`);
        res = await fetch(fullUrl, {
          ...options,
          headers,
          credentials: 'include',
        });
      }
    }

    // If rate limited, wait and retry once
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
      const waitMs = Math.min(retryAfter * 1000, 30_000); // cap at 30s
      await new Promise(resolve => setTimeout(resolve, waitMs));
      res = await fetch(fullUrl, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
    
    return res;
  }
}

// Singleton instance
export const apiClient = new ApiClient();
export type { AuthUser, AuthResponse, AuthTokens };
