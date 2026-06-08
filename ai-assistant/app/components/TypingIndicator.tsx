// app/components/TypingIndicator.tsx
'use client'

export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl rounded-tl-sm"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block w-1.5 h-1.5 rounded-full"
            style={{
              background: 'var(--accent)',
              animation: `typing 1.4s infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        ARIA está escribiendo
      </span>
    </div>
  )
}
