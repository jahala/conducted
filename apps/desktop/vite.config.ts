import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

// Tauri expects a fixed dev port and handles errors itself.
export default defineConfig({
	plugins: [react(), tailwindcss()],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		// Used by `pnpm test:coverage` only. It reports numbers and sets no threshold.
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/*.d.ts"],
			reporter: ["json-summary", "text-summary"],
			reportsDirectory: "./coverage",
		},
	},
});
