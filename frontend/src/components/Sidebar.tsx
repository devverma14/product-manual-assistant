import { useState } from 'react'
import {
  BookOpen,
  Check,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  FolderOpen,
  BarChart3,
  Settings,
  Plus,
  ShieldCheck,
  Sparkles,
  UserRound,
  ChevronRight,
  Clock3,
  X,
  LogOut,
  LogIn,
  LoaderCircle,
} from 'lucide-react'
import type { Manual } from '../types'
import { getSingleInitial } from '../lib/supabase'

export type Page =
  | 'dashboard'
  | 'documents'
  | 'chat'
  | 'history'
  | 'collections'
  | 'analytics'
  | 'settings'
  | 'privacy'
  | 'terms'

export type UserProfile = {
  id?: string
  email?: string
  full_name?: string
  avatar_url?: string
  is_guest?: boolean
}

type Props = {
  manual: Manual | null
  documents?: Manual[]
  onSelectManual?: (manual: Manual) => void
  onRemoveDocument?: (docId: string) => void
  deletingDocId?: string | null
  onUpload: () => void
  onRemoveManual?: () => void
  onNewChat?: () => void
  activePage?: Page
  onNavigate?: (page: Page) => void
  user?: UserProfile | null
  onOpenAuth?: () => void
  onSignOut?: () => void
}

const navigation: {
  label: string
  page: Page
  icon: typeof LayoutDashboard
}[] = [
  { label: 'Dashboard', page: 'dashboard', icon: LayoutDashboard },
  { label: 'My Documents', page: 'documents', icon: FolderOpen },
  { label: 'Chat Workspace', page: 'chat', icon: MessageSquareText },
  { label: 'Chat History', page: 'history', icon: Clock3 },
  { label: 'Collections', page: 'collections', icon: BookOpen },
  { label: 'Analytics', page: 'analytics', icon: BarChart3 },
]

export function BrandHeader({
  variant = 'sidebar',
  onClick,
}: {
  variant?: 'topbar' | 'sidebar'
  onClick?: () => void
}) {
  return (
    <button
      className={`brand-header brand-${variant}`}
      type="button"
      onClick={onClick}
      aria-label="Product Manual Assistant home"
    >
      <span className="brand-mark" aria-hidden="true">
        <BookOpen size={19} />
      </span>

      {variant === 'topbar' ? (
        <div className="brand-text-topbar">
          <strong>Product Manual</strong>
          <span className="brand-light"> Assistant</span>
        </div>
      ) : (
        <div className="brand-text-sidebar">
          <strong>Product Manual</strong>
          <span>ASSISTANT</span>
        </div>
      )}
    </button>
  )
}

export function Sidebar({
  manual,
  documents = [],
  onSelectManual,
  onRemoveDocument,
  deletingDocId,
  onUpload,
  onRemoveManual,
  onNewChat,
  activePage = 'dashboard',
  onNavigate,
  user,
  onOpenAuth,
  onSignOut,
}: Props) {
  const [avatarError, setAvatarError] = useState(false)

  // Combine documents list safely
  const docList = documents.length > 0 ? documents : (manual ? [manual] : [])

  const getUserInitials = () => {
    if (!user || user.is_guest) return ''
    return getSingleInitial(user.full_name, user.email)
  }

  return (
    <aside className="sidebar" aria-label="Sidebar navigation">
      <div className="sidebar-scrollable-content">
        <div className="sidebar-brand-wrapper">
          <BrandHeader onClick={() => onNavigate?.('dashboard')} />
        </div>

        {onNewChat && (
          <div className="px-3 pb-3">
            <button
              type="button"
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-xs shadow-md hover:from-indigo-700 hover:to-purple-700 transition-all flex items-center justify-center gap-2"
              onClick={() => {
                onNewChat()
                onNavigate?.('chat')
              }}
            >
              <Plus size={16} />
              <span>New Chat</span>
            </button>
          </div>
        )}

        <div className="workspace-label">WORKSPACE</div>

        <nav className="sidebar-navigation" aria-label="Main navigation">
          {navigation.map(({ label, page, icon: Icon }) => (
            <button
              key={page}
              type="button"
              className={`nav-item ${activePage === page ? 'active' : ''}`}
              onClick={() => onNavigate?.(page)}
              aria-current={activePage === page ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>

              {activePage === page && (
                <ChevronRight className="nav-chevron" size={15} aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="section-title">
            <span>YOUR LIBRARY ({docList.length})</span>

            <button
              type="button"
              className="mini-button"
              title="Upload manual"
              aria-label="Upload manual"
              onClick={onUpload}
            >
              <Plus size={17} />
            </button>
          </div>

          {docList.length > 0 ? (
            <div className="flex flex-col gap-2 mt-2">
              {docList.map((doc) => {
                const isActive = manual?.id === doc.id
                return (
                  <div
                    key={doc.id}
                    className={`sidebar-active-manual-card ${
                      isActive ? 'border-indigo-400 bg-indigo-50/40' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="sidebar-manual-info"
                      title={doc.name}
                      onClick={() => {
                        onSelectManual?.(doc)
                        onNavigate?.('chat')
                      }}
                    >
                      <span className="pdf-icon" aria-hidden="true">
                        <FileText size={17} />
                      </span>

                      <div className="sidebar-manual-details">
                        <strong className="sidebar-file-name">{doc.name}</strong>
                        <span className="sidebar-file-meta">
                          {doc.pages}p · {doc.chunks} sec
                        </span>
                      </div>
                    </button>

                    <div className="sidebar-manual-actions">
                      <span
                        className={`sidebar-indexed-badge ${
                          isActive ? 'text-indigo-600 font-bold' : ''
                        }`}
                        title="Manual ready and indexed"
                      >
                        <span className="indexed-dot" />
                        {isActive ? 'Active' : 'Indexed'}
                      </span>

                      {onRemoveDocument && (
                        <button
                          type="button"
                          className="sidebar-remove-button"
                          title="Remove document"
                          aria-label="Remove document"
                          disabled={deletingDocId === doc.id}
                          onClick={() => onRemoveDocument(doc.id)}
                        >
                          {deletingDocId === doc.id ? (
                            <LoaderCircle className="spin text-slate-400" size={14} />
                          ) : (
                            <X size={14} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="library-empty">
              <FileText size={19} className="mx-auto mb-1 opacity-60" aria-hidden="true" />
              <span>No manuals uploaded yet.</span>

              <button type="button" onClick={onUpload}>
                Upload your first PDF
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="tip-card">
          <span className="tip-icon" aria-hidden="true">
            <Sparkles size={17} />
          </span>

          <div>
            <strong>Answers you can verify</strong>
            <p>
              Every answer is grounded in your documents, with page
              references and supporting excerpts.
            </p>
          </div>
        </div>

        <button
          type="button"
          className={`nav-item settings-nav ${
            activePage === 'settings' ? 'active' : ''
          }`}
          onClick={() => onNavigate?.('settings')}
          aria-current={activePage === 'settings' ? 'page' : undefined}
        >
          <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
          <span>Settings</span>
        </button>

        <div className="profile-card">
          <div className="profile-info-row">
            {user && !user.is_guest ? (
              user.avatar_url && !avatarError ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name || 'User'}
                  className="w-7 h-7 rounded-full object-cover border border-indigo-200 shrink-0"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <span className="avatar small font-bold text-xs bg-indigo-600 text-white shrink-0 flex items-center justify-center" aria-hidden="true">
                  {getUserInitials()}
                </span>
              )
            ) : (
              <span className="avatar small flex items-center justify-center shrink-0" aria-hidden="true">
                <UserRound size={15} />
              </span>
            )}

            <div className="flex-1 min-w-0">
              <strong className="truncate block text-xs font-bold text-slate-900">
                {user && !user.is_guest
                  ? user.full_name || user.email
                  : user?.is_guest
                  ? 'Guest Workspace'
                  : 'Not signed in'}
              </strong>
              <span className="truncate block text-[10px] text-slate-500">
                {user && !user.is_guest
                  ? user.email
                  : user?.is_guest
                  ? 'Local Session'
                  : 'Sign in to sync'}
              </span>
            </div>
          </div>

          {user && !user.is_guest ? (
            <button
              type="button"
              className="auth-btn signout-btn"
              onClick={onSignOut}
              aria-label="Sign Out"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          ) : user?.is_guest ? (
            <div className="profile-actions-grid">
              <button
                type="button"
                className="auth-btn signin-btn"
                onClick={onOpenAuth}
                aria-label="Sign In"
              >
                <LogIn size={14} />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                className="auth-btn signout-btn"
                onClick={onSignOut}
                aria-label="Sign Out"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="auth-btn signin-btn"
              onClick={onOpenAuth}
              aria-label="Sign In"
            >
              <LogIn size={14} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
