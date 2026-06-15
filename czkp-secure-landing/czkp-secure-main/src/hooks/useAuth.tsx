import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { apiClient, AuthUser } from "@/lib/api-client";

// Minimal session shape for compatibility with useCredits and other hooks
interface Session {
  user: AuthUser;
  access_token: string;
}

interface AuthContextType {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string, totp_code?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    const checkSession = async () => {
      try {
        const me = await apiClient.getMe();
        if (me) {
          setUser(me);
          setSession({ user: me, access_token: apiClient.getAccessToken() || '' });
        }
      } catch {
        // No valid session
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const signUp = async (email: string, password: string) => {
    try {
      const res = await apiClient.register(email, password);
      if (res.success) {
        // Auto-login after registration
        return signIn(email, password);
      }
      return { error: new Error(res.error || 'Registration failed') };
    } catch (err: any) {
      return { error: new Error(err.message || 'Registration failed') };
    }
  };

  const signIn = async (email: string, password: string, totp_code?: string) => {
    try {
      const res = await apiClient.login(email, password, totp_code);
      if (res.success && res.user) {
        setUser(res.user);
        setSession({ user: res.user, access_token: res.accessToken || '' });
        return { error: null };
      }
      if (res.requires_2fa) {
        return { error: new Error('2FA_REQUIRED') };
      }
      return { error: new Error(res.error || 'Login failed') };
    } catch (err: any) {
      return { error: new Error(err.message || 'Login failed') };
    }
  };

  const signOut = async () => {
    await apiClient.logout();
    setUser(null);
    setSession(null);
  };

  const refreshMe = async () => {
    try {
      const me = await apiClient.getMe();
      if (me) {
        setUser(me);
        setSession({ user: me, access_token: apiClient.getAccessToken() || '' });
      }
    } catch {
      // Silently fail — user state stays as-is
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
