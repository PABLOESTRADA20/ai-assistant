import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  {
    ignores: [
      'app/generated/**',
      '.open-next/**',
      '.wrangler/**',
      '**/*.d.mts',
    ],
  },
  ...nextVitals,
  {
    rules: {
      // Next 16 habilita las reglas experimentales de React Compiler. La app
      // sigue en React 18 y este PR solo sube dependencias: no cambia componentes.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  },
]

export default config
