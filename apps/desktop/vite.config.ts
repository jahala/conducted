import { join } from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;
// CI names a folder here, and the run also writes a JUnit report into it, so
// scripts/test-report.ts can list every failed test by file (ci.yml).
const reports = process.env.CONDUCTED_TEST_REPORTS;

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
		// Two kinds of test. `unit` runs everywhere and is the default (`pnpm test`). `macos` needs
		// programs only macOS ships, such as /bin/zsh, so it runs in CI's macOS job
		// (`pnpm test:macos`).
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					exclude: [...configDefaults.exclude, "**/*.macos.test.?(c|m)[jt]s?(x)"],
				},
			},
			{ extends: true, test: { name: "macos", include: ["**/*.macos.test.?(c|m)[jt]s?(x)"] } },
		],
		...(reports
			? {
					reporters: [
						...configDefaults.reporters,
						["junit", { outputFile: join(reports, "desktop.xml") }],
					],
				}
			: {}),
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
