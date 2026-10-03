import type { ReactNode } from 'react'
import { Bot, ChevronDown, Layers3, FileText } from 'lucide-react'
import type { Turn } from '../types'
import type { UserProfile } from './Sidebar'

type Props = {
  turn: Turn
  user?: UserProfile | null
}

function parseInlineMarkdown(text: string): ReactNode[] {
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
  const parts = text.split(regex)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{parseInlineMarkdown(part.slice(2, -2))}</strong>
    }
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
      return <strong key={index}>{parseInlineMarkdown(part.slice(2, -2))}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className="inline-code">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{parseInlineMarkdown(part.slice(1, -1))}</em>
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return <em key={index}>{parseInlineMarkdown(part.slice(1, -1))}</em>
    }
    return part
  })
}

function FormattedMarkdown({ content }: { content: string }) {
  if (!content) return null

  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let currentList: { type: 'ul' | 'ol'; items: ReactNode[] } | null = null

  const flushList = () => {
    if (currentList) {
      if (currentList.type === 'ul') {
        blocks.push(
          <ul key={`ul-${blocks.length}`} className="markdown-list">
            {currentList.items.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        )
      } else {
        blocks.push(
          <ol key={`ol-${blocks.length}`} className="markdown-list">
            {currentList.items.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ol>
        )
      }
      currentList = null
    }
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      return
    }

    if (trimmed.startsWith('#')) {
      flushList()
      const level = trimmed.match(/^#+/)?.[0].length || 1
      const text = trimmed.replace(/^#+\s*/, '')
      const inline = parseInlineMarkdown(text)
      if (level === 1) blocks.push(<h2 key={index} className="markdown-h1">{inline}</h2>)
      else if (level === 2) blocks.push(<h3 key={index} className="markdown-h2">{inline}</h3>)
      else blocks.push(<h4 key={index} className="markdown-h3">{inline}</h4>)
      return
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)/)
    if (unorderedMatch) {
      const itemContent = parseInlineMarkdown(unorderedMatch[1])
      if (currentList && currentList.type === 'ul') {
        currentList.items.push(itemContent)
      } else {
        flushList()
        currentList = { type: 'ul', items: [itemContent] }
      }
      return
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)/)
    if (orderedMatch) {
      const itemContent = parseInlineMarkdown(orderedMatch[1])
      if (currentList && currentList.type === 'ol') {
        currentList.items.push(itemContent)
      } else {
        flushList()
        currentList = { type: 'ol', items: [itemContent] }
      }
      return
    }

    flushList()
    blocks.push(
      <p key={index} className="markdown-paragraph">
        {parseInlineMarkdown(trimmed)}
      </p>
    )
  })

  flushList()

  return <div className="markdown-body">{blocks}</div>
}

export function AnswerCard({ turn, user }: Props) {
  const { reply } = turn

  const label =
    reply.mode === 'llm'
      ? 'AI · Grounded in your manual'
      : reply.mode === 'no_match'
        ? 'Manual search'
        : 'Manual excerpts'

  const getUserInitial = () => {
    if (user && !user.is_guest) {
      const name = user.full_name || user.email || ''
      return name.trim().slice(0, 1).toUpperCase() || 'U'
    }
    return 'U'
  }

  return (
    <article className="turn">
      <div className="user-question">
        {user && !user.is_guest && user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt={user.full_name || 'User'}
            className="w-6 h-6 rounded-full object-cover border border-indigo-200 shrink-0"
          />
        ) : (
          <span className="user-dot">{getUserInitial()}</span>
        )}
        <span>{turn.question}</span>
      </div>

      <div className="answer-card">
        <div className="answer-head">
          <span className="bot-icon">
            <Bot size={18} />
          </span>

          <div className="answer-heading-text">
            <strong>Answer</strong>
            <span className="answer-source">{label}</span>
          </div>
        </div>

        <div className="answer-text">
          <FormattedMarkdown content={reply.answer} />
        </div>

        {reply.sources.length > 0 && (
          <div className="source-list">
            <div className="source-heading">
              <Layers3 size={15} />
              <span>Sources in your manual</span>
              <span className="source-count">
                {reply.sources.length}
              </span>
            </div>

            {reply.sources.map((source, index) => (
              <details
                className="source-item"
                key={`${source.page}-${index}`}
              >
                <summary>
                  <span className="page-pill">
                    <FileText size={13} />
                    Page {source.page}
                  </span>

                  <span className="source-preview">
                    {source.text.slice(0, 120)}
                    {source.text.length > 120 ? '…' : ''}
                  </span>

                  <ChevronDown
                    className="source-chevron"
                    size={16}
                  />
                </summary>

                <div className="source-content">
                  <p>{source.text}</p>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
