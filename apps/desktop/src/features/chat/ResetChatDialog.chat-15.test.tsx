/**
 * @feature CHAT-15 Revert to a turn
 * Tests the reset dialog over the real container: it counts the files changed since the turn
 * started (useChangedSinceTurn), the checkbox is remembered, Reset calls
 * sessions.revertTo for the turn, Cmd+Enter confirms, a running agent is cancelled first, a
 * failed cancel or revert keeps the dialog open with the reason, and success closes it.
 * Test first: confirming with "Also reset files" ticked calls sessions.revertTo(id, turnId).
 */
import { appError, err, ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { ResetChatDialog } from "./ResetChatDialog.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

function makeTest() {
	const created = createTestContainer();
	test = created;
	const onOpenChange = vi.fn();
	// The checkpointer's diff needs a git repository; the count it reports is what the dialog shows.
	const counted = vi
		.spyOn(created.container.services.checkpoint, "changedSinceTurn")
		.mockResolvedValue(ok(2));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const renderDialog = (options: { busy?: boolean } = {}) =>
		render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={created.container}>
					<ResetChatDialog
						open
						onOpenChange={onOpenChange}
						sessionId={"s1" as never}
						turnId={"t1" as never}
						busy={options.busy}
					/>
				</ServicesProvider>
			</QueryClientProvider>,
		);
	return { container: created.container, onOpenChange, renderDialog, counted };
}

describe("CHAT-15 reset chat dialog", () => {
	it("asks for confirmation before reverting, counting the files changed since the turn", async () => {
		const { renderDialog, container, counted } = makeTest();
		const revert = vi.spyOn(container.actions.sessions, "revertTo");
		renderDialog();

		expect(screen.getByRole("heading", { name: "Reset chat?" })).toBeTruthy();
		expect(screen.getByText("Later messages will be deleted.")).toBeTruthy();
		expect(await screen.findByText("2 files changed")).toBeTruthy();
		expect(counted).toHaveBeenCalledWith("s1", "t1");
		expect(revert).not.toHaveBeenCalled();
	});

	it("reverts to the turn and closes when Reset is pressed", async () => {
		const { renderDialog, container, onOpenChange } = makeTest();
		const revert = vi
			.spyOn(container.actions.sessions, "revertTo")
			.mockResolvedValue(ok(undefined));
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));

		await waitFor(() => expect(revert).toHaveBeenCalledWith("s1", "t1"));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(container.services.settings.get("reset_chat_also_reset_files")).toBe(false);
	});

	it("Cancel closes the dialog without reverting", () => {
		const { renderDialog, container, onOpenChange } = makeTest();
		const revert = vi.spyOn(container.actions.sessions, "revertTo");
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(revert).not.toHaveBeenCalled();
	});

	it("remembers 'Also reset files' and confirms with Cmd+Enter", async () => {
		const { renderDialog, container, onOpenChange } = makeTest();
		const revert = vi
			.spyOn(container.actions.sessions, "revertTo")
			.mockResolvedValue(ok(undefined));
		renderDialog();

		fireEvent.click(screen.getByRole("checkbox", { name: "Also reset files" }));
		expect(container.services.settings.get("reset_chat_also_reset_files")).toBe(false);

		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });

		await waitFor(() => expect(revert).toHaveBeenCalledWith("s1", "t1"));
		expect(container.services.settings.get("reset_chat_also_reset_files")).toBe(true);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("cancels a running agent before reverting", async () => {
		const { renderDialog, container, onOpenChange } = makeTest();
		const cancel = vi.spyOn(container.actions.sessions, "cancel").mockResolvedValue(ok(undefined));
		const revert = vi
			.spyOn(container.actions.sessions, "revertTo")
			.mockResolvedValue(ok(undefined));
		renderDialog({ busy: true });

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));

		await waitFor(() => expect(revert).toHaveBeenCalledWith("s1", "t1"));
		expect(cancel).toHaveBeenCalledWith("s1");
		expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
			revert.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("keeps the dialog open with the reason when the revert fails", async () => {
		const { renderDialog, container, onOpenChange } = makeTest();
		vi.spyOn(container.actions.sessions, "revertTo").mockResolvedValue(
			err(
				appError(
					"checkpoint_restore_failed",
					"No changes or conversation history have been reverted.",
				),
			),
		);
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));

		expect(
			await screen.findByText("No changes or conversation history have been reverted."),
		).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("does not revert when the running agent cannot be cancelled", async () => {
		const { renderDialog, container, onOpenChange } = makeTest();
		vi.spyOn(container.actions.sessions, "cancel").mockResolvedValue(
			err(appError("sidecar_offline", "The sidecar is not running.")),
		);
		const revert = vi.spyOn(container.actions.sessions, "revertTo");
		renderDialog({ busy: true });

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));

		expect(await screen.findByText("The sidecar is not running.")).toBeTruthy();
		expect(revert).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
