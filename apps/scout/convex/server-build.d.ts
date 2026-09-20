// Vite emits JavaScript without declarations. Its entry re-exports this package's handler.
declare module "*/dist/server/server.js" {
  const server: typeof import("@samebase/convex-tanstack-start/server").default;
  export default server;
}
