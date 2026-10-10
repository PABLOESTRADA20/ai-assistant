// app/components/CodeHighlighter.tsx
'use client'

/**
 * Resaltador de código de ARIA, pensado para cargarse de forma perezosa.
 *
 * Usa la build "light" de Prism (`PrismLight`) y registra SOLO los lenguajes
 * que ARIA usa, en vez del `Prism` completo que arrastraba todos los lenguajes
 * de `refractor` (~850 KB de fuente) al bundle inicial de `/`.
 *
 * Este módulo se importa con `React.lazy()` desde `MessageBubble`, así que todo
 * lo que hay acá (refractor + lenguajes + tema) vive en un chunk async y no
 * pesa en la carga inicial.
 *
 * Los alias cortos de cada gramática quedan registrados solos:
 * typescript→ts, javascript→js, markup→html/xml, python→py, bash→shell, etc.
 * Los lenguajes fuera de esta lista se muestran como texto plano.
 */
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'

SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('markup', markup)

interface Props {
  language: string
  code: string
}

export default function CodeHighlighter({ language, code }: Props) {
  return (
    <SyntaxHighlighter
      language={language || 'text'}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        padding: '1rem',
        fontSize: '0.8125rem',
        lineHeight: '1.6',
        background: 'var(--surface-0)',
      }}
      codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
