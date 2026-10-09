'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import NeuralNetwork from '../NeuralNetwork'

const AriaScene = dynamic(() => import('./AriaScene'), { ssr: false })

/** Por qué la escena 3D está visible u oculta (para el tooltip del toggle). */
export type SceneStatus = 'off' | 'ok' | 'static' | 'webgl' | 'init-failed'

interface CountachViewerProps {
  className?: string
  opacity?: number
  neuralOpacity?: number
  /** Override externo del flag `aria_3d_enabled` (p.ej. el toggle del header). */
  enabled?: boolean
  /** Reporta el estado de la escena para que el header explique el porqué. */
  onStatusChange?: (status: SceneStatus) => void
}

/**
 * Visor del Countach: muestra la escena 3D reactiva cuando está habilitada
 * (flag `aria_3d_enabled`) y respeta `prefers-reduced-motion`.
 * Por defecto está APAGADO. Si falla WebGL o está deshabilitado → fallback
 * al fondo NeuralNetwork existente (sin romper nada).
 *
 * Nota (bug arreglado): la detección de WebGL corre SIEMPRE, también cuando el
 * toggle del header manda `enabled` — antes se salteaba y un navegador sin
 * WebGL dejaba el hueco vacío en silencio.
 */
export default function CountachViewer({
  className = '',
  opacity = 0.6,
  neuralOpacity = 0.4,
  enabled: enabledOverride,
  onStatusChange,
}: CountachViewerProps) {
  const [enabled, setEnabled] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [webglOk, setWebglOk] = useState(true)
  const [sceneFailed, setSceneFailed] = useState(false)

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
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      setWebglOk(Boolean(gl))
    } catch {
      setWebglOk(false)
    }
  }, [])

  useEffect(() => {
    if (enabledOverride !== undefined) return
    try {
      setEnabled(localStorage.getItem('aria_3d_enabled') === '1')
    } catch {
      setEnabled(false)
    }
  }, [enabledOverride])

  const active = enabledOverride ?? enabled
  const wants3D = active && webglOk && !sceneFailed

  // Identidad estable: si fuera un arrow inline, AriaScene re-iniciaría la
  // escena en cada render del padre (el `init` depende de este callback).
  const handleSceneError = useCallback(() => setSceneFailed(true), [])

  const status: SceneStatus = !active
    ? 'off'
    : !webglOk
      ? 'webgl'
      : sceneFailed
        ? 'init-failed'
        : reduceMotion
          ? 'static'
          : 'ok'

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  return (
    <div className={`absolute inset-0 ${className}`} aria-hidden>
      {wants3D ? (
        <AriaScene
          enabled={wants3D}
          opacity={opacity}
          modelOpacity={0.95}
          autoSpin={!reduceMotion}
          reduceMotion={reduceMotion}
          onError={handleSceneError}
        />
      ) : (
        <NeuralNetwork opacity={neuralOpacity} />
      )}
    </div>
  )
}