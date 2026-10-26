import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import reactHooks from 'eslint-plugin-react-hooks'

const config = [
  ...nextCoreWebVitals,
  {
    // React Compiler rules shipped with eslint-config-next 16. These flag patterns that work today
    // (fetch-on-mount effects, functions hoisted into effects, Date.now() in render). Kept visible as
    // warnings and tracked in docs/REFACTOR_BACKLOG.md rather than rewritten during the framework upgrade.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**', 'next-env.d.ts'],
  },
]

export default config
