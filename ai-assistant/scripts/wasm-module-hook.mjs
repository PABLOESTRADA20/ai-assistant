import { register } from 'node:module'
register(new URL('./wasm-resolver.mjs', import.meta.url))
