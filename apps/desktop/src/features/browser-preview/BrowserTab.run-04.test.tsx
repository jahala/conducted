/**
 * @feature RUN-04 BrowserTab
 * Owns: tests for the browser tab's starting and failed states, the preview setting, navigation
 * away from localhost, and the toast when the system browser cannot be opened.
 * Test first: with the server not listening the tab shows "Starting preview" and, after the
 * timeout, a Retry action.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { BrowserTab } from "./BrowserTab.tsx";

const containers: TestContainer[] = [];
const servers: Server[] = [];

afterEach(async () => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const test of containers.splice(0)) test.close();
	await Promise.all(servers.splice(0).map(close));
});

function close(server: Server): Promise<void> {
	return new Promise((resolve) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close(() => resolve());
	});
}

/** A real dev server stand-in on a port the system picks; its address is the preview URL. */
function serve(): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = createServer((_request, response) => response.end("<p>dev server</p>"));
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			servers.push(server);
			resolve(server);
		});
	});
}

const urlOf = (server: Server): string =>
	`http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** The address of a port nothing listens on: a server took it from the system and closed. */
async function closedUrl(): Promise<string> {
	const server = await serve();
	const url = urlOf(server);
	await close(server);
	return url;
}

async function setup(previewOn = true) {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, port: 5173 });
	const loaded = await test.container.services.repo.loadConfig(repo.id);
	if (!loaded.ok) throw new Error(loaded.error.message);
	test.container.services.settings.store.setState((state) => ({
		...state,
		loaded: true,
		values: { ...state.values, experimental_in_app_browser_preview: previewOn },
	}));
	return { test, workspace };
}

function renderTab(
	test: TestContainer,
	workspaceId: WorkspaceId,
	url = "http://localhost:5173",
): void {
	render(
		<ServicesProvider container={test.container}>
			<BrowserTab workspaceId={workspaceId} url={url} />
		</ServicesProvider>,
	);
}

describe("RUN-04 browser tab", () => {
	it("with the server not listening it shows Starting preview, then a Retry action", async () => {
		const { test, workspace } = await setup();
		const url = await closedUrl();
		vi.useFakeTimers();
		renderTab(test, workspace.id, url);

		expect(screen.getByText("Starting preview...")).toBeTruthy();
		act(() => {
			vi.advanceTimersByTime(20_000);
		});
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("offers opening the page in the system browser when the preview setting is off", async () => {
		const { test, workspace } = await setup(false);
		const opened = vi.spyOn(test.memory.platform.opener, "openUrl").mockResolvedValue(undefined);
		renderTab(test, workspace.id);

		expect(screen.getByText("In-app browser preview is off.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open preview in browser" }));

		await waitFor(() => expect(opened).toHaveBeenCalledWith("http://localhost:5173"));
	});

	it("opens an address on another origin in the system browser", async () => {
		const { test, workspace } = await setup();
		const opened = vi.spyOn(test.memory.platform.opener, "openUrl").mockResolvedValue(undefined);
		const url = urlOf(await serve());
		renderTab(test, workspace.id, url);

		const address = screen.getByLabelText("Address");
		fireEvent.change(address, { target: { value: "https://example.com" } });
		fireEvent.keyDown(address, { key: "Enter" });

		await waitFor(() => expect(opened).toHaveBeenCalledWith("https://example.com/"));
		expect((await screen.findByTitle("Preview")).getAttribute("src")).toBe(url);
	});

	it("shows the Couldn't open browser tab toast when the system browser fails", async () => {
		const { test, workspace } = await setup(false);
		vi.spyOn(test.memory.platform.opener, "openUrl").mockRejectedValue(new Error("no browser"));
		const toasted = vi.spyOn(toast, "error").mockReturnValue("toast-id");
		renderTab(test, workspace.id);

		fireEvent.click(screen.getByRole("button", { name: "Open preview in browser" }));

		await waitFor(() =>
			expect(toasted).toHaveBeenCalledWith("Couldn't open browser tab", expect.anything()),
		);
	});
});
