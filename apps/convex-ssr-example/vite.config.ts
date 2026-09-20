import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { convexSsr } from "@samebase/convex-tanstack-start/vite";

export default defineConfig({
  plugins: [convexSsr(), tanstackStart({ prerender: { enabled: false } }), react()],
});
