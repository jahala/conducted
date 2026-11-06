/**
 * @feature CHAT-04 Follow-up queue
 * Owns: the queue box above the composer and its row actions, drag reorder and keys.
 * Behaviour: ui-map.md 3.4, 5.4 (queue box, row actions, reorder by drag, E, Backspace, Enter,
 * Escape and Cmd+Enter), sessions-and-chats.md "While the agent is working".
 * Test first: Deleting a queued message calls sessions.queue.remove(id); a failure restores the
 * row and shows 'Failed to delete queued message'.
 */
import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Session } from "../../core/model.ts";
import {
	createTestContainer,
	seedFailedQueuedMessage,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { QueueBox } from "./QueueBox.tsx";

let open: TestContainer | null = null;

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

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}

async function setup(config: SessionConfig = CONFIG): Promise<{
	test: TestContainer;
	session: Session;
}> {
	const test = createTestContainer();
	open = test;
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, config));
	// The box lives in ChatPane, which marks its chat as the one on screen when it mounts. The queue
	// keys are chat commands, and a chat command runs only while a chat is open (command-runner.ts).
	test.container.services.sessions.setViewing(session.id);
	return { test, session };
}

function renderBox(test: TestContainer, sessionId: Session["id"]): void {
	render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<QueueBox sessionId={sessionId} />
			</CommandDispatcher>
		</ServicesProvider>,
	);
}

async function add(
	test: TestContainer,
	sessionId: Session["id"],
	text: string,
	attachmentPaths: string[] = [],
): Promise<string> {
	const row = must(
		await test.container.services.followUpQueue.enqueue({
			sessionId,
			text,
			attachmentPaths,
			delivery: "queue",
		}),
	);
	return row.id;
}

const dropData = (id: string) => ({
	getData: (type: string) =>
		type === "application/x-conducted-queued-message" || type === "text/plain" ? id : "",
	setData: vi.fn(),
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (open !== null) {
		open.close();
		open = null;
	}
});

describe("CHAT-04 queue box", () => {
	it("renders nothing for an empty queue", async () => {
		const { test, session } = await setup();
		renderBox(test, session.id);
		await Promise.resolve();
		expect(screen.queryByRole("listbox", { name: "Queued messages" })).toBeNull();
	});

	it("lists rows, their attachments and an editing banner", async () => {
		const { test, session } = await setup();
		await add(test, session.id, "First follow-up", ["/tmp/shot.png", "notes.md"]);
		renderBox(test, session.id);

		const list = await screen.findByRole("listbox", { name: "Queued messages" });
		expect(within(list).getByText("First follow-up")).toBeTruthy();
		const attachments = within(list).getByLabelText("Queued attachments");
		expect(within(attachments).getByText("shot.png")).toBeTruthy();
		expect(within(attachments).getByText("notes.md")).toBeTruthy();

		fireEvent.click(within(list).getByRole("button", { name: "Edit" }));
		expect(screen.getByText("Editing queued message")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save edit" })).toBeTruthy();
	});

	it("deletes the queued message through the action", async () => {
		const { test, session } = await setup();
		const id = await add(test, session.id, "Delete me");
		const remove = vi.spyOn(test.container.actions.sessions.queue, "remove");
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

		await waitFor(() => expect(remove).toHaveBeenCalledWith(id));
		await waitFor(() =>
			expect(test.container.services.followUpQueue.store.getState().bySession[session.id]).toEqual(
				[],
			),
		);
	});

	it("keeps the row and shows 'Failed to delete queued message' when the delete fails", async () => {
		const { test, session } = await setup();
		await add(test, session.id, "Keep me");
		vi.spyOn(test.container.actions.sessions.queue, "remove").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

		await waitFor(() =>
			expect(toasted).toHaveBeenCalledWith("Failed to delete queued message", {
				description: "The database is locked.",
			}),
		);
		expect(screen.getByText("Keep me")).toBeTruthy();
		expect(
			test.container.services.followUpQueue.store.getState().bySession[session.id],
		).toHaveLength(1);
	});

	it("saves an edited message", async () => {
		const { test, session } = await setup();
		const id = await add(test, session.id, "Old words");
		const edit = vi.spyOn(test.container.actions.sessions.queue, "edit");
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Queued message text"), {
			target: { value: "New words" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

		await waitFor(() => expect(edit).toHaveBeenCalledWith(id, "New words"));
		expect(await screen.findByText("New words")).toBeTruthy();
		expect(screen.queryByText("Editing queued message")).toBeNull();
	});

	it("sends a queued message now as a steer", async () => {
		const { test, session } = await setup();
		const id = await add(test, session.id, "Steer me");
		const steer = vi
			.spyOn(test.container.actions.sessions.queue, "sendNowAsSteer")
			.mockResolvedValue(ok(undefined));
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Steer" }));

		await waitFor(() => expect(steer).toHaveBeenCalledWith(id));
	});

	it("shows the steer error when sending now fails", async () => {
		const { test, session } = await setup();
		await add(test, session.id, "Cannot steer");
		vi.spyOn(test.container.actions.sessions.queue, "sendNowAsSteer").mockResolvedValue(
			err(appError("steer_unsupported", "This agent cannot be steered.")),
		);
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Steer" }));

		await waitFor(() =>
			expect(toasted).toHaveBeenCalledWith("Failed to steer queued message", {
				description: "This agent cannot be steered.",
			}),
		);
	});

	it("retries a failed message through the action", async () => {
		const { test, session } = await setup();
		const id = await seedFailedQueuedMessage(
			test.container,
			session.id,
			"Send me again",
			"offline",
		);
		const retry = vi.spyOn(test.container.actions.sessions.queue, "retry");
		renderBox(test, session.id);

		expect(await screen.findByText("offline")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => expect(retry).toHaveBeenCalledWith(id));
		await waitFor(() => expect(screen.queryByText("offline")).toBeNull());
	});

	it("shows 'Failed to retry message' when the retry fails", async () => {
		const { test, session } = await setup();
		await seedFailedQueuedMessage(test.container, session.id, "Still failing", "offline");
		vi.spyOn(test.container.actions.sessions.queue, "retry").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		await waitFor(() =>
			expect(toasted).toHaveBeenCalledWith("Failed to retry message", {
				description: "The database is locked.",
			}),
		);
	});

	it("says that OpenCode and Pi cannot be steered", async () => {
		const { test, session } = await setup({
			...CONFIG,
			agent: "acp",
			acpAgent: "opencode",
		});
		await add(test, session.id, "ACP follow-up");
		renderBox(test, session.id);

		const steer = await screen.findByRole("button", { name: "Steer" });
		expect((steer as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText("This agent can't be steered")).toBeTruthy();
	});

	it("pauses the header and resumes the queue", async () => {
		const { test, session } = await setup();
		await add(test, session.id, "One");
		must(await test.container.services.followUpQueue.setPaused(session.id, true));
		renderBox(test, session.id);

		expect(await screen.findByText("Queue paused")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Resume" }));

		await waitFor(() => expect(screen.getByText("1 queued")).toBeTruthy());
		expect(
			test.container.services.sessions.store.getState().sessions[session.id]?.queuePausedAt,
		).toBeNull();
	});

	it("shows 'Failed to resume queue' when pausing or resuming fails", async () => {
		const { test, session } = await setup();
		await add(test, session.id, "One");
		must(await test.container.services.followUpQueue.setPaused(session.id, true));
		vi.spyOn(test.container.actions.sessions.queue, "setPaused").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Resume" }));

		await waitFor(() =>
			expect(toasted).toHaveBeenCalledWith("Failed to resume queue", {
				description: "The database is locked.",
			}),
		);
	});

	it("collapses and expands the queue", async () => {
		const { test, session } = await setup();
		for (const text of ["One", "Two", "Three", "Four"]) await add(test, session.id, text);
		renderBox(test, session.id);

		await screen.findByRole("listbox", { name: "Queued messages" });
		expect(screen.getAllByRole("option")).toHaveLength(3);

		fireEvent.click(screen.getByRole("button", { name: "Expand queue" }));
		expect(screen.getAllByRole("option")).toHaveLength(4);

		fireEvent.click(screen.getByRole("button", { name: "Collapse queue" }));
		expect(screen.getAllByRole("option")).toHaveLength(3);
	});

	it("starts a queue of more than three rows collapsed to the first three", async () => {
		const { test, session } = await setup();
		for (const text of ["One", "Two", "Three", "Four", "Five"]) await add(test, session.id, text);
		renderBox(test, session.id);

		await screen.findByRole("listbox", { name: "Queued messages" });
		expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
			expect.stringContaining("One"),
			expect.stringContaining("Two"),
			expect.stringContaining("Three"),
		]);
		expect(screen.queryByText("Five")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Show all 5" }));
		expect(screen.getAllByRole("option")).toHaveLength(5);

		fireEvent.click(screen.getByRole("button", { name: "Collapse queue" }));
		expect(screen.getAllByRole("option")).toHaveLength(3);
	});

	it("reorders a row by dragging it and reports a failed reorder", async () => {
		const { test, session } = await setup();
		const first = await add(test, session.id, "First");
		const second = await add(test, session.id, "Second");
		renderBox(test, session.id);

		const options = await screen.findAllByRole("option");
		fireEvent.dragStart(options[1] as HTMLElement, { dataTransfer: dropData(second) });
		fireEvent.dragOver(options[0] as HTMLElement);
		fireEvent.drop(options[0] as HTMLElement, { dataTransfer: dropData(second) });

		await waitFor(() =>
			expect(
				test.container.services.followUpQueue.store
					.getState()
					.bySession[session.id]?.map((row) => row.id),
			).toEqual([second, first]),
		);

		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		vi.spyOn(test.container.actions.sessions.queue, "reorder").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		const restored = await screen.findAllByRole("option");
		fireEvent.dragStart(restored[1] as HTMLElement, { dataTransfer: dropData(first) });
		fireEvent.dragOver(restored[0] as HTMLElement);
		fireEvent.drop(restored[0] as HTMLElement, { dataTransfer: dropData(first) });

		await waitFor(() =>
			expect(toasted).toHaveBeenCalledWith("Failed to reorder queued messages", {
				description: "The database is locked.",
			}),
		);
		expect(
			test.container.services.followUpQueue.store
				.getState()
				.bySession[session.id]?.map((row) => row.id),
		).toEqual([second, first]);
	});
});

describe("CHAT-04 queue keys", () => {
	it("edits, deletes and steers with E, Backspace and Enter", async () => {
		const { test, session } = await setup();
		const id = await add(test, session.id, "Keys row");
		const steer = vi
			.spyOn(test.container.actions.sessions.queue, "sendNowAsSteer")
			.mockResolvedValue(ok(undefined));
		const remove = vi.spyOn(test.container.actions.sessions.queue, "remove");
		renderBox(test, session.id);

		const row = await screen.findByRole("option");
		fireEvent.focus(row);
		fireEvent.keyDown(row, { key: "e" });
		expect(await screen.findByLabelText("Queued message text")).toBeTruthy();

		fireEvent.keyDown(screen.getByLabelText("Queued message text"), { key: "Escape" });
		expect(screen.queryByLabelText("Queued message text")).toBeNull();

		fireEvent.keyDown(row, { key: "Enter" });
		await waitFor(() => expect(steer).toHaveBeenCalledWith(id));

		fireEvent.keyDown(row, { key: "Backspace" });
		await waitFor(() => expect(remove).toHaveBeenCalledWith(id));
	});

	it("saves and steers with Cmd+Enter", async () => {
		const { test, session } = await setup();
		const id = await add(test, session.id, "Cmd row");
		const edit = vi.spyOn(test.container.actions.sessions.queue, "edit");
		const steer = vi
			.spyOn(test.container.actions.sessions.queue, "sendNowAsSteer")
			.mockResolvedValue(ok(undefined));
		renderBox(test, session.id);

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Queued message text"), {
			target: { value: "Changed" },
		});
		fireEvent.keyDown(screen.getByLabelText("Queued message text"), {
			key: "Enter",
			metaKey: true,
		});

		await waitFor(() => expect(edit).toHaveBeenCalledWith(id, "Changed"));
		await waitFor(() => expect(steer).toHaveBeenCalledWith(id));
	});
});
