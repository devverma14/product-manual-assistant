import { useState } from 'react'
import {
  FileText,
  LoaderCircle,
  Plus,
  UploadCloud,
  ShieldCheck,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react'

type Props = {
  uploading: boolean
  progress: number
  stage?: 'idle' | 'uploading' | 'processing' | 'indexing' | 'ready' | 'error'
  fileName?: string | null
  errorDetail?: {
    type?: 'size_limit' | 'page_limit' | 'unexpected'
    message?: string
    actual?: string
    limit?: string
  } | null
  dragging: boolean
  onDragChange: (dragging: boolean) => void
  onChoose: () => void
  onFile: (file?: File) => void
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

export function UploadDropzone({
  uploading,
  progress,
  stage = 'idle',
  fileName,
  errorDetail,
  dragging,
  onDragChange,
  onChoose,
  onFile,
}: Props) {
  const [validationError, setValidationError] = useState('')
  const isBusy = uploading || (stage !== 'idle' && stage !== 'ready' && stage !== 'error')

  const handleFile = (file?: File) => {
    setValidationError('')

    if (!file) return

    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setValidationError('Please select a valid PDF document file (.pdf).')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setValidationError('PDF file is too large. Maximum allowed size is 10 MB.')
      return
    }

    onFile(file)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    onDragChange(false)

    if (isBusy) return

    const file = event.dataTransfer.files[0]
    handleFile(file)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isBusy) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setValidationError('')
      onChoose()
    }
  }

  return (
    <div
      tabIndex={isBusy ? -1 : 0}
      role="button"
      aria-label="Upload PDF product manual"
      aria-disabled={isBusy}
      className={`upload-card ${dragging ? 'dragging' : ''} ${
        isBusy ? 'uploading-state' : ''
      }`}
      onDragOver={(event) => {
        event.preventDefault()

        if (!isBusy) {
          onDragChange(true)
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        onDragChange(false)
      }}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
    >
      <div className="upload-icon" aria-hidden="true">
        {isBusy ? (
          <LoaderCircle className="spin" size={26} />
        ) : dragging ? (
          <Sparkles className="animate-pulse" size={26} />
        ) : (
          <UploadCloud size={26} />
        )}
      </div>

      <h2>
        {isBusy
          ? stage === 'uploading' || (progress > 0 && progress < 100)
            ? `Uploading ${fileName ? `"${fileName}"` : 'PDF manual'}...`
            : stage === 'processing'
            ? `Processing ${fileName ? `"${fileName}"` : 'document'}...`
            : `Indexing ${fileName ? `"${fileName}"` : 'document'}...`
          : dragging
            ? 'Release to upload PDF manual'
            : 'Start with a product manual'}
      </h2>

      <p>
        {isBusy
          ? stage === 'uploading' || (progress > 0 && progress < 100)
            ? 'Transferring PDF file to document intelligence service.'
            : stage === 'processing'
            ? 'Extracting PDF pages, cleaning text, and building searchable chunks.'
            : 'Generating vector embeddings and building FAISS search index.'
          : 'Upload any product manual to ask questions, view cited page excerpts, and troubleshoot instructions.'}
      </p>

      {!isBusy ? (
        <button
          type="button"
          className="primary-button"
          onClick={(e) => {
            e.stopPropagation()
            setValidationError('')
            onChoose()
          }}
        >
          <Plus size={18} />
          <span>Choose a PDF</span>
        </button>
      ) : (
        <div className="progress-wrap" aria-live="polite">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="PDF upload and indexing progress"
          >
            <span
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
              }}
            />
          </div>

          <span className="text-xs font-semibold text-indigo-600">
            {stage === 'uploading' || (progress > 0 && progress < 100)
              ? `Uploading ${progress}%`
              : stage === 'processing'
              ? 'Processing document...'
              : 'Indexing manual...'}
          </span>
        </div>
      )}

      {validationError && (
        <div className="upload-error" role="alert" aria-live="assertive">
          <AlertCircle size={15} />
          <span>{validationError}</span>
        </div>
      )}

      {stage === 'error' && errorDetail && (
        <div className="w-full text-left bg-rose-50/90 border border-rose-200 rounded-xl p-3.5 my-2" role="alert">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="text-rose-600 shrink-0 mt-0.5" size={18} />
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-extrabold text-rose-950">
                {errorDetail.type === 'size_limit'
                  ? 'PDF is too large'
                  : errorDetail.type === 'page_limit'
                  ? 'PDF has too many pages'
                  : 'Upload failed'}
              </h4>
              <p className="text-[11.5px] font-semibold text-rose-900 mt-0.5">
                {errorDetail.type === 'size_limit'
                  ? errorDetail.actual
                    ? `This PDF is ${errorDetail.actual}, while the current version supports files up to 10 MB.`
                    : 'This PDF exceeds the maximum file size supported in the current version (10 MB).'
                  : errorDetail.type === 'page_limit'
                  ? errorDetail.actual && errorDetail.actual !== '50 pages'
                    ? `This document has ${errorDetail.actual}, while the current version supports up to 50 pages.`
                    : 'This document exceeds the 50-page limit supported in the current version.'
                  : errorDetail.message || 'Document processing failed. Please try again.'}
              </p>
              {(errorDetail.type === 'size_limit' || errorDetail.type === 'page_limit') && (
                <>
                  <p className="text-[11px] font-bold text-rose-800 mt-1">
                    Maximum supported: {errorDetail.type === 'size_limit' ? '10 MB' : '50 pages'}
                  </p>
                  <details className="mt-2 group" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      )}

      <div className="file-note">
        <FileText size={14} />
        <span>Maximum 10 MB • Maximum 50 pages</span>
        <span className="note-dot">·</span>
        <ShieldCheck size={14} />
        <span>Session-isolated indexing</span>
      </div>

      <div className="upload-hint">
        Drag and drop your PDF here, or press Enter / Space to browse files.
      </div>
    </div>
  )
}

