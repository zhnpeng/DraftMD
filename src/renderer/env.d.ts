declare module 'katex/dist/katex.min.css?inline' {
  const css: string
  export default css
}

interface Window {
  draftmd: import('../shared/contracts').DraftMDAPI
}
