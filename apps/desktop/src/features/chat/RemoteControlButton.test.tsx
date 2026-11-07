import type { RemoteControlStatus, SessionConfig } from "@conducted/protocol";
import { ok, type SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { RemoteControlButton } from "./RemoteControlButton.tsx";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const SESSION_URL = "https://claude.ai/code/session_1";

const config = (over: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...over,
});

async function setup(over: Partial<SessionConfig> = {}) {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, config(over));
	if (!created.ok) throw new Error("could not create a chat");
	// The sidecar is not running in these tests; the status comes from the store.
	const refresh = vi
		.spyOn(test.container.services.sessions, "refreshRemoteControl")
		.mockResolvedValue(ok(undefined));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { test, sessionId: created.value.id, wrapper, refresh };
}

function show(test: TestContainer, sessionId: SessionId, status: RemoteControlStatus): void {
	test.container.services.sessions.applyRemoteControlState(sessionId, status);
}

describe("RC-02 Remote Control switch and status", () => {
	it("is offered on a Claude chat and not on another agent's", async () => {
		const claude = await setup();
		try {
			render(<RemoteControlButton sessionId={claude.sessionId} />, { wrapper: claude.wrapper });
			expect(screen.getByRole("button", { name: "Remote Control" })).toBeTruthy();
		} finally {
			claude.test.close();
		}
		cleanup();
		const codex = await setup({ agent: "codex", model: "gpt-5" });
		try {
			render(<RemoteControlButton sessionId={codex.sessionId} />, { wrapper: codex.wrapper });
			expect(screen.queryByRole("button", { name: "Remote Control" })).toBeNull();
		} finally {
			codex.test.close();
		}
	});

	it("turns the chat's switch on through its config", async () => {
		const { test, sessionId, wrapper } = await setup();
		try {
			const updateConfig = vi
				.spyOn(test.container.services.sessions, "updateConfig")
				.mockResolvedValue(ok(undefined));
			render(<RemoteControlButton sessionId={sessionId} />, { wrapper });
			fireEvent.click(screen.getByRole("button", { name: "Remote Control" }));
			fireEvent.click(await screen.findByRole("switch", { name: "Remote Control" }));
			await waitFor(() =>
				expect(updateConfig).toHaveBeenCalledWith(sessionId, config({ remoteControl: true })),
			);
		} finally {
			test.close();
		}
	});

	it("asks for the status of a chat whose switch is on", async () => {
		const { test, sessionId, wrapper, refresh } = await setup({ remoteControl: true });
		try {
			render(<RemoteControlButton sessionId={sessionId} />, { wrapper });
			await waitFor(() => expect(refresh).toHaveBeenCalledWith(sessionId));
		} finally {
			test.close();
		}
	});

	it("shows the connection state and the link to open or copy", async () => {
		const { test, sessionId, wrapper } = await setup({ remoteControl: true });
		try {
			const open = vi.spyOn(test.memory.platform.opener, "openUrl").mockResolvedValue(undefined);
			const copy = vi
				.spyOn(test.container.services.system, "copyText")
				.mockResolvedValue(ok(undefined));
			show(test, sessionId, { state: "connected", sessionUrl: SESSION_URL });
			render(<RemoteControlButton sessionId={sessionId} />, { wrapper });
			const trigger = screen.getByRole("button", { name: "Remote Control" });
			expect(trigger.getAttribute("aria-pressed")).toBe("true");
			fireEvent.click(trigger);

			expect(await screen.findByText("Connected")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Open in Claude" }));
			await waitFor(() => expect(open).toHaveBeenCalledWith(SESSION_URL));
			fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
			await waitFor(() => expect(copy).toHaveBeenCalledWith(SESSION_URL));
		} finally {
			test.close();
		}
	});

	it("says why a chat cannot use Remote Control", async () => {
		const { test, sessionId, wrapper } = await setup({ remoteControl: true });
		try {
			show(test, sessionId, {
				state: "unavailable",
				detail: "Remote Control needs a claude.ai login. This chat runs on an API key.",
			});
			render(<RemoteControlButton sessionId={sessionId} />, { wrapper });
			fireEvent.click(screen.getByRole("button", { name: "Remote Control" }));
			expect(await screen.findByText("Not available")).toBeTruthy();
			expect(
				screen.getByText("Remote Control needs a claude.ai login. This chat runs on an API key."),
			).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Open in Claude" })).toBeNull();
		} finally {
			test.close();
		}
	});
});
