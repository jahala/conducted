import type { WorkspaceId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../test/dom-polyfills.ts";
import { setCurrentWorkspace, workspaceToast } from "../ui/Toast.tsx";
import { savePanelLayout } from "./layout-persistence.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

async function openApp(path = "/") {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<AppProviders client={createQueryClient()}>
			<RouterProvider router={router} />
		</AppProviders>,
	);
	await router.load();
	return router;
}

beforeEach(() => {
	window.localStorage.clear();
	setCurrentWorkspace(null);
});
afterEach(cleanup);

describe("NAV-01 app shell", () => {
	it("shows the sidebar and the centre empty state while features are unbuilt", async () => {
		await openApp();

		expect(await screen.findByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
		expect(screen.getByRole("main")).toBeTruthy();
		expect(screen.getByText("Not built yet: PRJ-01")).toBeTruthy();
	});

	it("comes back with the sidebar collapsed when the saved layout says so", async () => {
		savePanelLayout("app-shell", { sidebar: 0, "main-content": 100 });

		await openApp();

		expect(await screen.findByRole("button", { name: "Show sidebar" })).toBeTruthy();
	});

	it("tells the toast host which workspace is open", async () => {
		await openApp("/repository/r1/workspace/w1");
		await screen.findByText("Git panel");

		let own: string | null = null;
		let other: string | null = null;
		act(() => {
			own = workspaceToast("w1" as WorkspaceId, "For this workspace");
			other = workspaceToast("w2" as WorkspaceId, "For another workspace");
		});

		expect(own).not.toBeNull();
		expect(other).toBeNull();
	});

	it("leaves Cmd+A alone inside a text field and stops it everywhere else", async () => {
		await openApp();
		await screen.findByRole("heading", { name: "Run agents side by side" });

		const pageEvent = new KeyboardEvent("keydown", {
			key: "a",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.body.dispatchEvent(pageEvent);
		expect(pageEvent.defaultPrevented).toBe(true);

		const field = document.createElement("input");
		document.body.append(field);
		field.focus();
		const fieldEvent = new KeyboardEvent("keydown", {
			key: "a",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		field.dispatchEvent(fieldEvent);
		expect(fieldEvent.defaultPrevented).toBe(false);
		field.remove();
	});
});
