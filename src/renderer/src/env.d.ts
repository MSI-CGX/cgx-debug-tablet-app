/// <reference types="vite/client" />

declare module '*.json' {
  const value: Record<string, unknown>
  export default value
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg?url' {
  const src: string
  export default src
}
