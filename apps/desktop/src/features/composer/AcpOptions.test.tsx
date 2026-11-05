/**
 * @feature AGENT-17 ACP chat options beyond the model
 * Behaviour: other-runners.md sections 2.2 and 5, services-map.md 2.5.2 and 5B.5.4, and the two
 * toasts in ui-map.md (saved options that cannot be loaded).
 * Must handle: an ACP chat's switch and select options, a chat that is not ACP, a failed load,
 * and saved values the agent no longer offers.
 * Test first: a saved value the agent no longer offers shows the "choose those options again"
 * message.
 */
import type { AcpConfigOption, SessionConfig } from "@conducted/protocol";
import { appError } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { AcpOptions } from "./AcpOptions.tsx";

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
});

const config = (over: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "acp",
	acpAgent: "opencode",
	model: "one",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...over,
});

const thoughtLevel = (current: string): AcpConfigOption => ({
	id: "thought_level",
	name: "Thought level",
	value: {
		kind: "select",
		current,
		choices: [
			{ value: "low", name: "Low" },
			{ value: "medium", name: "Medium" },
			{ value: "high", name: "High" },
		],
	},
});

const webSearch = (current: boolean): AcpConfigOption => ({
	id: "web_search",
	name: "Web search",
	value: { kind: "switch", current },
});

interface SidecarRequest {
	id?: number;
	method?: string;
	params?: unknown;
}

const requests = (test: TestContainer): SidecarRequest[] =>
	test.memory.controls.sidecarSent.flatMap((line) => {
		try {
			return [JSON.parse(line) as SidecarRequest];
		} catch {
			return [];
		}
	});

const setup = async (over: Partial<SessionConfig> = {}) => {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, config(over));
	if (!created.ok) throw new Error("could not create a chat");
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { test, session: created.value, wrapper };
};

describe("AGENT-17 ACP chat options in the composer", () => {
	it("shows a switch option and sends a change to the sidecar", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "ready", data: [webSearch(false)] },
				},
			});
			const started = await test.container.sidecar.start();
			expect(started.ok).toBe(true);
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			const chip = screen.getByRole("button", { name: "Web search" });
			fireEvent.click(chip);
			await waitFor(() =>
				expect(requests(test).some((sent) => sent.method === "setAcpConfigOption")).toBe(true),
			);
			const request = requests(test).find((sent) => sent.method === "setAcpConfigOption");
			if (request?.id === undefined) throw new Error("no setAcpConfigOption request");
			expect(request.params).toEqual({
				sessionId: session.id,
				optionId: "web_search",
				value: true,
			});
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					id: request.id,
					result: { options: [webSearch(true)] },
				}),
			);
			await waitFor(() =>
				expect(requests(test).some((sent) => sent.method === "updateConfig")).toBe(true),
			);
			const saved = requests(test).find((sent) => sent.method === "updateConfig");
			if (saved?.id !== undefined) {
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: saved.id, result: { applied: "live" } }),
				);
			}
			await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.config.acpConfig,
			).toEqual({ web_search: true });
		} finally {
			test.container.sidecar.stop();
			test.close();
		}
	});

	it("lists a select option with its current choice", async () => {
		const { test, session, wrapper } = await setup();
		try {
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "ready", data: [thoughtLevel("high")] },
				},
			});
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Thought level: High" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("shows nothing for an agent that has no ACP options", async () => {
		const { test, session, wrapper } = await setup({ agent: "claude", acpAgent: undefined });
		try {
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "ready", data: [thoughtLevel("high")] },
				},
			});
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			expect(screen.queryByRole("button", { name: "Thought level: High" })).toBeNull();
		} finally {
			test.close();
		}
	});

	it("says when saved model options could not be loaded", async () => {
		const { test, session, wrapper } = await setup({ acpConfig: { thought_level: "high" } });
		try {
			const failure = appError("acp_model_not_loaded", "The model was not found.");
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "error", error: failure },
				},
			});
			const error = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			await waitFor(() =>
				expect(error).toHaveBeenCalledWith(
					"Couldn't load saved model options",
					expect.objectContaining({ description: failure.message }),
				),
			);
		} finally {
			test.close();
		}
	});

	it("says some saved options must be chosen again when the agent no longer offers them", async () => {
		const { test, session, wrapper } = await setup({ acpConfig: { gone: "old" } });
		try {
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "ready", data: [thoughtLevel("high")] },
				},
			});
			const warning = vi.spyOn(toast, "warning").mockImplementation(() => "toast-id");
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			await waitFor(() =>
				expect(warning).toHaveBeenCalledWith(
					"Some saved model options could not be loaded. Choose those options again.",
				),
			);
		} finally {
			test.close();
		}
	});

	it("says some saved options must be chosen again when the agent refused them", async () => {
		const { test, session, wrapper } = await setup({ acpConfig: { thought_level: "low" } });
		try {
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "ready", data: [thoughtLevel("medium")] },
				},
			});
			const warning = vi.spyOn(toast, "warning").mockImplementation(() => "toast-id");
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			await waitFor(() =>
				expect(warning).toHaveBeenCalledWith(
					"Some saved model options could not be loaded. Choose those options again.",
				),
			);
			expect(screen.getByRole("button", { name: "Thought level: Medium" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("does not warn when every saved choice loaded", async () => {
		const { test, session, wrapper } = await setup({
			acpConfig: { thought_level: "high", web_search: true },
		});
		try {
			test.container.services.sessions.store.setState({
				acpConfigOptions: {
					[session.id]: { state: "ready", data: [thoughtLevel("high"), webSearch(true)] },
				},
			});
			const warning = vi.spyOn(toast, "warning").mockImplementation(() => "toast-id");
			render(<AcpOptions sessionId={session.id} />, { wrapper });
			expect(screen.getByRole("button", { name: "Thought level: High" })).toBeTruthy();
			expect(warning).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});
});
