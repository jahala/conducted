/**
 * @feature SET-05 MCP servers: list, status and logs
 * Owns: the tests for the MCP servers region on the Agents page.
 * Behaviour: ui-map.md 3.10 (list, refresh, logs), 7.2 ("No matching MCP servers.").
 * Test first: with one failed server the row shows its error and a "View log" action.
 */
import type { SessionConfig } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { McpServerView } from "../../../core/model.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../../test/container.ts";
import { McpServersPanel, McpServersSection } from "./McpServersSection.tsx";

const sessionConfig: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: false, setTargetBranch: true },
};

const server = (changes: Partial<McpServerView> = {}): McpServerView => ({
	name: "github",
	source: "user",
	transport: "stdio",
	status: "connected",
	toolCount: 4,
	error: null,
	logTail: [],
	...changes,
});

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	if (test !== undefined) {
		await test.container.sidecar.stop();
		test.close();
		test = undefined;
	}
});

describe("SET-05 MCP servers section", () => {
	it("SET-05 shows a failed server's error and a View log action", () => {
		const onViewLog = vi.fn();
		render(
			<McpServersSection
				servers={[server({ status: "failed", error: "permission denied" })]}
				hasSession
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={onViewLog}
			/>,
		);

		expect(screen.getByText("permission denied")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "View log" }));
		expect(onViewLog).toHaveBeenCalledWith("github");
	});

	it("SET-05 shows a server that needs sign-in without a sign-in button", () => {
		render(
			<McpServersSection
				servers={[server({ status: "needs_auth", error: "Sign in to GitHub." })]}
				hasSession
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={() => {}}
			/>,
		);

		expect(screen.getByText("Needs auth")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
	});

	it("SET-05 prints each source the agent reports, and a dash when it reports none", () => {
		render(
			<McpServersSection
				servers={[
					server({ name: "a", source: "local" }),
					server({ name: "b", source: "plugin" }),
					server({ name: "c", source: null }),
				]}
				hasSession
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={() => {}}
			/>,
		);

		const rows = screen.getAllByRole("row").slice(1);
		expect(rows.map((row) => row.querySelectorAll("td")[1]?.textContent)).toEqual([
			"Local",
			"Plugin",
			"—",
		]);
	});

	it("SET-05 says when no servers are configured", () => {
		render(
			<McpServersSection
				servers={[]}
				hasSession
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={() => {}}
			/>,
		);

		expect(screen.getByText("No MCP servers configured.")).toBeTruthy();
	});

	it("SET-05 filters servers and says when nothing matches", () => {
		render(
			<McpServersSection
				servers={[server(), server({ name: "linear", source: "project" })]}
				hasSession
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={() => {}}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Search MCP servers"), {
			target: { value: "linear" },
		});
		expect(screen.getByText("linear")).toBeTruthy();
		expect(screen.queryByText("github")).toBeNull();

		fireEvent.change(screen.getByLabelText("Search MCP servers"), {
			target: { value: "nothing" },
		});
		expect(screen.getByText("No matching MCP servers.")).toBeTruthy();
	});

	it("SET-05 asks for an open chat when there is none", () => {
		render(
			<McpServersSection
				servers={[]}
				hasSession={false}
				refreshing={false}
				onRefresh={() => {}}
				onViewLog={() => {}}
			/>,
		);

		expect(screen.getByText("Open a chat to see its MCP servers.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Refresh MCP status" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("SET-05 refreshes and disables the action while it runs", () => {
		const onRefresh = vi.fn();
		const { rerender } = render(
			<McpServersSection
				servers={[server()]}
				hasSession
				refreshing={false}
				onRefresh={onRefresh}
				onViewLog={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Refresh MCP status" }));
		expect(onRefresh).toHaveBeenCalledTimes(1);

		rerender(
			<McpServersSection
				servers={[server()]}
				hasSession
				refreshing
				onRefresh={onRefresh}
				onViewLog={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: "Refresh MCP status" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("SET-05 loads the open chat's servers over the real container and copies a failed log", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const created = await test.container.services.sessions.create(workspace.id, sessionConfig);
		if (!created.ok) throw new Error("could not create a session");
		test.container.services.sessions.setViewing(created.value.id);

		const request = vi.spyOn(test.container.sidecar, "request").mockResolvedValue({
			ok: true,
			value: {
				servers: [
					{
						name: "github",
						status: "failed",
						scope: "project",
						error: "permission denied",
					},
				],
			},
		});

		render(
			<ServicesProvider container={test.container}>
				<McpServersPanel />
			</ServicesProvider>,
		);

		expect(await screen.findByText("permission denied")).toBeTruthy();
		expect(request).toHaveBeenCalledWith(
			"listMcpServers",
			expect.objectContaining({
				agent: "claude",
				workspacePath: workspace.path,
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "View log" }));
		expect(await screen.findByRole("dialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy log" }));

		await waitFor(() => expect(test?.memory.controls.clipboardText).toBe("permission denied"));
	});

	it("SET-05 lists the servers of the chat last on screen once its pane closed for Settings", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const created = await test.container.services.sessions.create(workspace.id, sessionConfig);
		if (!created.ok) throw new Error("could not create a session");
		// The chat pane records the chat it shows, and clears it when it unmounts. Settings is a
		// page of its own, so opening it unmounts every chat pane first.
		test.container.services.sessions.setViewing(created.value.id);
		test.container.services.sessions.setViewing(null);

		vi.spyOn(test.container.sidecar, "request").mockResolvedValue({
			ok: true,
			value: { servers: [{ name: "linear", status: "needs_auth", scope: "user" }] },
		});

		render(
			<ServicesProvider container={test.container}>
				<McpServersPanel />
			</ServicesProvider>,
		);

		expect(await screen.findByText("linear")).toBeTruthy();
		expect(screen.queryByText("Open a chat to see its MCP servers.")).toBeNull();
	});
});
