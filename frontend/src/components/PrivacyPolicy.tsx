import { ArrowLeft, ShieldCheck, Mail, Lock, FileText, Database, Globe } from 'lucide-react'
import type { Page } from '../App'

type Props = {
  onNavigate: (page: Page) => void
}

export function PrivacyPolicyPage({ onNavigate }: Props) {
  return (
    <div className="animate-entrance max-w-4xl mx-auto py-6 px-4 sm:px-6">
      <div className="mb-6 flex items-center justify-between border-b border-slate-200/80 pb-4">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-sm transition-all"
        >
          <ArrowLeft size={16} />
          <span>Back to Workspace</span>
        </button>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          <ShieldCheck size={14} className="text-emerald-600" />
          <span>Production Privacy Policy</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 space-y-8 text-slate-700">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mb-2">
            Privacy Policy
          </h1>
          <p className="text-xs font-semibold text-slate-500">
            Product Manual Assistant &bull; Last Updated: October 2026 &bull; Effective Immediately
          </p>
          <p className="text-xs text-indigo-600 font-bold mt-1">
            Production URL: https://manualassistant.vercel.app
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <ShieldCheck size={18} className="text-indigo-600" />
            1. Overview &amp; Scope
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
            Product Manual Assistant (&quot;we,&quot; &quot;our,&quot; or &quot;the Service&quot;) is committed to protecting your privacy. This Privacy Policy explains how information is collected, used, processed, and protected when you access and use our application at <strong className="text-slate-800">https://manualassistant.vercel.app</strong>.
          </p>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
            By using Product Manual Assistant, you consent to the collection and use of information in accordance with this policy. If you do not agree with any part of this policy, please discontinue use of the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <FileText size={18} className="text-indigo-600" />
            2. Information We Collect
          </h2>
          <div className="space-y-3 text-xs sm:text-sm leading-relaxed text-slate-600">
            <div>
              <strong className="block text-slate-800 mb-1">A. Authentication &amp; Account Information</strong>
              <p>When you create an account or sign in using Supabase Auth or Google OAuth, we collect your email address, full name, and avatar URL provided by the authentication service. Password credentials are managed securely by Supabase Authentication; we never store plain-text passwords.</p>
            </div>
            <div>
              <strong className="block text-slate-800 mb-1">B. Uploaded Product Manuals &amp; Documents</strong>
              <p>When you upload PDF product manuals, the file content is processed to extract text, perform OCR on image-heavy pages, and generate vector embeddings for search indexing. In authenticated mode, files are stored securely in Supabase Storage with account-isolated Row-Level Security (RLS).</p>
            </div>
            <div>
              <strong className="block text-slate-800 mb-1">C. User Queries &amp; Conversations</strong>
              <p>We process the questions you type into the workspace to retrieve relevant manual excerpts and generate answers. In authenticated mode, chat history and document metadata are stored in PostgreSQL associated with your user ID.</p>
            </div>
            <div>
              <strong className="block text-slate-800 mb-1">D. Guest &amp; Local Mode Usage</strong>
              <p>In Guest Mode, uploaded documents and conversation state remain in temporary local session storage or local server memory without requiring account registration.</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Globe size={18} className="text-indigo-600" />
            3. How Information Is Used
          </h2>
          <ul className="list-disc list-inside space-y-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <li><strong>Document Indexing &amp; RAG Retrieval:</strong> To chunk manual text, compute vector embeddings, and search candidate passages for user queries.</li>
            <li><strong>AI Answer Generation:</strong> To supply relevant document context to the Google Gemini API (<code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700">gemini-3.1-flash-lite</code>) to produce grounded answers with page citations.</li>
            <li><strong>Account Workspace Synchronization:</strong> To save your documents, conversations, and collections across user sessions.</li>
            <li><strong>Service Reliability &amp; Debugging:</strong> To log error states and manage system memory constraints cleanly.</li>
          </ul>
          <p className="text-xs sm:text-sm text-slate-600 font-semibold mt-2">
            We DO NOT sell, rent, trade, or monetize your personal data or uploaded manuals to third parties.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Database size={18} className="text-indigo-600" />
            4. Third-Party Services &amp; Subprocessors
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
            Product Manual Assistant integrates with standard cloud infrastructure providers to run the service:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
              <strong className="block text-xs font-bold text-slate-900 mb-1">Supabase</strong>
              <p className="text-xs text-slate-600">Provides database hosting (PostgreSQL), user authentication (JWT), and cloud storage for uploaded manuals with strict Row-Level Security.</p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
              <strong className="block text-xs font-bold text-slate-900 mb-1">Google Gemini API &amp; Google OAuth</strong>
              <p className="text-xs text-slate-600">Google OAuth handles optional single sign-on authentication. Google Gemini API processes context excerpts to generate grounded answers.</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Lock size={18} className="text-indigo-600" />
            5. Data Retention, Security &amp; User Rights
          </h2>
          <div className="space-y-2 text-xs sm:text-sm leading-relaxed text-slate-600">
            <p><strong>Security Practices:</strong> Data in transit is protected using TLS/SSL encryption. Database access is strictly isolated per account using Row-Level Security (RLS) policies.</p>
            <p><strong>User Data Deletion:</strong> You can delete any uploaded document or chat conversation from your workspace at any time. When deleted, the document metadata, chunk index, and stored PDF are permanently removed.</p>
            <p><strong>Account Removal Requests:</strong> To request complete deletion of your account and all associated data, contact us at <a href="mailto:devverma9451@gmail.com" className="text-indigo-600 font-semibold underline">devverma9451@gmail.com</a>.</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <ShieldCheck size={18} className="text-indigo-600" />
            6. Children&apos;s Privacy &amp; Policy Updates
          </h2>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
            The Service is not directed at children under 13 years of age. We do not knowingly collect personal information from children.
          </p>
          <p className="text-xs sm:text-sm leading-relaxed text-slate-600">
            We may update this Privacy Policy periodically. Any changes will be published on this page with an updated effective date.
          </p>
        </section>

        <section className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100 space-y-2">
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <Mail size={16} className="text-indigo-600" />
            Contact &amp; Privacy Inquiries
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            If you have questions, concerns, or data requests regarding this Privacy Policy, please contact the developer:
          </p>
          <div className="text-xs font-semibold text-slate-800">
            Developer: <span className="text-slate-900 font-bold">Dev Verma</span><br />
            Contact Email: <a href="mailto:devverma9451@gmail.com" className="text-indigo-600 underline font-bold">devverma9451@gmail.com</a><br />
            Product Manual Assistant &bull; Production Deployment: <a href="https://manualassistant.vercel.app" target="_blank" rel="noreferrer" className="text-indigo-600 underline font-bold">https://manualassistant.vercel.app</a>
          </div>
        </section>
      </div>
    </div>
  )
}
