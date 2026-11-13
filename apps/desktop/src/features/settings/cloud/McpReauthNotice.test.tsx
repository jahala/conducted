/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the app-wide notice that a cloud MCP server needs re-authentication, as Conductor's
 * `stl` shows it: one lasting toast with Reconnect, gone once the server is connected again.
 * Test first: shows the notice for a server that needs re-auth and drops it when it recovers.
 */
import { ok } from "@conducted/shared";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { Toaster } from "../../../ui/Toast.tsx";
import { McpReauthNotice } from "./McpReauthNotice.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("CLOUD-17 the re-auth notice", () => {
	it("shows the notice for a server that needs re-auth and drops it when it recovers", async () => {
		const mounted = createTestContainer();
		test = mounted;
		mounted.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
		let status = "needs_reauth";
		mounted.memory.controls.scriptCloud((request) =>
			request.path === "/mcp-oauth"
				? ok({
						status: 200,
						body: JSON.stringify({
							callbackUrl: "https://w.example.dev/mcp-oauth/callback",
							servers: { linear: { status } },
						}),
					})
				: null,
		);
		await mounted.container.services.cloudPairing.start();
		renderWithRouter(
			<ServicesProvider container={mounted.container}>
				<McpReauthNotice />
				<Toaster />
			</ServicesProvider>,
		);
		expect(await screen.findByText("Linear MCP server needs re-authentication")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();

		status = "active";
		// Conductor reads the list again when the window gains focus.
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		await waitFor(() =>
			expect(screen.queryByText("Linear MCP server needs re-authentication")).toBeNull(),
		);
	});
});
