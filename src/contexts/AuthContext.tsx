import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type AppRole = Database['public']['Enums']['app_role'];
type Profile = Database['public']['Tables']['profiles']['Row'];

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  isLoading: boolean;
  isHost: boolean;
  isAdmin: boolean;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileData) {
      setProfile(profileData);
    }
  };

  const fetchRoles = async (userId: string) => {
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (rolesData) {
      setRoles(rolesData.map((r) => r.role));
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
      await fetchRoles(user.id);
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          setTimeout(async () => {
            await fetchProfile(currentSession.user.id);
            await fetchRoles(currentSession.user.id);

            // Check suspension on auth state change
            const { data: pData } = await supabase
              .from('profiles')
              .select('is_suspended, suspended_reason')
              .eq('user_id', currentSession.user.id)
              .single();
            if (pData && (pData as any).is_suspended) {
              const reason = (pData as any).suspended_reason || 'Your account has been suspended.';
              await supabase.auth.signOut();
              setUser(null);
              setSession(null);
              setProfile(null);
              setRoles([]);
              window.location.href = `/suspended?reason=${encodeURIComponent(reason)}`;
            }
          }, 0);
        } else {
          setProfile(null);
          setRoles([]);
        }
        setIsLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        fetchProfile(currentSession.user.id);
        fetchRoles(currentSession.user.id);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName: string, phone?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone: phone || null },
        emailRedirectTo: window.location.origin,
      },
    });

    // Persist phone to profile immediately so it's available even if the
    // handle_new_user trigger ignores user_metadata.phone.
    if (!error && data?.user && phone) {
      await supabase
        .from('profiles')
        .upsert(
          { user_id: data.user.id, email, full_name: fullName, phone },
          { onConflict: 'user_id' },
        );
    }

    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error };

    // Check if user is suspended
    if (data.user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('is_suspended, suspended_reason')
        .eq('user_id', data.user.id)
        .single();

      if (profileData && (profileData as any).is_suspended) {
        await supabase.auth.signOut();
        const reason = (profileData as any).suspended_reason || 'Your account has been suspended.';
        return { error: new Error(`Account suspended: ${reason}`) };
      }
    }

    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
  };

  const isHost = roles.includes('host') || profile?.is_host === true;
  const isAdmin = roles.includes('admin') || roles.includes('superadmin' as AppRole);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        isLoading,
        isHost,
        isAdmin,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // During Vite HMR the AuthContext module can be replaced while child
    // components still hold the previous reference, briefly yielding `undefined`.
    // In dev we warn and return a safe placeholder so the screen doesn't blank;
    // in prod we still throw because it indicates a real provider misconfiguration.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('useAuth: context missing (likely HMR). Returning placeholder.');
      return {
        user: null,
        session: null,
        profile: null,
        roles: [],
        isLoading: true,
        isHost: false,
        isAdmin: false,
        signUp: async () => ({ error: null }),
        signIn: async () => ({ error: null }),
        signOut: async () => {},
        refreshProfile: async () => {},
      } as AuthContextType;
    }
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
