/**
 * @feature APP-02 Onboarding: agents
 * Owns: the tests of the shared sign-in state machine.
 * Behaviour: ui-map.md 6, 7.1 and other-runners.md 5 (agent sign-in flows).
 * Test first: a second start that finishes first keeps its panel when the first start answers
 * later, and the first sign-in is cancelled.
 */
import { type AgentLogin, idleLiveState } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { sampleSession, sampleWorkspace, sessionId } from "./db/test-fixtures.ts";
import { ServicesProvider } from "./context.tsx";
import { type UseAgentLoginOptions, useAgentLogin } from "./use-agent-login.ts";

afterEach(cleanup);

function renderLogin(test: TestContainer, options: UseAgentLoginOptions = {}) {
	return renderHook(() => useAgentLogin(options), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		),
	});
}

const flow = (loginId: string, rest: Partial<AgentLogin> = {}): AgentLogin => ({
	loginId,
	instructions: `Sign in as ${loginId}.`,
	...rest,
});

describe("APP-02 shared agent sign-in", () => {
	it("shows Claude's link and code and waits for a pasted code", async () => {
		const test = createTestContainer();
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(
			ok(flow("claude-1", { url: "https://example.com", userCode: "ABCD-1234" })),
		);
		try {
			const { result } = renderLogin(test);
			await act(async () => {
				await result.current.start({ agent: "claude" });
			});

			expect(result.current.login).toMatchObject({
				key: "claude",
				name: "Claude Code",
				loginId: "claude-1",
				requiresCode: true,
			});
			expect(result.current.login?.flow?.userCode).toBe("ABCD-1234");
		} finally {
			test.close();
		}
	});

	it("auto-finishes Codex and refreshes after a signed-in answer", async () => {
		const test = createTestContainer();
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(ok(flow("codex-1")));
		const finishLogin = vi
			.spyOn(test.container.services.agentCatalog, "finishLogin")
			.mockResolvedValue(ok({ outcome: "signed_in", message: null }));
		const onRefresh = vi.fn();
		try {
			const { result } = renderLogin(test, { onRefresh });
			await act(async () => {
				await result.current.start({ agent: "codex" });
			});

			await waitFor(() => expect(finishLogin).toHaveBeenCalledWith("codex-1", undefined));
			await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
			expect(result.current.login).toBeNull();
		} finally {
			test.close();
		}
	});

	it("cancels a sign-in and refreshes the install list", async () => {
		const test = createTestContainer();
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(ok(flow("claude-1")));
		const cancelLogin = vi
			.spyOn(test.container.services.agentCatalog, "cancelLogin")
			.mockResolvedValue(ok(undefined));
		const onRefresh = vi.fn();
		try {
			const { result } = renderLogin(test, { onRefresh });
			await act(async () => {
				await result.current.start({ agent: "claude" });
			});
			await act(async () => {
				await result.current.cancel("claude-1");
			});

			expect(cancelLogin).toHaveBeenCalledWith("claude-1");
			expect(result.current.login).toBeNull();
			expect(onRefresh).toHaveBeenCalledTimes(1);
		} finally {
			test.close();
		}
	});

	it("keeps the newest start and cancels the older sign-in", async () => {
		const test = createTestContainer();
		let answerClaude: (value: Result<AgentLogin>) => void = () => {};
		const claude = new Promise<Result<AgentLogin>>((resolve) => {
			answerClaude = resolve;
		});
		vi.spyOn(test.container.services.agentCatalog, "login").mockImplementation((agent, acpAgent) =>
			agent === "claude"
				? claude
				: Promise.resolve(ok(flow(acpAgent === "opencode" ? "opencode-1" : "other-1"))),
		);
		const cancelLogin = vi
			.spyOn(test.container.services.agentCatalog, "cancelLogin")
			.mockResolvedValue(ok(undefined));
		try {
			const { result } = renderLogin(test);
			act(() => {
				void result.current.start({ agent: "claude" });
			});
			await act(async () => {
				await result.current.start({ agent: "acp", acpAgent: "opencode" });
			});
			expect(result.current.login?.loginId).toBe("opencode-1");

			await act(async () => {
				answerClaude(ok(flow("claude-1")));
				await claude;
			});

			await waitFor(() => expect(cancelLogin).toHaveBeenCalledWith("claude-1"));
			expect(result.current.login?.loginId).toBe("opencode-1");
		} finally {
			test.close();
		}
	});

	it("keeps the panel with the finish error", async () => {
		const test = createTestContainer();
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(ok(flow("claude-1")));
		vi.spyOn(test.container.services.agentCatalog, "finishLogin").mockResolvedValue(
			err(appError("login_failed", "The code expired.")),
		);
		try {
			const { result } = renderLogin(test);
			await act(async () => {
				await result.current.start({ agent: "claude" });
			});
			await act(async () => {
				await result.current.finish("claude-1", "123-456");
			});

			expect(result.current.login?.error).toBe("The code expired.");
			expect(result.current.login?.finishing).toBe(false);
		} finally {
			test.close();
		}
	});

	it("says Claude signed in and restarts Claude's idle local chats", async () => {
		const test = createTestContainer();
		test.container.services.workspace.store.setState({
			loaded: true,
			workspacesById: { [sampleWorkspace.id]: sampleWorkspace },
		});
		test.container.services.sessions.store.setState({
			sessions: { [sessionId]: sampleSession },
			byWorkspace: {},
			liveStates: { [sessionId]: idleLiveState },
		});
		const restart = vi
			.spyOn(test.container.services.sessions, "restartAgent")
			.mockResolvedValue(ok(undefined));
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(ok(flow("claude-1")));
		vi.spyOn(test.container.services.agentCatalog, "finishLogin").mockResolvedValue(
			ok({ outcome: "signed_in", message: null }),
		);
		const onSignedIn = vi.fn();
		try {
			const { result } = renderLogin(test, { onSignedIn });
			await act(async () => {
				await result.current.start({ agent: "claude" });
			});
			await act(async () => {
				await result.current.finish("claude-1", "123-456");
			});

			await waitFor(() => expect(restart).toHaveBeenCalledWith(sessionId));
			expect(onSignedIn).toHaveBeenCalledWith(
				"Claude login successful. Idle sessions were stopped automatically.",
			);
		} finally {
			test.close();
		}
	});

	it("leaves a working chat alone and says so without the idle sentence", async () => {
		const test = createTestContainer();
		test.container.services.workspace.store.setState({
			loaded: true,
			workspacesById: { [sampleWorkspace.id]: sampleWorkspace },
		});
		test.container.services.sessions.store.setState({
			sessions: { [sessionId]: sampleSession },
			byWorkspace: {},
			liveStates: { [sessionId]: { ...idleLiveState, status: "working" } },
		});
		const restart = vi
			.spyOn(test.container.services.sessions, "restartAgent")
			.mockResolvedValue(ok(undefined));
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(ok(flow("claude-1")));
		vi.spyOn(test.container.services.agentCatalog, "finishLogin").mockResolvedValue(
			ok({ outcome: "signed_in", message: null }),
		);
		const onSignedIn = vi.fn();
		try {
			const { result } = renderLogin(test, { onSignedIn });
			await act(async () => {
				await result.current.start({ agent: "claude" });
			});
			await act(async () => {
				await result.current.finish("claude-1", "123-456");
			});

			expect(restart).not.toHaveBeenCalled();
			expect(onSignedIn).toHaveBeenCalledWith("Claude login successful.");
		} finally {
			test.close();
		}
	});

	it("shows a failed open or copy on the open panel", async () => {
		const test = createTestContainer();
		vi.spyOn(test.container.services.agentCatalog, "login").mockResolvedValue(ok(flow("claude-1")));
		try {
			const { result } = renderLogin(test);
			await act(async () => {
				await result.current.start({ agent: "claude" });
			});
			act(() => {
				result.current.setLoginError("claude-1", "Couldn't open the browser.");
			});

			expect(result.current.login?.error).toBe("Couldn't open the browser.");
		} finally {
			test.close();
		}
	});
});
