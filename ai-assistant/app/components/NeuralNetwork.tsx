// app/components/NeuralNetwork.tsx
'use client'

import { useEffect, useRef } from 'react'

interface Props {
  /** Opacidad global de la red (0-1). */
  opacity?: number
  /** Color base como "r,g,b". Por defecto, el rojo de ARIA. */
  color?: string
  className?: string
}

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

/**
 * Fondo de "red neuronal" en canvas 2D.
 *
 * Es la versión liviana del visual del mockup: nodos que se mueven y se unen
 * con líneas cuando están cerca. Sin Three.js ni WebGL, así que corre bien en
 * el celular y no suma peso al bundle. Respeta `prefers-reduced-motion`
 * (dibuja un fotograma fijo, sin animación).
 *
 * Se posiciona `absolute` dentro del contenedor padre, que debe ser `relative`.
 */
export default function NeuralNetwork({ opacity = 0.4, color = '255,46,77', className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const parent = canvas.parentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 1
    let height = 1
    let nodes: Node[] = []
    let raf = 0
    let running = true

    const buildNodes = () => {
      const count = Math.max(12, Math.min(64, Math.round((width * height) / 24000)))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: 1 + Math.random() * 1.4,
      }))
    }

    const resize = () => {
      const rect = parent?.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect?.width || window.innerWidth))
      height = Math.max(1, Math.floor(rect?.height || window.innerHeight))
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildNodes()
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      const link = Math.min(150, Math.max(90, Math.min(width, height) * 0.22))

      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        if (n.x < 0 || n.x > width) n.vx *= -1
        if (n.y < 0 || n.y > height) n.vy *= -1
      }

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < link) {
            ctx.strokeStyle = `rgba(${color},${(1 - d / link) * 0.55})`
            ctx.lineWidth = 0.6
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }

      for (const n of nodes) {
        ctx.fillStyle = `rgba(${color},0.85)`
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const frame = () => {
      if (!running) return
      draw()
      raf = requestAnimationFrame(frame)
    }

    resize()
    if (reduce) {
      draw()
    } else {
      raf = requestAnimationFrame(frame)
    }

    const ro = new ResizeObserver(() => {
      resize()
      if (reduce) draw()
    })
    if (parent) ro.observe(parent)
    window.addEventListener('resize', resize)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [color])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}
