import { appError, err, ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const state = vi.hoisted(() => ({
	copyText: vi.fn(),
	cancel: vi.fn(),
	revertTo: vi.fn(),
	setSetting: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("../../ui/Toast.tsx", () => ({ toastError: state.toastError }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		app: { copyText: state.copyText },
		sessions: { cancel: state.cancel, revertTo: state.revertTo },
		settings: { set: state.setSetting },
	}),
	useSetting: () => false,
	useChangedSinceTurn: () => ({ state: "ready", data: 0 }),
}));

const { UserMessage } = await import("./UserMessage.tsx");

afterEach(() => {
	cleanup();
	state.copyText.mockReset();
	state.cancel.mockReset();
	state.revertTo.mockReset();
	state.setSetting.mockReset();
	state.toastError.mockReset();
});

/** Like `renderWithRouter`, but hands back the router so a test can read the URL state after a click. */
async function renderInRouter(ui: React.ReactNode) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{ui}</>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/?sessionId=s1"] }),
	});
	render(<RouterProvider router={router} />);
	await router.load();
	return router;
}

const sessionId = "s1" as Parameters<typeof UserMessage>[0]["sessionId"];

function turn(over: Partial<ChatTurn["userMessage"]> = {}): ChatTurn {
	return {
		turnId: "t1" as ChatTurn["turnId"],
		startedBy: "user",
		userMessage: {
			messageId: "m1" as never,
			text: "Hello there",
			attachmentPaths: [],
			at: 10,
			sender: null,
			...over,
		},
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: 10,
		endedAt: 20,
		usage: null,
		reverted: false,
	};
}

describe("CHAT-06 user message", () => {
	it("renders one item for each attachment path", async () => {
		renderWithRouter(
			<UserMessage
				turn={turn({ attachmentPaths: ["/tmp/shot.png", "/tmp/notes.txt"] })}
				sessionId={sessionId}
			/>,
		);
		expect(await screen.findByText("shot.png")).toBeTruthy();
		expect(screen.getByText("notes.txt")).toBeTruthy();
		expect(screen.getAllByTestId("attachment")).toHaveLength(2);
	});

	it("shows Retry and Discard after a failed send", async () => {
		const onRetry = vi.fn();
		const onDiscard = vi.fn();
		renderWithRouter(
			<UserMessage
				turn={turn()}
				sessionId={sessionId}
				failed={{ message: "Message not sent", error: "The network is down." }}
				onRetry={onRetry}
				onDiscard={onDiscard}
			/>,
		);
		expect(await screen.findByText("Message not sent")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onDiscard).toHaveBeenCalledTimes(1);
	});

	it("marks a message sent from another session", async () => {
		renderWithRouter(
			<UserMessage
				turn={turn({ sender: { kind: "other_chat", sessionId: "s2" as never } })}
				sessionId={sessionId}
			/>,
		);
		expect(await screen.findByText("Sent from another session")).toBeTruthy();
	});

	it("marks a message sent from Claude", async () => {
		renderWithRouter(
			<UserMessage turn={turn({ sender: { kind: "claude_ai" } })} sessionId={sessionId} />,
		);
		expect(await screen.findByText("Sent via Claude")).toBeTruthy();
	});

	it("copies the message from the right-click menu", async () => {
		state.copyText.mockResolvedValue({ ok: true, value: undefined });
		renderWithRouter(<UserMessage turn={turn()} sessionId={sessionId} />);
		fireEvent.contextMenu(await screen.findByText("Hello there"));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy message" }));
		expect(state.copyText).toHaveBeenCalledWith("Hello there");
	});

	it("turns mention tokens into chips", async () => {
		renderWithRouter(
			<UserMessage
				turn={turn({ text: "Look at ⟦file:src/app.ts⟧ and ⟦pr:12⟧" })}
				sessionId={sessionId}
			/>,
		);
		expect(await screen.findByRole("button", { name: "src/app.ts" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "PR #12" })).toBeTruthy();
	});

	it("opens the PR tab on the number the chip names, keeping the rest of the URL", async () => {
		const router = await renderInRouter(
			<UserMessage turn={turn({ text: "Check ⟦pr:12⟧" })} sessionId={sessionId} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "PR #12" }));
		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({ tab: "pr", pr: 12, sessionId: "s1" }),
		);
	});

	it("opens the file tab for a file chip", async () => {
		const router = await renderInRouter(
			<UserMessage turn={turn({ text: "See ⟦file:src/app.ts⟧" })} sessionId={sessionId} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "src/app.ts" }));
		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({
				tab: "file",
				path: "src/app.ts",
				fileMode: "diff",
			}),
		);
	});

	it("opens the reset dialog from the Revert action", async () => {
		renderWithRouter(<UserMessage turn={turn()} sessionId={sessionId} />);
		fireEvent.click(await screen.findByRole("button", { name: "Revert to before this message" }));
		expect(await screen.findByRole("heading", { name: "Reset chat?" })).toBeTruthy();
		expect(state.revertTo).not.toHaveBeenCalled();
	});

	it("reverts to the turn when the dialog is confirmed", async () => {
		state.revertTo.mockResolvedValue(ok(undefined));
		state.setSetting.mockResolvedValue(ok(undefined));
		renderWithRouter(<UserMessage turn={turn()} sessionId={sessionId} />);
		fireEvent.click(await screen.findByRole("button", { name: "Revert to before this message" }));
		fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
		await waitFor(() => expect(state.revertTo).toHaveBeenCalledWith(sessionId, "t1"));
		expect(state.toastError).not.toHaveBeenCalled();
	});

	it("tells the user when the message could not be copied", async () => {
		const error = appError("clipboard", "The clipboard is busy.");
		state.copyText.mockResolvedValue(err(error));
		renderWithRouter(<UserMessage turn={turn()} sessionId={sessionId} />);
		fireEvent.contextMenu(await screen.findByText("Hello there"));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy message" }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't copy the message", error),
		);
	});
});
