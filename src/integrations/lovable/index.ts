// Lovable auth replaced with native Supabase OAuth.
// This file is kept as an empty stub to avoid breaking any residual imports.
// All OAuth is now handled directly via supabase.auth.signInWithOAuth()

export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: string, _opts?: any) => {
      console.warn('lovable.auth.signInWithOAuth is deprecated. Use supabase.auth.signInWithOAuth directly.');
      return { error: new Error('Use supabase.auth.signInWithOAuth directly') };
    },
  },
};