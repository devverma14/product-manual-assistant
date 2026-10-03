import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

export function isUserVerified(user?: {
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  app_metadata?: { provider?: string; providers?: string[] }
  identities?: Array<{ provider: string }>
} | null): boolean {
  if (!user) return false

  // OAuth users (Google, GitHub, etc.) are pre-verified by the OAuth provider
  const provider = user.app_metadata?.provider
  const providers = user.app_metadata?.providers || []
  const hasOAuthIdentity =
    provider === 'google' ||
    providers.includes('google') ||
    user.identities?.some((id) => id.provider !== 'email')

  if (hasOAuthIdentity) {
    return true
  }

  // Email/password users must have an email confirmation timestamp
  return Boolean(user.email_confirmed_at || user.confirmed_at)
}

export function getSingleInitial(fullName?: string, email?: string): string {
  if (fullName && fullName.trim().length > 0) {
    const clean = fullName.trim()
    for (let i = 0; i < clean.length; i++) {
      if (/[a-zA-Z0-9]/.test(clean[i])) {
        return clean[i].toUpperCase()
      }
    }
  }

  if (email && email.trim().length > 0) {
    const localPart = email.trim().split('@')[0] || ''
    for (let i = 0; i < localPart.length; i++) {
      if (/[a-zA-Z0-9]/.test(localPart[i])) {
        return localPart[i].toUpperCase()
      }
    }
  }

  return 'U'
}


