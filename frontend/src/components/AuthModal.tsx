import { useState, useEffect } from 'react'
import { X, LogIn, Mail, Lock, ShieldCheck, Sparkles, CheckCircle2, RefreshCw, KeyRound, ArrowLeft, User } from 'lucide-react'
import { supabase, isSupabaseConfigured, isUserVerified } from '../lib/supabase'

const OTP_RESEND_COOLDOWN_SECONDS = 60

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  onGuestClick?: () => void
  promptMessage?: string
}

export function AuthModal({ isOpen, onClose, onSuccess, onGuestClick, promptMessage }: Props) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [showOtpScreen, setShowOtpScreen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [error, setError] = useState('')
  const [infoMsg, setInfoMsg] = useState('')

  // Resend countdown timer effect
  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setInterval(() => {
      setResendCountdown((prev) => prev - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCountdown])

  const clearFormFields = () => {
    setFullName('')
    setEmail('')
    setPassword('')
    setOtpCode('')
    setShowOtpScreen(false)
    setError('')
    setInfoMsg('')
  }

  const resetState = () => {
    setError('')
    setInfoMsg('')
  }

  // Clear all form inputs whenever the modal opens or closes
  useEffect(() => {
    if (isOpen) {
      clearFormFields()
    } else {
      setPassword('')
      setOtpCode('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleGoogleLogin = async () => {
    resetState()
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase credentials (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are not configured yet.')
      return
    }

    try {
      const redirectUrl = window.location.origin
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      })
      if (error) throw error
      if (data?.url) {
        const width = 520
        const height = 630
        const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
        const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))

        const popup = window.open(
          data.url,
          'pma_google_oauth',
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
        )

        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          window.location.replace(data.url)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    resetState()

    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured in .env. Enter VITE_SUPABASE_URL to enable real Auth.')
      return
    }

    if (!email || !password) {
      setError('Please enter both email address and password.')
      return
    }

    if (isSignUp && !fullName.trim()) {
      setError('Please enter your full name.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    setLoading(true)
    try {
      if (isSignUp) {
        const cleanFullName = fullName.trim()
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: cleanFullName,
            },
          },
        })

        if (error) {
          const msg = error.message.toLowerCase()
          if (
            msg.includes('already registered') ||
            msg.includes('already exists') ||
            msg.includes('user already exists') ||
            msg.includes('identity_already_exists')
          ) {
            setError('An account may already exist with this email. Please try Sign In or Continue with Google.')
            return
          }
          throw error
        }

        // Supabase returns user with empty identities array if account already exists
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          setError('An account may already exist with this email. Please try Sign In or Continue with Google.')
          return
        }

        // If identity has Google provider (Case A)
        if (data.user?.identities?.some((i) => i.provider === 'google')) {
          setError('An account may already exist with this email. Please try Sign In or Continue with Google.')
          return
        }

        if (data.session && data.user && isUserVerified(data.user)) {
          clearFormFields()
          onSuccess()
          onClose()
        } else if (data.user) {
          setShowOtpScreen(true)
          setResendCountdown(OTP_RESEND_COOLDOWN_SECONDS)
          setInfoMsg(`A 6-digit verification code was sent to ${email}.`)
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          const msg = error.message.toLowerCase()
          if (
            msg.includes('email not confirmed') ||
            msg.includes('email_not_confirmed') ||
            msg.includes('not confirmed') ||
            msg.includes('email is not confirmed')
          ) {
            setError('Please verify your email with the OTP before signing in.')
            setShowOtpScreen(true)
            setResendCountdown(OTP_RESEND_COOLDOWN_SECONDS)
            return
          }
          if (
            msg.includes('invalid login credentials') ||
            msg.includes('invalid credentials')
          ) {
            setError('Invalid email or password. Please check your credentials and try again.')
            return
          }
          throw error
        }

        if (data?.session && data?.user && isUserVerified(data.user)) {
          clearFormFields()
          onSuccess()
          onClose()
        } else {
          if (supabase) {
            await supabase.auth.signOut()
          }
          setError('Please verify your email with the OTP before signing in.')
          setShowOtpScreen(true)
          setResendCountdown(OTP_RESEND_COOLDOWN_SECONDS)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    resetState()

    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured.')
      return
    }

    const cleanCode = otpCode.trim()
    if (cleanCode.length !== 6) {
      setError('Please enter the full 6-digit verification code.')
      return
    }

    setVerifyLoading(true)
    try {
      let { data, error } = await supabase.auth.verifyOtp({
        email,
        token: cleanCode,
        type: 'signup',
      })

      if (error) {
        const fallbackRes = await supabase.auth.verifyOtp({
          email,
          token: cleanCode,
          type: 'email',
        })
        data = fallbackRes.data
        error = fallbackRes.error
      }

      if (error || !data?.session) {
        setError(error?.message || 'Invalid or expired 6-digit code. Please check your email and try again.')
        return
      }

      clearFormFields()
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.')
    } finally {
      setVerifyLoading(false)
    }
  }

  const handleResendOtp = async () => {
    resetState()
    if (!isSupabaseConfigured || !supabase || !email) {
      setError('Please enter your email address to resend OTP.')
      return
    }

    setResendLoading(true)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      })
      if (error) throw error
      setResendCountdown(OTP_RESEND_COOLDOWN_SECONDS)
      setInfoMsg(`A new 6-digit verification code was sent to ${email}!`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification code.')
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-entrance"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-4 sm:p-6 relative max-h-[90vh] overflow-y-auto cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="absolute top-4 right-4 z-20 w-9 h-9 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
          type="button"
          aria-label="Close"
          title="Close dialog"
        >
          <X size={20} className="shrink-0" />
        </button>

        {showOtpScreen ? (
          <div className="space-y-4 text-center py-2 animate-entrance">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto">
              <KeyRound size={24} />
            </div>

            <div>
              <h2 className="text-lg font-extrabold text-slate-900">Enter Verification Code</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                We sent a 6-digit code to <strong className="text-slate-800">{email}</strong>.
              </p>
            </div>

            {infoMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span>{infoMsg}</span>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 text-center">
                  6-Digit OTP Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter OTP"
                  className="w-full py-2.5 px-4 border border-slate-300 rounded-xl text-center text-xl font-bold font-mono tracking-widest text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={verifyLoading || otpCode.trim().length !== 6}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-xs font-bold shadow-md hover:from-indigo-700 hover:to-purple-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <LogIn size={16} />
                {verifyLoading ? 'Verifying...' : 'Verify Code & Sign In'}
              </button>
            </form>

            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendLoading || resendCountdown > 0}
                className="w-full py-2 px-4 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              >
                <RefreshCw size={14} className={resendLoading ? 'animate-spin' : ''} />
                {resendLoading
                  ? 'Sending code...'
                  : resendCountdown > 0
                  ? `Resend code in ${resendCountdown}s`
                  : 'Resend Code'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowOtpScreen(false)
                  setOtpCode('')
                  resetState()
                }}
                className="w-full py-2 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all"
              >
                <ArrowLeft size={14} />
                Back to Sign In
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {isSignUp ? 'Create Workspace Account' : 'Sign In to Workspace'}
                </h2>
                <p className="text-xs text-slate-500">
                  Sync multi-document manuals, chat history & collections.
                </p>
              </div>
            </div>

            {promptMessage && !showOtpScreen && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-2 animate-entrance">
                <LogIn size={16} className="text-amber-600 shrink-0" />
                <span>{promptMessage}</span>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex flex-col gap-2">
                <span>{error}</span>
                {isSignUp && error.includes('already have an account') && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(false)
                      resetState()
                    }}
                    className="self-start px-2.5 py-1 bg-white border border-rose-300 text-rose-800 rounded-lg text-xs font-bold hover:bg-rose-100 transition-colors"
                  >
                    Switch to Sign In
                  </button>
                )}
              </div>
            )}

            {infoMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span>{infoMsg}</span>
              </div>
            )}

            <button
              onClick={handleGoogleLogin}
              type="button"
              className="w-full py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all mb-4"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="relative my-4 flex items-center justify-center">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-2 text-[11px] font-semibold text-slate-400 absolute">
                OR WITH EMAIL
              </span>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-3">
              {isSignUp && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Morgan"
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-xs font-bold shadow-md hover:from-indigo-700 hover:to-purple-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <LogIn size={16} />
                {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Sign In'}
              </button>
            </form>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp)
                  resetState()
                }}
                className="text-indigo-600 font-semibold hover:underline"
              >
                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose()
                  if (onGuestClick) onGuestClick()
                }}
                className="text-slate-500 hover:text-slate-700 font-medium"
              >
                Continue as Guest
              </button>
            </div>

            <div className="mt-3 flex items-center gap-1.5 justify-center text-[11px] text-slate-400">
              <ShieldCheck size={13} className="text-emerald-500" />
              <span>Session-isolated data · Encrypted authentication</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

