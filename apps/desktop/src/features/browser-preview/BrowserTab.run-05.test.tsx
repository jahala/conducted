/**
 * @feature RUN-05 Annotation overlay in the browser tab
 * Owns: the test that the browser tab reaches the annotation overlay through the real container,
 * with and without a chat that can take the message.
 * Test first: a loaded preview shows the Annotate control and, with no chat, says why Add to chat
 * is unavailable.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SessionConfig } from "@conducted/protocol";
import { ok, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { BrowserTab } from "./BrowserTab.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const containers: TestContainer[] = [];
const servers: Server[] = [];

afterEach(async () => {
	cleanup();
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

async function setup(withChat: boolean) {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, port: 5173 });
	if (withChat) {
		const created = await test.container.services.sessions.create(workspace.id, CONFIG);
		if (!created.ok) throw new Error(created.error.message);
		const started = await test.container.services.sessions.start();
		if (!started.ok) throw new Error(started.error.message);
	}
	test.container.services.settings.store.setState((state) => ({
		...state,
		loaded: true,
		values: { ...state.values, experimental_in_app_browser_preview: true },
	}));
	return { test, workspace };
}

function renderTab(test: TestContainer, workspaceId: WorkspaceId, url: string): void {
	render(
		<ServicesProvider container={test.container}>
			<BrowserTab workspaceId={workspaceId} url={url} />
		</ServicesProvider>,
	);
}

async function loadedPreview(test: TestContainer, workspaceId: WorkspaceId) {
	renderTab(test, workspaceId, urlOf(await serve()));
	const frame = await screen.findByTitle("Preview");
	fireEvent.load(frame);
}

describe("RUN-05 annotation overlay in the browser tab", () => {
	it("shows the annotation control over a loaded preview and says why it cannot send without a chat", async () => {
		const { test, workspace } = await setup(false);
		await loadedPreview(test, workspace.id);

		expect(screen.getByRole("button", { name: "Annotate" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add to chat" })).toHaveProperty("disabled", true);
		expect(screen.getByText("Open a chat to add annotations.")).toBeTruthy();
	});

	it("enables the chat action once the workspace has a chat", async () => {
		const { test, workspace } = await setup(true);
		await loadedPreview(test, workspace.id);

		expect(screen.queryByText("Open a chat to add annotations.")).toBeNull();
	});

	it("sends two annotations to the workspace's chat as one message", async () => {
		const { test, workspace } = await setup(true);
		const send = vi.spyOn(test.container.actions.sessions, "send").mockResolvedValue(ok(undefined));
		renderTab(test, workspace.id, urlOf(await serve()));

		const frame = (await screen.findByTitle("Preview")) as HTMLIFrameElement;
		frame.removeAttribute("src");
		const page = frame.contentDocument;
		if (page === null) throw new Error("the preview is not scriptable");
		page.body.innerHTML = '<button id="first">First</button><button id="second">Second</button>';
		fireEvent.load(frame);

		fireEvent.click(await screen.findByRole("button", { name: "Annotate" }));
		const first = page.querySelector("#first");
		if (first === null) throw new Error("the preview has no first button");
		fireEvent.click(first);
		fireEvent.change(screen.getByLabelText("Note"), { target: { value: "First note" } });
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
		await screen.findByText("First note");

		const second = page.querySelector("#second");
		if (second === null) throw new Error("the preview has no second button");
		fireEvent.click(second);
		fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Second note" } });
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
		await screen.findByText("Second note");

		fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

		expect(send).toHaveBeenCalledOnce();
		const message = send.mock.calls[0]?.[1] ?? "";
		expect(message.indexOf("First note")).toBeLessThan(message.indexOf("Second note"));
		expect(send.mock.calls[0]?.[3]).toBe("auto");
	});
});
