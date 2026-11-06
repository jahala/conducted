/**
 * @feature catalogue The dev server for the states catalogue
 * Owns: serving `catalogue.html` with the app's own Vite setup on a free port, and printing the
 * catalogue's address as one line, `Catalogue: <url>`, which the screenshot run reads.
 * Behaviour: not applicable, a development tool. `pnpm --dir apps/desktop catalogue` runs it.
 * Our design choice: port 0 lets the system pick a free port, so the catalogue never collides with
 * `pnpm dev` (port 1420) or with a second catalogue. Only the release build config (vite.config.ts)
 * builds the app, and its only page is index.html.
 * Test first: not applicable; scripts/catalogue/shots.ts starts it and reads the line.
 */
import type { AddressInfo } from "node:net";
import { mergeConfig, type Plugin } from "vite";
import base from "./vite.config.ts";

/** Prints where the catalogue's index page is, once the server listens. */
const printCatalogueUrl = (): Plugin => ({
	name: "catalogue-url",
	configureServer(server) {
		server.httpServer?.once("listening", () => {
			const address = server.httpServer?.address() as AddressInfo | null;
			if (address === null || address === undefined) return;
			console.log(`Catalogue: http://127.0.0.1:${address.port}/catalogue.html`);
		});
	},
});

export default mergeConfig(base, {
	plugins: [printCatalogueUrl()],
	server: { host: "127.0.0.1", port: 0, strictPort: true },
});
