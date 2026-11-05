/**
 * @feature NAV-08 Global overlay host
 * Owns: tests that only one window-level overlay is mounted, that closing unmounts it, and that Cmd+K opens the
 * palette through the app root.
 * Behaviour: ui-map.md 5.1 (the palette is mounted once), 1.1 (global overlays at the root), 5.4 (Cmd+K).
 * Test first: show("palette") then show("passport") leaves only "passport" open; Cmd+K opens the palette.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer } from "../test/container.ts";
import { useOverlayStore } from "./overlay-store.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

const containers: { close(): void }[] = [];

afterEach(() => {
	cleanup();
	useOverlayStore.getState().close();
	for (const container of containers.splice(0)) container.close();
});

async function mountRoot() {
	const test = createTestContainer();
	containers.push(test);
	await test.container.services.settings.start();
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return test;
}

describe("NAV-08 GlobalOverlays", () => {
	it("replaces the palette when another overlay opens and unmounts it on close", async () => {
		await mountRoot();
		useOverlayStore.getState().show("palette");
		expect(await screen.findByPlaceholderText("Type a command or search...")).toBeTruthy();

		// Outside act(), React renders a store change only after this code yields; act() renders it now.
		act(() => useOverlayStore.getState().show("passport"));
		expect(screen.queryByPlaceholderText("Type a command or search...")).toBeNull();
		expect(useOverlayStore.getState().open).toBe("passport");

		act(() => useOverlayStore.getState().close());
		expect(useOverlayStore.getState().open).toBeNull();
	});

	it("opens the palette from Cmd+K at the app root", async () => {
		await mountRoot();
		fireEvent.keyDown(document, { key: "k", metaKey: true });
		expect(await screen.findByPlaceholderText("Type a command or search...")).toBeTruthy();
		expect(useOverlayStore.getState().open).toBe("palette");
	});
});
