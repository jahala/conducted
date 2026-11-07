/**
 * @feature PLAT-33 Platform doors for dropped files, attachments and menu shortcuts
 * Owns: the window-level drop target, mounted at the app root and fed by Platform.window.onFileDrop.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A4 (drag enter, drag over, drop,
 * drag leave) and ui-map.md 3.5 (a file can be dropped to attach it).
 * Test first: an enter event at the real root shows "Drop files to attach" and a leave hides it.
 */

import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer } from "../test/container.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

afterEach(cleanup);

describe("PLAT-33 file drop target", () => {
	it("PLAT-33 shows the drop target on enter and hides it on leave", async () => {
		const test = createTestContainer();
		try {
			const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RouterProvider router={router} />
					</AppProviders>
				</ServicesProvider>,
			);
			await router.load();

			expect(screen.queryByText("Drop files to attach")).toBeNull();

			act(() => {
				test.memory.controls.emitFileDrop({
					kind: "enter",
					paths: ["/Users/me/notes.txt", "/Users/me/photo.png"],
					x: 10,
					y: 20,
				});
			});
			expect(await screen.findByText("Drop files to attach")).toBeTruthy();

			act(() => {
				test.memory.controls.emitFileDrop({ kind: "over", x: 12, y: 24 });
			});
			expect(screen.getByText("Drop files to attach")).toBeTruthy();

			act(() => {
				test.memory.controls.emitFileDrop({ kind: "leave" });
			});
			expect(screen.queryByText("Drop files to attach")).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("PLAT-33 hides the drop target after the files are dropped", async () => {
		const test = createTestContainer();
		try {
			const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RouterProvider router={router} />
					</AppProviders>
				</ServicesProvider>,
			);
			await router.load();

			act(() => {
				test.memory.controls.emitFileDrop({ kind: "enter", paths: ["/a.txt"], x: 1, y: 2 });
			});
			expect(await screen.findByText("Drop files to attach")).toBeTruthy();

			act(() => {
				test.memory.controls.emitFileDrop({
					kind: "drop",
					paths: ["/a.txt"],
					x: 3,
					y: 4,
				});
			});
			expect(screen.queryByText("Drop files to attach")).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("PLAT-33 removes the window listener when the root unmounts", async () => {
		const test = createTestContainer();
		try {
			const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RouterProvider router={router} />
					</AppProviders>
				</ServicesProvider>,
			);
			await router.load();
			cleanup();

			expect(test.memory.controls.dispose()).toBe(0);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
