/**
 * @feature SET-05 MCP servers: list, status and logs
 * Owns: the test that finishing a slash command which changes agent configuration clears the MCP
 * list cached for that chat, so the next look asks the agent again, and says Config is refreshed.
 * Behaviour: ui-map.md 3.5 ("Terminal command finished. Refresh to use the updated config here");
 * services-map.md 5B.6 (MCP status is per session and read from the agent's own config).
 * Test first: clicking Done on the /mcp command bar removes the cached list and shows
 * "Configuration refreshed.".
 */
import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { mcpKey } from "../../core/services/mcp.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	active?.close();
	active = undefined;
});

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

async function setup() {
	const test = createTestContainer();
	active = test;
	const workspace = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const key = mcpKey(workspace.path, "claude");
	test.container.services.mcp.store.setState({
		servers: { [key]: { state: "ready", data: [] } },
	});
	test.container.actions.sessions.restartAgent = vi.fn(async () => ok(undefined));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				{children}
				<Toaster />
			</CommandDispatcher>
		</ServicesProvider>
	);
	let editor: Editor | null = null;
	render(
		<Composer
			workspaceId={workspace.id}
			sessionId={session.id}
			onEditorReady={(next) => {
				editor = next;
			}}
		/>,
		{ wrapper },
	);
	await waitFor(() => expect(editor).not.toBeNull());
	return { test, key, editor: () => editor as unknown as Editor };
}

describe("SET-05 after a slash command changes config", () => {
	it("forgets the chat's MCP list and says the configuration refreshed", async () => {
		const { test, key, editor } = await setup();
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("/mcp"));
		await screen.findByRole("option", { name: /\/mcp\b/ });
		fireEvent.keyDown(textbox, { key: "Enter" });

		await screen.findByText("Complete /mcp below, then click done");
		fireEvent.click(screen.getByRole("button", { name: "Done" }));

		expect(await screen.findByText("Configuration refreshed.")).toBeTruthy();
		expect(test.container.actions.sessions.restartAgent).toHaveBeenCalledTimes(1);
		expect(test.container.services.mcp.store.getState().servers[key]).toBeUndefined();
	});

	it("says the configuration refreshed only after the agent restarts", async () => {
		const { test, key, editor } = await setup();
		test.container.actions.sessions.restartAgent = vi.fn(async () =>
			err(appError("sidecar_down", "The agent did not start.")),
		);
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("/mcp"));
		await screen.findByRole("option", { name: /\/mcp\b/ });
		fireEvent.keyDown(textbox, { key: "Enter" });

		await screen.findByText("Complete /mcp below, then click done");
		fireEvent.click(screen.getByRole("button", { name: "Done" }));

		expect(await screen.findByText("The agent did not start.")).toBeTruthy();
		expect(screen.queryByText("Configuration refreshed.")).toBeNull();
		expect(test.container.services.mcp.store.getState().servers[key]).toBeDefined();
	});
});
