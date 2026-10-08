'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import NeuralNetwork from '../NeuralNetwork'

const AriaScene = dynamic(() => import('./AriaScene'), { ssr: false })

interface CountachViewerProps {
  className?: string
  opacity?: number
  neuralOpacity?: number
  /** Override externo del flag `aria_3d_enabled` (p.ej. el toggle del header). */
  enabled?: boolean
}

/**
 * Visor del Countach: muestra la escena 3D reactiva cuando está habilitada
 * (flag `aria_3d_enabled`) y respeta `prefers-reduced-motion`.
 * Por defecto está APAGADO. Si falla WebGL o está deshabilitado → fallback
 * al fondo NeuralNetwork existente (sin romper nada).
 */
export default function CountachViewer({
  className = '',
  opacity = 0.6,
  neuralOpacity = 0.4,
  enabled: enabledOverride,
}: CountachViewerProps) {
  const [enabled, setEnabled] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [webglOk, setWebglOk] = useState(true)

  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      setReduceMotion(mq.matches)
      const onChange = () => setReduceMotion(mq.matches)
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (enabledOverride !== undefined) return
    try {
      const stored = localStorage.getItem('aria_3d_enabled')
      setEnabled(stored === '1')
    } catch {
      setEnabled(false)
    }
    // detectar WebGL
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      if (!gl) setWebglOk(false)
    } catch {
      setWebglOk(false)
    }
  }, [enabledOverride])

  const show3D = (enabledOverride ?? enabled) && webglOk && !reduceMotion

  return (
    <div className={`absolute inset-0 ${className}`} aria-hidden>
      {show3D ? (
        <AriaScene enabled={show3D} opacity={opacity} modelOpacity={0.95} autoSpin reduceMotion={reduceMotion} />
      ) : (
        <NeuralNetwork opacity={neuralOpacity} />
      )}
    </div>
  )
}
