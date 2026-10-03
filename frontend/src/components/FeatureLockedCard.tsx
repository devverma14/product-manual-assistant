import { BookOpen, LogIn, ShieldCheck, Sparkles, User } from 'lucide-react'

type Props = {
  featureName: string
  onOpenAuth: () => void
  onStartGuest: () => void
}

export function FeatureLockedCard({ featureName, onOpenAuth, onStartGuest }: Props) {
  return (
    <div className="animate-entrance max-w-2xl mx-auto py-12 px-6 text-center">
      <div className="relative inline-block mb-6">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-200/60 shadow-inner flex items-center justify-center text-indigo-600 mx-auto relative group">
          <BookOpen size={28} className="animate-float" />
          <span className="absolute -top-1 -right-1 text-amber-400 text-xs">✦</span>
          <span className="absolute -bottom-1 -left-1 text-indigo-400 text-xs">✳</span>
        </div>
      </div>

      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold mb-3">
        <Sparkles size={13} />
        <span>LOCKED FEATURE · {featureName.toUpperCase()}</span>
      </div>

      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
        Sign in or continue as a guest to access <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">{featureName}</span>.
      </h2>

      <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto mb-8 leading-relaxed">
        Sign in to save your documents and conversations, or continue as a guest to explore the workspace.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 max-w-md mx-auto mb-8">
        <button
          type="button"
          onClick={onOpenAuth}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-xs shadow-md hover:shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
        >
          <LogIn size={15} />
          Sign In to Workspace
        </button>

        <button
          type="button"
          onClick={onStartGuest}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-sm transition-all flex items-center justify-center gap-2"
        >
          <User size={15} />
          Continue as Guest
        </button>
      </div>

      <div className="pt-6 border-t border-slate-200/60 flex items-center justify-center gap-2 text-[11px] text-slate-400">
        <ShieldCheck size={13} className="text-emerald-500" />
        <span>End-to-end user data isolation & RLS security</span>
      </div>
    </div>
  )
}
