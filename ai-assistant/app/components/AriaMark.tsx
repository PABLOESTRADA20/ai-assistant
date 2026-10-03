// app/components/AriaMark.tsx
'use client'

interface Props {
  size?: number
  className?: string
}

/**
 * Marca de ARIA: una "A" hecha de nodos y conexiones (identidad "Red
 * Singularity"). Fondo transparente para usarla en cualquier superficie.
 */
export default function AriaMark({ size = 40, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      className={className}
      role="img"
      aria-label="ARIA"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="aria-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5c76" />
          <stop offset="1" stopColor="#c81e3c" />
        </linearGradient>
      </defs>
      <g stroke="url(#aria-mark-grad)" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" opacity="0.2">
        <path d="M150 404 L256 120 L362 404" />
        <path d="M188 302 L324 302" />
      </g>
      <g stroke="url(#aria-mark-grad)" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
        <path d="M150 404 L256 120 L362 404" />
        <path d="M188 302 L324 302" />
      </g>
      <g stroke="#ff2e4d" strokeWidth="4" opacity="0.55">
        <line x1="256" y1="120" x2="256" y2="64" />
        <line x1="150" y1="404" x2="116" y2="432" />
        <line x1="362" y1="404" x2="396" y2="432" />
      </g>
      <g fill="#ff2e4d" opacity="0.85">
        <circle cx="256" cy="64" r="9" />
        <circle cx="116" cy="432" r="8" />
        <circle cx="396" cy="432" r="8" />
      </g>
      <g fill="url(#aria-mark-grad)">
        <circle cx="256" cy="120" r="17" />
        <circle cx="150" cy="404" r="15" />
        <circle cx="362" cy="404" r="15" />
        <circle cx="188" cy="302" r="10" />
        <circle cx="324" cy="302" r="10" />
      </g>
      <g fill="#ffffff">
        <circle cx="256" cy="120" r="6" />
        <circle cx="150" cy="404" r="5" />
        <circle cx="362" cy="404" r="5" />
      </g>
    </svg>
  )
}
