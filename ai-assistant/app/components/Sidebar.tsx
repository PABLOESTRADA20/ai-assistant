// app/components/Sidebar.tsx
'use client'

import { useState } from 'react'
import { Plus, MessageSquare, Trash2, Sparkles, X, Sun, Moon } from 'lucide-react'
import { Conversation } from '@/app/types'
import clsx from 'clsx'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  isOpen: boolean
  onClose: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h}h`
  const d = Math.floor(h / 24)
  return `hace ${d}d`
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  isOpen,
  onClose,
  theme,
  onToggleTheme,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed lg:relative top-0 left-0 h-full z-30 flex flex-col transition-transform duration-300',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        style={{
          width: '260px',
          background: 'var(--surface-1)',
          borderRight: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7c6af7, #6d5ce6)' }}
            >
              <Sparkles size={14} color="#fff" />
            </div>
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              ARIA
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onToggleTheme}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:opacity-70"
              style={{ color: 'var(--text-muted)' }}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={onClose}
              className="lg:hidden w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:opacity-70"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* New chat button */}
        <div className="p-3">
          <button
            onClick={onNew}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:opacity-80 active:scale-98"
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
              border: '1px solid rgba(124,106,247,0.2)',
            }}
          >
            <Plus size={15} />
            Nueva conversación
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {conversations.length === 0 ? (
            <div className="text-center py-8 px-4">
              <MessageSquare size={24} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Sin conversaciones aún
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {[...conversations]
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .map((conv) => (
                  <div
                    key={conv.id}
                    className="relative group"
                    onMouseEnter={() => setHoveredId(conv.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <button
                      onClick={() => onSelect(conv.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150"
                      style={{
                        background:
                          activeId === conv.id
                            ? 'var(--accent-muted)'
                            : hoveredId === conv.id
                            ? 'var(--surface-2)'
                            : 'transparent',
                        border: activeId === conv.id
                          ? '1px solid rgba(124,106,247,0.2)'
                          : '1px solid transparent',
                      }}
                    >
                      <div
                        className="text-xs font-medium truncate pr-6"
                        style={{ color: activeId === conv.id ? 'var(--accent)' : 'var(--text-primary)' }}
                      >
                        {conv.title}
                      </div>
                      <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                        <span>{conv.messages.length} mensajes</span>
                        <span>·</span>
                        <span>{timeAgo(conv.updatedAt)}</span>
                      </div>
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-500/20"
                      style={{ color: '#f87171' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="p-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            ARIA v1.0 · Powered by Groq
          </p>
        </div>
      </aside>
    </>
  )
}
