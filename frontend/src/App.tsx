import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BookOpen,
  Bot,
  CircleHelp,
  FileText,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  Menu,
  LayoutDashboard,
  Clock3,
  FolderOpen,
  BarChart3,
  Settings,
  Wrench,
  ShieldAlert,
  Cpu,
  Search,
  Layers3,
  ArrowRight,
  MessageSquareText,
  Trash2,
  Plus,
  User,
  LogOut,
  LogIn,
  CheckCircle2,
  Info,
  ChevronDown,
} from 'lucide-react'

import { AnswerCard } from './components/AnswerCard'
import { AuthModal } from './components/AuthModal'
import { FeatureLockedCard } from './components/FeatureLockedCard'
import { Sidebar, BrandHeader, UserProfile } from './components/Sidebar'
import { UploadDropzone } from './components/UploadDropzone'
import { isSupabaseConfigured, supabase, isUserVerified, getSingleInitial } from './lib/supabase'
import type { Manual, Reply, Turn } from './types'

type Page =
  | 'dashboard'
  | 'documents'
  | 'chat'
  | 'history'
  | 'collections'
  | 'analytics'
  | 'settings'

type Conversation = {
  id: string
  user_id: string
  document_id: string | null
  document_name?: string
  title: string
  created_at: string
  updated_at: string
  messages?: Array<{
    id: string
    sender: 'user' | 'assistant'
    content: string
    mode?: 'llm' | 'extractive' | 'no_match'
    sources?: Array<{ page: number; text: string }>
  }>
}

type Collection = {
  id: string
  name: string
  description: string
  created_at: string
}

type AnalyticsData = {
  total_documents: number
  total_pages: number
  total_chunks: number
  total_words: number
  total_conversations: number
  total_questions: number
  avg_chunks_per_doc: number
}

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const suggestions = [
  'How do I reset the device?',
  'What do the indicator lights mean?',
  'How do I clean and maintain it?',
]

const suggestedQuestions: {
  category: string
  question: string
  icon: typeof Wrench
}[] = [
  {
    category: 'Setup & Installation',
    question: 'What are the setup and installation instructions in this manual?',
    icon: Wrench,
  },
  {
    category: 'Troubleshooting',
    question: 'What troubleshooting steps does this manual recommend?',
    icon: CircleHelp,
  },
  {
    category: 'Safety & Warnings',
    question: 'What safety precautions and warnings are mentioned in this manual?',
    icon: ShieldAlert,
  },
  {
    category: 'Technical Specifications',
    question: 'What technical specifications are listed in this manual?',
    icon: Cpu,
  },
]

async function readError(response: Response) {
  try {
    const body = await response.json()
    return typeof body.detail === 'string'
      ? body.detail
      : 'The request could not be completed.'
  } catch {
    return 'The request could not be completed.'
  }
}

type AuthStatus = 'initializing' | 'unauthenticated' | 'authenticated' | 'guest'

export default function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard')
  const [authStatus, setAuthStatus] = useState<AuthStatus>('initializing')
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalPrompt, setAuthModalPrompt] = useState('')

  const openAuthModal = (prompt = '') => {
    setAuthModalPrompt(prompt)
    setAuthModalOpen(true)
  }

  // Multi-document & conversation state
  const [documents, setDocuments] = useState<Manual[]>([])
  const [manual, setManual] = useState<Manual | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const deletingDocIdRef = useRef<string | null>(null)

  // Connected feature state
  const [collections, setCollections] = useState<Collection[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)

  // Form & UI state
type UploadStage = 'idle' | 'uploading' | 'processing' | 'indexing' | 'ready' | 'error'

  const [question, setQuestion] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle')
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [uploadErrorDetail, setUploadErrorDetail] = useState<{
    type: 'page_limit' | 'size_limit' | 'unexpected'
    message: string
    actual?: string
    limit?: string
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const latestTurnRef = useRef<HTMLDivElement>(null)
  const thinkingRef = useRef<HTMLDivElement>(null)

  // Mutable refs to eliminate stale closures and guard concurrent operations
  const userRef = useRef<UserProfile | null>(null)
  const authStatusRef = useRef<AuthStatus>('initializing')
  const refreshPromiseRef = useRef<Promise<Session | null> | null>(null)
  const isWorkspaceLoadingRef = useRef<boolean>(false)

  // Keep refs synchronized on every render
  userRef.current = user
  authStatusRef.current = authStatus

  const clearWorkspaceState = () => {
    setDocuments([])
    setManual(null)
    setConversations([])
    setActiveConv(null)
    setTurns([])
    setCollections([])
    setAnalytics(null)
  }

  const startNewChat = () => {
    setManual(null)
    setActiveConv(null)
    setTurns([])
    setQuestion('')
    setError('')
    setActivePage('chat')
  }

  const performTokenRefresh = (): Promise<Session | null> => {
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
        try {
          if (!isSupabaseConfigured || !supabase) return null
          const { data, error: refreshErr } = await supabase.auth.refreshSession()
          if (!refreshErr && data.session) {
            setSession(data.session)
            return data.session
          }
          return null
        } catch {
          return null
        } finally {
          refreshPromiseRef.current = null
        }
      })()
    }
    return refreshPromiseRef.current
  }

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const isGuestActive = sessionStorage.getItem('pma_guest_mode') === 'true'
    if (isGuestActive || authStatusRef.current === 'guest') {
      const guestId = sessionStorage.getItem('pma_guest_session_id') || 'guest_user'
      return { 'X-Guest-Session-ID': guestId }
    }

    if (isSupabaseConfigured && supabase) {
      try {
        let { data: { session: currentSession } } = await supabase.auth.getSession()

        if (currentSession) {
          const expiresAt = currentSession.expires_at || 0
          const now = Math.floor(Date.now() / 1000)
          if (expiresAt && expiresAt - now < 60) {
            const refreshed = await performTokenRefresh()
            if (refreshed) {
              currentSession = refreshed
            }
          }
        }

        if (currentSession?.access_token) {
          return { Authorization: `Bearer ${currentSession.access_token}` }
        }
      } catch {
        // Ignored
      }
    }
    return {}
  }

  const fetchWithAuth = async (url: string, options: RequestInit = {}, isRetry = false): Promise<Response> => {
    const authHeaders = await getAuthHeaders()
    const combinedOptions: RequestInit = {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...authHeaders,
      },
    }

    const response = await fetch(url, combinedOptions)

    if (response.status === 401 && !isRetry && (authStatusRef.current === 'authenticated' || authStatus === 'authenticated')) {
      if (isSupabaseConfigured && supabase) {
        try {
          const refreshed = await performTokenRefresh()
          if (refreshed?.access_token) {
            const retryHeaders = {
              ...(options.headers || {}),
              Authorization: `Bearer ${refreshed.access_token}`,
            }
            return fetch(url, { ...options, headers: retryHeaders })
          }
        } catch {
          // Ignored
        }

        try {
          const { data: { session: currentSession } } = await supabase.auth.getSession()
          if (currentSession?.user) {
            const expiresAt = currentSession.expires_at || 0
            const now = Math.floor(Date.now() / 1000)
            if (expiresAt && expiresAt - now > 60) {
              return response
            }
          }
        } catch {
          // Ignored
        }
      }

      await handleSignOut()
      setError('Your authentication session has expired. Please sign in again.')
      throw new Error('Your authentication session has expired. Please sign in again.')
    }

    return response
  }

  const SENSITIVE_OAUTH_PARAMS = [
    'access_token',
    'refresh_token',
    'code',
    'id_token',
    'token_type',
    'expires_in',
    'expires_at',
    'provider_token',
    'provider_refresh_token',
    'error',
    'error_code',
    'error_description',
    'type',
    'state',
  ]

  const cleanOAuthUrl = () => {
    if (typeof window === 'undefined') return

    try {
      const url = new URL(window.location.href)
      let modified = false

      // 1. Clean query parameters
      const searchParams = new URLSearchParams(url.search)
      SENSITIVE_OAUTH_PARAMS.forEach((param) => {
        if (searchParams.has(param)) {
          searchParams.delete(param)
          modified = true
        }
      })

      // 2. Clean hash parameters (e.g. #access_token=...&refresh_token=...)
      let cleanHash = url.hash
      if (url.hash && url.hash.length > 1) {
        const hashContent = url.hash.substring(1)
        if (SENSITIVE_OAUTH_PARAMS.some((param) => hashContent.includes(`${param}=`))) {
          const hashParams = new URLSearchParams(hashContent)
          SENSITIVE_OAUTH_PARAMS.forEach((param) => {
            hashParams.delete(param)
          })
          const remainingHash = hashParams.toString()
          cleanHash = remainingHash ? `#${remainingHash}` : ''
          modified = true
        }
      }

      if (modified) {
        const newSearch = searchParams.toString()
        const newPath = url.pathname + (newSearch ? `?${newSearch}` : '') + cleanHash
        window.history.replaceState(history.state, document.title, newPath)
      }
    } catch {
      if (
        window.location.search.includes('code=') ||
        window.location.hash.includes('access_token=')
      ) {
        window.history.replaceState(null, document.title, window.location.pathname)
      }
    }
  }

  const applyUnauthenticatedState = () => {
    const isGuestActive = sessionStorage.getItem('pma_guest_mode') === 'true'
    if (isGuestActive) {
      const guestId = sessionStorage.getItem('pma_guest_session_id') || 'guest_user'
      const guestProfile: UserProfile = {
        id: guestId,
        email: 'guest@local',
        full_name: 'Guest User',
        is_guest: true,
      }
      setUser(guestProfile)
      userRef.current = guestProfile
      setAuthStatus('guest')
      authStatusRef.current = 'guest'
    } else {
      setUser(null)
      userRef.current = null
      setSession(null)
      setAuthStatus('unauthenticated')
      authStatusRef.current = 'unauthenticated'
      clearWorkspaceState()
    }
  }

  const applyAuthenticatedUser = (activeSession: Session, isUserSwitch = false) => {
    if (!activeSession?.user || !isUserVerified(activeSession.user)) {
      applyUnauthenticatedState()
      return
    }

    const currentUser = userRef.current
    const isNewUser = !currentUser || currentUser.id !== activeSession.user.id
    const newUserProfile: UserProfile = {
      id: activeSession.user.id,
      email: activeSession.user.email,
      full_name:
        activeSession.user.user_metadata?.full_name ||
        activeSession.user.user_metadata?.name ||
        activeSession.user.email,
      avatar_url:
        activeSession.user.user_metadata?.avatar_url ||
        activeSession.user.user_metadata?.picture,
      is_guest: false,
    }

    setSession(activeSession)
    setUser(newUserProfile)
    userRef.current = newUserProfile

    sessionStorage.removeItem('pma_guest_mode')
    sessionStorage.removeItem('pma_guest_session_id')

    if (isNewUser || isUserSwitch) {
      clearWorkspaceState()
    }
    setAuthStatus('authenticated')
    authStatusRef.current = 'authenticated'
    cleanOAuthUrl()
  }

  // Clean OAuth params immediately on mount
  useEffect(() => {
    // If running inside OAuth popup window, notify opener and auto-close popup
    if (typeof window !== 'undefined' && window.opener && window.opener !== window) {
      const isOAuthRedirect =
        window.location.search.includes('code=') ||
        window.location.hash.includes('access_token=')

      if (isOAuthRedirect) {
        if (isSupabaseConfigured && supabase) {
          const notifyAndClose = () => {
            try {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'PMA_OAUTH_SUCCESS' }, window.location.origin)
              }
            } catch {
              // Ignored
            }
            window.close()
          }

          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
              notifyAndClose()
            }
          })

          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' || session?.user) {
              subscription.unsubscribe()
              notifyAndClose()
            }
          })

          const timer = setTimeout(notifyAndClose, 1500)
          return () => {
            subscription.unsubscribe()
            clearTimeout(timer)
          }
        } else {
          window.close()
        }
      }
    }
  }, [])

  // Listen for OAuth completion from popup in main tab
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'PMA_OAUTH_SUCCESS') {
        setAuthModalOpen(false)
        if (isSupabaseConfigured && supabase) {
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
              applyAuthenticatedUser(session, true)
              loadWorkspaceData('authenticated')
            }
          })
        }
      }
    }

    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [])

  // Initial session restoration & Supabase Auth listener with browser history safety
  useEffect(() => {
    let isMounted = true

    // Clean OAuth params immediately on mount
    cleanOAuthUrl()

    // Scrub sensitive params if user navigates Back/Forward into a history state
    const handleLocationChange = () => {
      cleanOAuthUrl()
    }

    window.addEventListener('popstate', handleLocationChange)
    window.addEventListener('hashchange', handleLocationChange)

    // Clean OAuth error if present in URL
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const searchParams = new URLSearchParams(window.location.search)
    const urlError = hashParams.get('error_description') || searchParams.get('error_description')
    if (urlError) {
      setError(decodeURIComponent(urlError.replace(/\+/g, ' ')))
      cleanOAuthUrl()
    }

    async function initializeAuth() {
      if (isSupabaseConfigured && supabase) {
        try {
          const { data: { session: existingSession } } = await supabase.auth.getSession()
          if (!isMounted) return

          if (existingSession?.user) {
            applyAuthenticatedUser(existingSession, false)
            loadWorkspaceData('authenticated')
            return
          }
        } catch {
          // Ignored
        }
      }

      if (!isMounted) return

      const isOAuthRedirect =
        window.location.search.includes('code=') ||
        window.location.hash.includes('access_token=')

      if (!isOAuthRedirect) {
        applyUnauthenticatedState()
      }
    }

    initializeAuth()

    if (isSupabaseConfigured && supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
        if (!isMounted) return

        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED'
        ) {
          if (currentSession?.user) {
            applyAuthenticatedUser(currentSession, event === 'SIGNED_IN')
            loadWorkspaceData('authenticated')
          } else if (event === 'INITIAL_SESSION') {
            const isOAuthRedirect =
              window.location.search.includes('code=') ||
              window.location.hash.includes('access_token=')
            if (!isOAuthRedirect) {
              applyUnauthenticatedState()
            }
          }
        } else if (event === 'SIGNED_OUT') {
          setSession(null)
          setUser(null)
          userRef.current = null
          setAuthStatus('unauthenticated')
          authStatusRef.current = 'unauthenticated'
          sessionStorage.removeItem('pma_guest_mode')
          clearWorkspaceState()
        }
      })

      const handleVisibilityOrFocusChange = () => {
        if (document.visibilityState === 'visible') {
          cleanOAuthUrl()
          const currentStatus = authStatusRef.current
          if (currentStatus === 'authenticated' || currentStatus === 'guest') {
            loadWorkspaceData(currentStatus)
          }
        }
      }

      window.addEventListener('visibilitychange', handleVisibilityOrFocusChange)
      window.addEventListener('focus', handleVisibilityOrFocusChange)

      return () => {
        isMounted = false
        subscription.unsubscribe()
        window.removeEventListener('popstate', handleLocationChange)
        window.removeEventListener('hashchange', handleLocationChange)
        window.removeEventListener('visibilitychange', handleVisibilityOrFocusChange)
        window.removeEventListener('focus', handleVisibilityOrFocusChange)
      }
    }

    return () => {
      isMounted = false
      window.removeEventListener('popstate', handleLocationChange)
      window.removeEventListener('hashchange', handleLocationChange)
    }
  }, [])

  // Load documents and conversations for immediate core workspace rendering,
  // then load collections and analytics asynchronously in the background.
  const loadWorkspaceData = async (overrideAuthStatus?: AuthStatus) => {
    const statusToCheck = overrideAuthStatus || authStatusRef.current || authStatus
    if (statusToCheck !== 'authenticated' && statusToCheck !== 'guest') {
      return
    }

    if (isWorkspaceLoadingRef.current) {
      return
    }
    isWorkspaceLoadingRef.current = true

    try {
      // 1. Critical Core Workspace Requests (Manuals & Conversations)
      const [docsRes, convRes] = await Promise.all([
        fetchWithAuth(`${API}/api/manuals`),
        fetchWithAuth(`${API}/api/conversations`),
      ])

      if (docsRes.ok) {
        const docsData: Manual[] = await docsRes.json()
        setDocuments((prevDocs) => {
          const combined = [...docsData]
          const activeDeletingId = deletingDocIdRef.current
          prevDocs.forEach((d) => {
            if (d.id !== activeDeletingId && !combined.some((cd) => cd.id === d.id)) {
              combined.unshift(d)
            }
          })
          return combined
        })
        setManual((prev) => {
          if (prev && prev.id !== deletingDocIdRef.current) {
            return prev
          }
          return docsData[0] || null
        })
      }

      if (convRes.ok) {
        const convData: Conversation[] = await convRes.json()
        setConversations(convData)
      }

      // 2. Non-critical Secondary Requests (Collections & Analytics) in background.
      // Keep isWorkspaceLoadingRef.current true until background requests settle
      // without blocking core UI rendering.
      Promise.allSettled([
        fetchWithAuth(`${API}/api/collections`),
        fetchWithAuth(`${API}/api/analytics`),
      ])
        .then(async ([colResult, anaResult]) => {
          if (colResult.status === 'fulfilled' && colResult.value.ok) {
            try {
              const colData: Collection[] = await colResult.value.json()
              setCollections(colData)
            } catch {
              // Graceful fallback
            }
          }
          if (anaResult.status === 'fulfilled' && anaResult.value.ok) {
            try {
              const anaData: AnalyticsData = await anaResult.value.json()
              setAnalytics(anaData)
            } catch {
              // Graceful fallback
            }
          }
        })
        .finally(() => {
          isWorkspaceLoadingRef.current = false
        })
    } catch {
      // Graceful fallback if backend server restarting or core requests failed
      isWorkspaceLoadingRef.current = false
    }
  }

  useEffect(() => {
    if (authStatus === 'authenticated' || authStatus === 'guest') {
      loadWorkspaceData()
    } else if (authStatus === 'unauthenticated') {
      clearWorkspaceState()
    }
  }, [authStatus, session?.user?.id])

  const startGuestSession = () => {
    let guestId = sessionStorage.getItem('pma_guest_session_id')
    if (!guestId) {
      guestId = 'guest_' + Math.random().toString(36).substring(2, 9)
      sessionStorage.setItem('pma_guest_session_id', guestId)
    }
    sessionStorage.setItem('pma_guest_mode', 'true')
    setUser({
      id: guestId,
      email: 'guest@local',
      full_name: 'Guest User',
      is_guest: true,
    })
    clearWorkspaceState()
    setAuthStatus('guest')
    setAuthModalOpen(false)
  }

  const handleSignOut = async () => {
    sessionStorage.removeItem('pma_guest_mode')
    sessionStorage.removeItem('pma_guest_session_id')
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut()
      } catch {
        // Ignored
      }
    }
    setSession(null)
    setUser(null)
    setAuthStatus('unauthenticated')
    clearWorkspaceState()
  }

  // Auto-scroll logic for chat workspace
  useLayoutEffect(() => {
    if (activePage !== 'chat') return

    const container = conversationRef.current
    if (!container) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior = prefersReducedMotion ? 'auto' : 'smooth'

    const scrollToLatestStart = () => {
      const targetEl = asking ? thinkingRef.current || latestTurnRef.current : latestTurnRef.current
      if (!targetEl) return

      const containerRect = container.getBoundingClientRect()
      const targetRect = targetEl.getBoundingClientRect()
      const targetTopOffset = targetRect.top - containerRect.top + container.scrollTop

      container.scrollTo({
        top: Math.max(0, targetTopOffset - 12),
        behavior,
      })
    }

    scrollToLatestStart()
    const frameId = requestAnimationFrame(() => {
      scrollToLatestStart()
      setTimeout(scrollToLatestStart, 60)
      setTimeout(scrollToLatestStart, 200)
    })

    return () => cancelAnimationFrame(frameId)
  }, [turns, asking, activePage])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mobileNavOpen) {
        setMobileNavOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen])

  function navigate(page: Page) {
    setActivePage(page)
    setError('')
    setMobileNavOpen(false)
  }

  const dismissUploadStatus = () => {
    setUploadStage('idle')
    setUploadingFileName(null)
    setUploadErrorDetail(null)
  }

  const openReadyChat = async () => {
    if (!manual) return
    setError('')
    setUploadStage('idle')
    setUploadingFileName(null)

    if (!activeConv || activeConv.document_id !== manual.id) {
      try {
        const res = await fetchWithAuth(`${API}/api/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: manual.id, title: 'New Conversation' }),
        })
        if (res.ok) {
          const conv: Conversation = await res.json()
          setActiveConv(conv)
          setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)])
        }
      } catch {
        // Ignored
      }
    }
    setActivePage('chat')
  }

  async function handleUploadSuccess(result: Manual, sourcePage: Page) {
    setDocuments((prev) => [result, ...prev.filter((d) => d.id !== result.id)])
    setManual(result)
    setTurns([])
    setUploading(false)
    setUploadStage('ready')
    if (inputRef.current) inputRef.current.value = ''

    try {
      const res = await fetchWithAuth(`${API}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: result.id, title: 'New Conversation' }),
      })
      if (res.ok) {
        const newConv: Conversation = await res.json()
        setActiveConv(newConv)
        setConversations((prev) => [newConv, ...prev.filter((c) => c.id !== newConv.id)])
      } else {
        setActiveConv(null)
      }
    } catch {
      setActiveConv(null)
    } finally {
      if (sourcePage === 'chat') {
        setActivePage('chat')
        setTimeout(() => {
          setUploadStage((current) => (current === 'ready' ? 'idle' : current))
        }, 1500)
      }
      loadWorkspaceData()
    }
  }

  // Upload new PDF with Authorization header
  function upload(file?: File, isRetry = false) {
    if (!file) return

    if (uploading || (uploadStage !== 'idle' && uploadStage !== 'ready' && uploadStage !== 'error')) {
      return
    }

    if (authStatus === 'initializing') {
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    if (authStatus !== 'authenticated' && authStatus !== 'guest') {
      openAuthModal('Please sign in or continue as Guest to upload a product manual.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      const fileMB = (file.size / (1024 * 1024)).toFixed(1)
      setUploadingFileName(file.name)
      setUploadStage('error')
      setUploading(false)
      setUploadErrorDetail({
        type: 'size_limit',
        message: `PDF file is too large. Maximum allowed size is 10 MB.`,
        actual: `${fileMB} MB`,
        limit: '10 MB',
      })
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    const sourcePage = activePage
    setError('')
    setUploading(true)
    setUploadStage('uploading')
    setUploadingFileName(file.name)
    setUploadProgress(0)

    const form = new FormData()
    form.append('file', file)

    getAuthHeaders().then((headers) => {
      const request = new XMLHttpRequest()
      request.open('POST', `${API}/api/manuals`)

      Object.entries(headers).forEach(([k, v]) => {
        request.setRequestHeader(k, v)
      })

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(percent)
          if (percent >= 100) {
            setUploadStage('processing')
          }
        }
      }

      request.onerror = () => {
        setError('Could not reach the API. Start the FastAPI service and try again.')
        setUploading(false)
        setUploadStage('error')
        if (inputRef.current) inputRef.current.value = ''
      }

      request.onload = async () => {
        setUploadStage('indexing')
        let result: Manual & { detail?: string }
        try {
          result = JSON.parse(request.responseText)
        } catch {
          setError('The API returned an unreadable response.')
          setUploading(false)
          setUploadStage('error')
          if (inputRef.current) inputRef.current.value = ''
          return
        }

        if (request.status < 200 || request.status >= 300) {
          if (request.status === 401 && authStatus === 'authenticated') {
            if (!isRetry && isSupabaseConfigured && supabase) {
              try {
                const refreshed = await performTokenRefresh()
                if (refreshed?.access_token) {
                  setUploading(false)
                  setUploadStage('idle')
                  upload(file, true)
                  return
                }
              } catch {
                // Ignored
              }

              try {
                const { data: { session: currentSession } } = await supabase.auth.getSession()
                if (currentSession?.user) {
                  const expiresAt = currentSession.expires_at || 0
                  const now = Math.floor(Date.now() / 1000)
                  if (expiresAt && expiresAt - now > 60) {
                    setUploading(false)
                    setUploadStage('error')
                    if (inputRef.current) inputRef.current.value = ''
                    setError('Could not process this PDF due to an authorization issue.')
                    return
                  }
                }
              } catch {
                // Ignored
              }
            }
            setUploading(false)
            setUploadStage('error')
            if (inputRef.current) inputRef.current.value = ''
            await handleSignOut()
            setError('Your authentication session has expired. Please sign in again.')
            return
          }

          setUploading(false)
          setUploadStage('error')
          if (inputRef.current) inputRef.current.value = ''

          const detail: string = result.detail || ''

          if (request.status === 413 || detail.toLowerCase().includes('too large') || detail.toLowerCase().includes('maximum allowed size')) {
            const fileMB = file ? (file.size / (1024 * 1024)).toFixed(1) : null
            setUploadErrorDetail({
              type: 'size_limit',
              message: detail || 'PDF file is too large. Maximum allowed size is 10 MB.',
              actual: fileMB ? `${fileMB} MB` : undefined,
              limit: '10 MB',
            })
          } else if (detail.toLowerCase().includes('too many pages') || detail.toLowerCase().includes('maximum allowed is 50 pages')) {
            // Try to extract actual page count from backend message if present (e.g. "... 61 pages ...")
            const pageMatch = detail.match(/(\d+)\s+pages?\s+(?:in|found|detected|total)/i)
            const actualPageCount = pageMatch ? pageMatch[1] : null
            setUploadErrorDetail({
              type: 'page_limit',
              message: detail || 'PDF has too many pages. Maximum allowed is 50 pages.',
              actual: actualPageCount ? `${actualPageCount} pages` : undefined,
              limit: '50 pages',
            })
          } else {
            setUploadErrorDetail({
              type: 'unexpected',
              message: detail || 'Document processing failed. Please try again.',
            })
          }
        } else {
          handleUploadSuccess(result, sourcePage)
        }
      }

      request.send(form)
    })
  }

  // Submit question in active chat session
  async function ask(text = question) {
    const clean = text.trim()
    if (!manual || clean.length < 3 || asking) return

    setError('')
    setQuestion('')
    setAsking(true)

    try {
      let currentConvId = activeConv?.id

      // Create conversation in DB if not existing
      if (!currentConvId) {
        const createRes = await fetchWithAuth(`${API}/api/conversations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: manual.id, title: clean.slice(0, 40) }),
        })
        if (createRes.ok) {
          const newConv: Conversation = await createRes.json()
          currentConvId = newConv.id
          setActiveConv(newConv)
        }
      }

      const url = currentConvId
        ? `${API}/api/conversations/${currentConvId}/questions`
        : `${API}/api/manuals/${manual.id}/questions`

      const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: clean, top_k: 5 }),
      })

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const reply: Reply = await response.json()
      setTurns((previous) => [...previous, { question: clean, reply }])
      loadWorkspaceData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.')
    } finally {
      setAsking(false)
    }
  }

  // Open a saved conversation from Chat History
  async function openConversation(convId: string) {
    setError('')
    try {
      const res = await fetchWithAuth(`${API}/api/conversations/${convId}`)
      if (!res.ok) throw new Error('Could not load conversation.')
      const data: Conversation = await res.json()

      setActiveConv(data)
      if (data.document_id) {
        const docMatch = documents.find((d) => d.id === data.document_id)
        if (docMatch) setManual(docMatch)
      }

      const reconstructedTurns: Turn[] = []
      const msgs = data.messages || []
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].sender === 'user' && msgs[i + 1]?.sender === 'assistant') {
          reconstructedTurns.push({
            question: msgs[i].content,
            reply: {
              answer: msgs[i + 1].content,
              mode: msgs[i + 1].mode || 'llm',
              sources: msgs[i + 1].sources || [],
            },
          })
          i++
        }
      }

      setTurns(reconstructedTurns)
      setActivePage('chat')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open conversation.')
    }
  }

  // Delete a conversation
  async function deleteConversation(convId: string) {
    try {
      await fetchWithAuth(`${API}/api/conversations/${convId}`, {
        method: 'DELETE',
      })
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (activeConv?.id === convId) {
        setActiveConv(null)
        setTurns([])
      }
      loadWorkspaceData()
    } catch {
      // Ignored
    }
  }

  // Delete a document
  async function removeDocument(docId: string) {
    if (deletingDocIdRef.current) return
    deletingDocIdRef.current = docId
    setDeletingDocId(docId)

    // Immediately remove from visible React state
    setDocuments((prev) => prev.filter((d) => d.id !== docId))
    if (manual?.id === docId) {
      setManual((prevManual) => {
        if (prevManual?.id === docId) {
          const remaining = documents.filter((d) => d.id !== docId)
          return remaining[0] || null
        }
        return prevManual
      })
      setTurns([])
      setActiveConv(null)
    }

    try {
      await fetchWithAuth(`${API}/api/manuals/${docId}`, {
        method: 'DELETE',
      })
      await loadWorkspaceData()
    } catch {
      // Ignored
    } finally {
      deletingDocIdRef.current = null
      setDeletingDocId(null)
    }
  }

  // Create Collection
  async function handleCreateCollection(e: React.FormEvent) {
    e.preventDefault()
    if (!newCollectionName.trim()) return
    try {
      const res = await fetchWithAuth(`${API}/api/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCollectionName.trim(), description: 'Product Manual Collection' }),
      })
      if (res.ok) {
        setNewCollectionName('')
        loadWorkspaceData()
      }
    } catch {
      // Ignored
    }
  }

  function openUpload() {
    if (authStatus === 'initializing') {
      return
    }

    if (authStatus !== 'authenticated' && authStatus !== 'guest') {
      openAuthModal('Please sign in or continue as Guest to upload a product manual.')
      return
    }

    setError('')
    inputRef.current?.click()
  }

  function renderChat() {
    if (!manual) {
      return (
        <div className="animate-entrance my-8">
          <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm text-center max-w-xl mx-auto space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center mx-auto shadow-sm">
              <MessageSquareText size={28} />
            </div>
            <div>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 mb-2">
                No document selected
              </span>
              <h2 className="text-xl font-extrabold text-slate-900">New Chat Workspace</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Upload a product manual or choose an existing document from your library to start asking questions.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
              <button
                type="button"
                className="primary-button"
                style={{ marginTop: 0, padding: '10px 20px', fontSize: '13px' }}
                onClick={openUpload}
              >
                <Plus size={18} />
                <span>Upload New PDF</span>
              </button>
              {documents.length > 0 && (
                <button
                  type="button"
                  className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-all flex items-center gap-2 shadow-sm"
                  onClick={() => navigate('documents')}
                >
                  <FolderOpen size={17} className="text-indigo-600" />
                  <span>My Documents ({documents.length})</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )
    }

    return (
      <section className="chat-workspace" aria-label="Manual chat workspace">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm mb-3">
          <div className="flex items-center gap-2 text-xs text-slate-700 min-w-0">
            <FileText size={16} className="text-indigo-600 shrink-0" />
            <span className="truncate">
              Active Manual: <strong>{manual.name}</strong> ({manual.pages} pages)
            </span>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
            onClick={startNewChat}
            title="Start a new chat session"
          >
            <Plus size={14} className="text-indigo-600" />
            <span>New Chat</span>
          </button>
        </div>

        <div className="chat-conversation-scroll" ref={conversationRef}>
          {turns.length === 0 ? (
            <div className="question-area chat-empty-state">
              <div className="ready-heading">
                <span className="ready-icon">
                  <Sparkles size={16} />
                </span>
                <div>
                  <strong>Your manual "{manual.name}" is ready</strong>
                  <p>Choose a suggested question or ask your own.</p>
                </div>
              </div>
              <div className="suggestions">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    className="suggestion"
                    onClick={() => ask(item)}
                    type="button"
                    disabled={asking}
                  >
                    {item}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="conversation">
              {turns.map((turn, index) => {
                const isLatest = index === turns.length - 1
                return (
                  <div
                    key={`${index}-${turn.question}`}
                    ref={isLatest ? latestTurnRef : undefined}
                  >
                    <AnswerCard turn={turn} user={user} />
                  </div>
                )
              })}
            </div>
          )}

          {asking && (
            <div className="thinking" ref={thinkingRef}>
              <span className="bot-icon">
                <Bot size={17} />
              </span>
              <span className="pulse-dots">Finding relevant section and writing answer</span>
              <LoaderCircle className="spin" size={15} />
            </div>
          )}
        </div>

        <div className="composer-wrap chat-composer-wrap">
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault()
              ask()
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={`Ask anything about ${manual.name}...`}
              maxLength={1000}
              aria-label="Question about the manual"
            />
            <span className="key-hint hidden sm:inline-block">↵</span>
            <button
              className="send-button"
              type="submit"
              disabled={question.trim().length < 3 || asking}
              aria-label="Send question"
            >
              <Send size={17} />
            </button>
          </form>
          <div className="composer-note">
            <ShieldCheck size={13} />
            Answers use the uploaded manual
            <span>·</span>
            AI can make mistakes
          </div>
        </div>
      </section>
    )
  }

  function renderPage() {
    switch (activePage) {
      case 'dashboard':
        return (
          <div className="animate-entrance">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  DOCUMENT INTELLIGENCE
                </div>

                <h1>
                  Your manuals,
                  <br className="mobile-break" /> <span>understood.</span>
                </h1>

                <p className="subtitle">
                  Upload PDF manuals, search multi-document libraries, and get instant answers grounded in your documentation.
                </p>
              </div>

              <div className="heading-art floating-doc-art" aria-hidden="true">
                <div className="art-orbit orbit-one" />
                <div className="art-orbit orbit-two" />
                <div className="art-book">
                  <BookOpen size={32} />
                </div>
                <span className="art-spark spark-one">✳</span>
                <span className="art-spark spark-two">✦</span>
              </div>
            </div>

            {manual && (
              <div className="homepage-section" style={{ marginTop: 0 }}>
                <div className="manual-banner">
                  <div className="manual-badge">
                    <FileText size={20} />
                  </div>

                  <div className="manual-info">
                    <strong>{manual.name}</strong>
                    <span>
                      {manual.pages} pages
                      <i />
                      {manual.words.toLocaleString()} words
                      <i />
                      {manual.chunks} searchable sections
                    </span>
                  </div>

                  <span className="indexed">
                    <span />
                    Active Manual
                  </span>

                  <button
                    className="primary-button"
                    style={{ marginTop: 0, padding: '8px 14px', fontSize: '12px' }}
                    onClick={() => navigate('chat')}
                    type="button"
                  >
                    <MessageSquareText size={15} />
                    Open Chat
                  </button>
                </div>
              </div>
            )}

            <UploadDropzone
              uploading={uploading}
              progress={uploadProgress}
              stage={uploadStage}
              fileName={uploadingFileName}
              errorDetail={uploadErrorDetail}
              dragging={dragging}
              onDragChange={setDragging}
              onChoose={openUpload}
              onFile={upload}
            />

            <section className="homepage-section" aria-label="Suggested topics">
              <div className="homepage-section-title">
                <Sparkles size={16} />
                <span>WHAT WOULD YOU LIKE TO FIND?</span>
              </div>

              <div className="homepage-suggested-grid">
                {suggestedQuestions.map(({ category, question: text, icon: Icon }) => (
                  <button
                    key={category}
                    type="button"
                    className="homepage-suggested-card"
                    onClick={() => {
                      if (manual) {
                        navigate('chat')
                        ask(text)
                      } else {
                        setError('Upload a PDF product manual first before asking questions.')
                      }
                    }}
                  >
                    <div className="homepage-suggested-header">
                      <span className="homepage-suggested-icon">
                        <Icon size={16} />
                      </span>
                      <strong>{category}</strong>
                      <ArrowRight size={14} className="homepage-suggested-arrow" />
                    </div>
                    <p>{text}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="homepage-section" aria-label="Key features">
              <div className="homepage-section-title">
                <Search size={16} />
                <span>HOW IT WORKS</span>
              </div>

              <div className="homepage-features-grid">
                <div className="homepage-feature-card">
                  <div className="homepage-feature-icon">
                    <Search size={18} />
                  </div>
                  <strong>Semantic Search</strong>
                  <p>Fast FAISS vector indexing searches exact text passages across your PDF chunks.</p>
                </div>

                <div className="homepage-feature-card">
                  <div className="homepage-feature-icon">
                    <Bot size={18} />
                  </div>
                  <strong>Grounded AI Answers</strong>
                  <p>Responses are synthesized strictly from retrieved manual context using Gemini.</p>
                </div>

                <div className="homepage-feature-card">
                  <div className="homepage-feature-icon">
                    <Layers3 size={18} />
                  </div>
                  <strong>Cited Excerpts</strong>
                  <p>Every answer links to exact page numbers and verifiable source paragraphs.</p>
                </div>
              </div>
            </section>
          </div>
        )

      case 'documents':
        const filteredDocs = documents.filter((d) =>
          d.name.toLowerCase().includes(searchFilter.toLowerCase()),
        )
        return (
          <div className="animate-entrance space-y-6">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  PERSISTENT LIBRARY
                </div>
                <h1>
                  My <span>Documents.</span>
                </h1>
                <p className="subtitle">
                  Manage your multi-document library. Upload new manuals without overwriting existing files.
                </p>
              </div>

              <button type="button" className="primary-button" onClick={openUpload}>
                <Plus size={18} />
                <span>Upload New PDF</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Search uploaded manuals..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <span className="text-xs font-semibold text-slate-500">
                {filteredDocs.length} Manual{filteredDocs.length === 1 ? '' : 's'} Total
              </span>
            </div>

            {filteredDocs.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
                <FolderOpen size={36} className="mx-auto text-indigo-400 mb-3 opacity-80" />
                <h3 className="font-bold text-slate-900 text-sm mb-1">No documents found</h3>
                <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                  Upload your PDF product manuals to search, index, and chat with their content.
                </p>
                <button type="button" className="primary-button" onClick={openUpload}>
                  <Plus size={16} />
                  <span>Upload Manual</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredDocs.map((doc) => {
                  const isActive = manual?.id === doc.id
                  return (
                    <div
                      key={doc.id}
                      className={`p-5 rounded-2xl bg-white border shadow-sm transition-all hover:shadow-md flex flex-col justify-between gap-4 ${
                        isActive ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-sm font-bold text-slate-900 truncate block">
                              {doc.name}
                            </strong>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            {doc.pages} Pages · {doc.words.toLocaleString()} Words · {doc.chunks} Searchable Chunks
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                        <button
                          type="button"
                          className="font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5"
                          onClick={() => {
                            setManual(doc)
                            navigate('chat')
                          }}
                        >
                          <MessageSquareText size={15} />
                          Open Chat
                        </button>

                        <button
                          type="button"
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1 disabled:opacity-50"
                          disabled={deletingDocId === doc.id}
                          onClick={() => removeDocument(doc.id)}
                          title={deletingDocId === doc.id ? 'Deleting document...' : 'Delete document'}
                        >
                          {deletingDocId === doc.id ? (
                            <LoaderCircle className="spin text-rose-500" size={16} />
                          ) : (
                            <Trash2 size={16} />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )

      case 'chat':
        return (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  AI CHAT WORKSPACE
                </div>

                <h1>
                  Chat with <span>your manual.</span>
                </h1>

                <p className="subtitle">
                  Ask questions in any language and explore relevant passages from your uploaded PDF.
                </p>
              </div>
            </div>

            {renderChat()}
          </>
        )

      case 'history':
        return (
          <div className="animate-entrance space-y-6">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  CONVERSATION PERSISTENCE
                </div>
                <h1>
                  Chat <span>History.</span>
                </h1>
                <p className="subtitle">
                  Review and reopen your previous grounded chat sessions.
                </p>
              </div>
            </div>

            {conversations.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
                <Clock3 size={36} className="mx-auto text-indigo-400 mb-3 opacity-80" />
                <h3 className="font-bold text-slate-900 text-sm mb-1">No conversation history yet</h3>
                <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                  Start asking questions about your PDF manual to save persistent multi-turn conversations.
                </p>
                <button type="button" className="primary-button" onClick={() => navigate('chat')}>
                  <MessageSquareText size={16} />
                  <span>Start Chat</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-indigo-300 transition-all flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <MessageSquareText size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <strong className="text-xs font-bold text-slate-900 truncate block">
                          {conv.title}
                        </strong>
                        <span className="text-[11px] text-slate-500 block truncate">
                          {conv.document_name || 'Product Manual'} · Updated {new Date(conv.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-colors"
                        onClick={() => openConversation(conv.id)}
                      >
                        Reopen Chat
                      </button>
                      <button
                        type="button"
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                        onClick={() => deleteConversation(conv.id)}
                        title="Delete conversation"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'collections':
        return (
          <div className="animate-entrance space-y-6">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  ORGANIZATION
                </div>
                <h1>
                  Document <span>Collections.</span>
                </h1>
                <p className="subtitle">
                  Group related product manuals into custom workspace categories.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateCollection} className="flex gap-2 max-w-md bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Collection name (e.g. Home Appliances)..."
                className="flex-1 px-3 py-1.5 text-xs outline-none"
              />
              <button type="submit" className="primary-button" style={{ marginTop: 0, padding: '6px 14px', fontSize: '12px' }}>
                <Plus size={15} />
                Create
              </button>
            </form>

            {collections.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
                <FolderOpen size={36} className="mx-auto text-indigo-400 mb-3 opacity-80" />
                <h3 className="font-bold text-slate-900 text-sm mb-1">No collections created yet</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Organize manuals into collections to group appliances, tools, or enterprise equipment.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {collections.map((col) => (
                  <div key={col.id} className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2">
                    <div className="flex items-center gap-2">
                      <FolderOpen size={18} className="text-indigo-600" />
                      <strong className="text-xs font-bold text-slate-900">{col.name}</strong>
                    </div>
                    <p className="text-xs text-slate-500">{col.description || 'Custom Document Group'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )

      case 'analytics':
        return (
          <div className="animate-entrance space-y-6">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  REAL METRICS
                </div>
                <h1>
                  Usage <span>Analytics.</span>
                </h1>
                <p className="subtitle">
                  Real document processing, indexing, and grounded query metrics.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 block">TOTAL MANUALS</span>
                <strong className="text-2xl font-black text-slate-900 block">{analytics?.total_documents ?? 0}</strong>
                <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                  <CheckCircle2 size={12} /> Real Indexed Files
                </span>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 block">PAGES INDEXED</span>
                <strong className="text-2xl font-black text-slate-900 block">{analytics?.total_pages ?? 0}</strong>
                <span className="text-[10px] text-indigo-600 font-bold flex items-center gap-1">
                  <FileText size={12} /> Processed Pages
                </span>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 block">FAISS VECTOR CHUNKS</span>
                <strong className="text-2xl font-black text-slate-900 block">{analytics?.total_chunks ?? 0}</strong>
                <span className="text-[10px] text-purple-600 font-bold flex items-center gap-1">
                  <Layers3 size={12} /> Search Chunks
                </span>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
                <span className="text-[11px] font-semibold text-slate-400 block">QUESTIONS ASKED</span>
                <strong className="text-2xl font-black text-slate-900 block">{analytics?.total_questions ?? 0}</strong>
                <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                  <Bot size={12} /> Grounded Answers
                </span>
              </div>
            </div>
          </div>
        )

      case 'settings':
        return (
          <div className="animate-entrance space-y-6 max-w-2xl">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  WORKSPACE PREFERENCES
                </div>
                <h1>
                  Account <span>Settings.</span>
                </h1>
                <p className="subtitle">
                  Manage your authentication session and workspace settings.
                </p>
              </div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-lg shadow-md overflow-hidden">
                  {user && !user.is_guest && user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.full_name || 'User'} className="w-full h-full object-cover" />
                  ) : (
                    user && !user.is_guest ? getSingleInitial(user.full_name, user.email) : 'G'
                  )}
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">
                    {user && !user.is_guest ? user.full_name || user.email : 'Guest User'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {user && !user.is_guest ? user.email : 'Local Session Workspace'}
                  </p>
                  <span className="inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                    {isSupabaseConfigured ? 'Supabase Auth Connected' : 'Local Session Mode'}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <strong className="text-xs font-bold text-slate-900 block">Authentication Session</strong>
                  <span className="text-[11px] text-slate-500">
                    {user && !user.is_guest
                      ? 'Signed in with Supabase Workspace Account'
                      : user?.is_guest
                      ? 'Active local guest session.'
                      : 'Sign in to sync manuals across devices.'}
                  </span>
                </div>

                {user && !user.is_guest ? (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="px-4 py-2 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition-colors flex items-center gap-1.5"
                  >
                    <LogOut size={15} />
                    Sign Out
                  </button>
                ) : user?.is_guest ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthModalOpen(true)}
                      className="primary-button"
                      style={{ marginTop: 0, padding: '8px 14px', fontSize: '12px' }}
                    >
                      <LogIn size={15} />
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="px-3 py-2 bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-700 border border-slate-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                    >
                      <LogOut size={15} />
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    className="primary-button"
                    style={{ marginTop: 0, padding: '8px 16px', fontSize: '12px' }}
                  >
                    <LogIn size={15} />
                    Sign In
                  </button>
                )}
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  function renderUnauthenticatedLanding() {
    return (
      <div className="animate-entrance max-w-4xl mx-auto py-10 px-4 text-center">
        <div className="page-heading" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              <span className="live-dot" />
              DOCUMENT INTELLIGENCE
            </div>

            <h1 style={{ fontSize: 'clamp(28px, 4.5vw, 42px)', lineHeight: 1.15 }}>
              Your manuals. Your questions. <span>Instant answers.</span>
            </h1>

            <p className="subtitle" style={{ maxWidth: '560px', margin: '14px auto 0' }}>
              Upload product manuals, ask questions in natural language, and find accurate answers grounded in your documentation.
            </p>

            <p className="text-xs text-slate-500 font-medium mt-2">
              Sign in to save and access your documents and conversations across sessions.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 mt-8 mb-4">
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-xs shadow-lg hover:shadow-indigo-500/25 transition-all flex items-center justify-center gap-2"
              >
                <LogIn size={17} />
                Sign In to Workspace
              </button>

              <button
                type="button"
                onClick={startGuestSession}
                className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <User size={17} />
                Continue as Guest
              </button>
            </div>
          </div>

          <div className="heading-art floating-doc-art" aria-hidden="true" style={{ margin: '24px auto 0' }}>
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-book" style={{ boxShadow: '0 0 35px rgba(99, 102, 241, 0.35)' }}>
              <BookOpen size={36} />
            </div>
            <span className="art-spark spark-one">✳</span>
            <span className="art-spark spark-two">✦</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left mt-10">
          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3 font-bold text-xs border border-indigo-100">
              1
            </div>
            <strong className="block text-xs font-bold text-slate-900 mb-1">Multi-Document RAG</strong>
            <p className="text-xs text-slate-500">Vector search across your entire documentation library with FAISS index.</p>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3 font-bold text-xs border border-purple-100">
              2
            </div>
            <strong className="block text-xs font-bold text-slate-900 mb-1">Grounded AI Answers</strong>
            <p className="text-xs text-slate-500">Extractive grounding and context compression powered by Gemini.</p>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3 font-bold text-xs border border-emerald-100">
              3
            </div>
            <strong className="block text-xs font-bold text-slate-900 mb-1">Account Isolation</strong>
            <p className="text-xs text-slate-500">Strictly isolated user accounts with Supabase PostgreSQL and RLS.</p>
          </div>
        </div>
      </div>
    )
  }

  const pageTitles: Record<Page, string> = {
    dashboard: 'Dashboard',
    documents: 'My Documents',
    chat: 'Chat Workspace',
    history: 'Chat History',
    collections: 'Collections',
    analytics: 'Analytics',
    settings: 'Settings',
  }

  if (authStatus === 'initializing') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-800 p-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mb-3 shadow-sm">
          <LoaderCircle className="spin" size={24} />
        </div>
        <h3 className="font-extrabold text-slate-900 text-sm">Product Manual Assistant</h3>
        <span className="text-xs font-medium text-slate-500 mt-1">Initializing workspace session...</span>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <BrandHeader variant="topbar" onClick={() => navigate('dashboard')} />

        <div className="topbar-right">
          <span className="privacy">
            <ShieldCheck size={15} />
            {user && !user.is_guest ? 'Supabase Sync' : 'Session-only indexing'}
          </span>

          <button
            className="icon-button"
            title="Help"
            type="button"
            onClick={() => setError('Upload a PDF, then ask questions about its contents. Answers are grounded in retrieved manual excerpts.')}
          >
            <CircleHelp size={19} />
          </button>

          {user && !user.is_guest ? (
            <button
              onClick={() => navigate('settings')}
              className="w-8 h-8 rounded-full border border-indigo-200 shadow-sm overflow-hidden flex items-center justify-center bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-xs"
              title={user.full_name || 'Profile'}
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name || 'User'}
                  className="w-full h-full object-cover"
                />
              ) : (
                getSingleInitial(user.full_name, user.email)
              )}
            </button>
          ) : (
            <button
              onClick={() => openAuthModal()}
              className="avatar hover:bg-indigo-100 transition-colors"
              title="Sign In"
            >
              <User size={16} />
            </button>
          )}
        </div>
      </header>

      <div
        className={`mobile-nav-backdrop ${mobileNavOpen ? 'open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      <div className={`mobile-drawer ${mobileNavOpen ? 'open' : ''}`}>
        <div className="mobile-drawer-header">
          <BrandHeader variant="sidebar" onClick={() => { setMobileNavOpen(false); navigate('dashboard'); }} />
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation drawer"
          >
            <X size={18} />
          </button>
        </div>

        <Sidebar
          manual={manual}
          documents={documents}
          onSelectManual={setManual}
          onRemoveDocument={removeDocument}
          deletingDocId={deletingDocId}
          onUpload={() => { setMobileNavOpen(false); openUpload() }}
          onRemoveManual={() => manual && removeDocument(manual.id)}
          onNewChat={() => { setMobileNavOpen(false); startNewChat() }}
          activePage={activePage}
          onNavigate={(page) => { setMobileNavOpen(false); navigate(page) }}
          user={user}
          onOpenAuth={() => openAuthModal()}
          onSignOut={handleSignOut}
        />
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => upload(event.target.files?.[0])}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false)
          setAuthModalPrompt('')
        }}
        onSuccess={() => {
          setAuthStatus('authenticated')
        }}
        onGuestClick={startGuestSession}
        promptMessage={authModalPrompt}
      />

      <main className="layout">
        <Sidebar
          manual={manual}
          documents={documents}
          onSelectManual={setManual}
          onRemoveDocument={removeDocument}
          deletingDocId={deletingDocId}
          onUpload={openUpload}
          onRemoveManual={() => manual && removeDocument(manual.id)}
          onNewChat={startNewChat}
          activePage={activePage}
          onNavigate={navigate}
          user={user}
          onOpenAuth={() => openAuthModal()}
          onSignOut={handleSignOut}
        />

        <section className="main-panel">
          {authStatus === 'unauthenticated' ? (
            activePage === 'dashboard' ? (
              renderUnauthenticatedLanding()
            ) : (
              <>
                <div className="workspace-topline">
                  <span>{pageTitles[activePage]}</span>
                </div>
                <FeatureLockedCard
                  featureName={pageTitles[activePage]}
                  onOpenAuth={() => openAuthModal()}
                  onStartGuest={startGuestSession}
                />
              </>
            )
          ) : (
            <>
              <div className="workspace-topline">
                <span>{pageTitles[activePage]}</span>
              </div>
              {uploadStage !== 'idle' && (
                <div className="px-4 pt-3 pb-1">
                  <div className={`p-3.5 rounded-xl border shadow-sm transition-all flex items-center justify-between gap-3 ${
                    uploadStage === 'ready'
                      ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                      : uploadStage === 'error'
                      ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                      : 'bg-indigo-50/90 border-indigo-200 text-indigo-950'
                  }`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${
                        uploadStage === 'ready'
                          ? 'bg-emerald-600 text-white'
                          : uploadStage === 'error'
                          ? 'bg-rose-600 text-white'
                          : 'bg-indigo-600 text-white'
                      }`}>
                        {uploadStage === 'ready' ? (
                          <CheckCircle2 size={18} />
                        ) : uploadStage === 'error' ? (
                          <Info size={18} />
                        ) : (
                          <LoaderCircle className="spin" size={18} />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs font-extrabold truncate block text-slate-900">
                            {uploadStage === 'error' && uploadErrorDetail?.type === 'size_limit'
                              ? 'PDF is too large'
                              : uploadStage === 'error' && uploadErrorDetail?.type === 'page_limit'
                              ? 'PDF has too many pages'
                              : uploadingFileName || 'PDF Manual'}
                          </strong>
                          <span className={`text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                            uploadStage === 'ready'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : uploadStage === 'error'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                          }`}>
                            {uploadStage === 'uploading' && `Uploading (${uploadProgress}%)`}
                            {uploadStage === 'processing' && 'Processing document...'}
                            {uploadStage === 'indexing' && 'Indexing document...'}
                            {uploadStage === 'ready' && 'Document ready'}
                            {uploadStage === 'error' && (uploadErrorDetail?.type === 'page_limit' || uploadErrorDetail?.type === 'size_limit' ? 'Upload limit exceeded' : 'Failed')}
                          </span>
                        </div>
                        {uploadStage === 'error' && uploadErrorDetail ? (
                          <div className="mt-1.5 space-y-1">
                            <p className="text-[11.5px] font-semibold text-rose-900">
                              {uploadErrorDetail.type === 'page_limit'
                                ? uploadErrorDetail.actual && uploadErrorDetail.actual !== '50 pages'
                                  ? `This document has ${uploadErrorDetail.actual}, while the current version supports up to 50 pages.`
                                  : 'This document exceeds the 50-page limit supported in the current version.'
                                : uploadErrorDetail.type === 'size_limit'
                                ? uploadErrorDetail.actual
                                  ? `This PDF is ${uploadErrorDetail.actual}, while the current version supports files up to 10 MB.`
                                  : 'This PDF exceeds the maximum file size supported in the current version (10 MB).'
                                : uploadErrorDetail.message || 'Document processing failed. Please try again.'}
                            </p>
                            {(uploadErrorDetail.type === 'page_limit' || uploadErrorDetail.type === 'size_limit') && (
                              <>
                                <p className="text-[11px] font-bold text-rose-800">
                                  Maximum supported: {uploadErrorDetail.type === 'size_limit' ? '10 MB' : '50 pages'}
                                </p>
                                <details className="mt-1.5 group">
                                  <summary className="cursor-pointer text-[11px] font-semibold text-rose-700 hover:text-rose-900 inline-flex items-center gap-1 select-none">
                                    <span>Why is there a limit?</span>
                                    <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
                                  </summary>
                                  <div className="mt-1.5 p-2.5 bg-slate-50/90 rounded-lg border border-slate-200/80 text-[10.5px] text-slate-600 space-y-1">
                                    <p className="font-semibold text-slate-700">Why this limit?</p>
                                    <p>The deployment environment has limited memory resources. These limits help maintain reliable OCR, embedding, and indexing for all users.</p>
                                    <p className="font-semibold text-slate-700 pt-0.5">Future upgrade:</p>
                                    <p>Support for larger documents can be increased with higher server resources and further processing optimisations.</p>
                                  </div>
                                </details>
                              </>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-600 mt-0.5">
                            {uploadStage === 'uploading' && 'Transferring PDF file to server...'}
                            {uploadStage === 'processing' && 'Extracting text and structure from PDF pages...'}
                            {uploadStage === 'indexing' && 'Generating vector embeddings and building FAISS index...'}
                            {uploadStage === 'ready' && (activePage === 'chat' ? 'Document ready and selected for chat.' : 'Document indexed and ready. Click Open Chat to start asking questions.')}
                            {uploadStage === 'error' && 'Document processing failed. Please try again.'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {uploadStage === 'ready' && activePage !== 'chat' && (
                        <button
                          type="button"
                          className="primary-button"
                          style={{ marginTop: 0, padding: '6px 12px', fontSize: '12px' }}
                          onClick={openReadyChat}
                        >
                          <MessageSquareText size={14} />
                          <span>Open Chat</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                        onClick={dismissUploadStatus}
                        aria-label="Dismiss status"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {renderPage()}
            </>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')} type="button">
                <X size={16} />
              </button>
            </div>
          )}

          <footer>
            <span>PRODUCT MANUAL ASSISTANT</span>
            <i />
            Built to make product knowledge easier to find
          </footer>
        </section>
      </main>
    </div>
  )
}
