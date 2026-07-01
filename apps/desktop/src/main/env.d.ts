// Vite `?raw` imports return the file contents as a string. Used by the main
// process to embed static assets (e.g. design tokens for the Drop phone page)
// into the bundle at build time, so no repo source files are read at runtime.
declare module "*?raw" {
  const content: string;
  export default content;
}
