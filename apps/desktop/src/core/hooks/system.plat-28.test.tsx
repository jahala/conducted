/**
 * @feature PLAT-28 Agent program manager
 * Owns: tests that `useAgentPrograms` follows the system service's program store.
 * Test first: a loaded program store comes back as a ready list.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import type { AgentProgramView } from "../model.ts";
import { useAgentPrograms } from "./system.ts";

afterEach(cleanup);

const claude: AgentProgramView = {
	status: {
		program: "claude",
		state: "ready",
		version: "2.1.308",
		bytesDownloaded: 10,
		bytesTotal: 10,
		attempt: 0,
		nextAttemptAt: null,
		error: null,
		path: "/app/agent-binaries/claude/2.1.308/claude",
		follow: null,
	},
	userPath: null,
};

describe("PLAT-28 useAgentPrograms", () => {
	it("is loading before the store has loaded and ready after it", () => {
		const test = createTestContainer();
		try {
			const wrapper = ({ children }: { children: ReactNode }) => (
				<ServicesProvider container={test.container}>{children}</ServicesProvider>
			);
			const { result } = renderHook(() => useAgentPrograms(), { wrapper });
			expect(result.current).toEqual({ state: "loading" });
			act(() => {
				test.container.services.system.store.setState({
					programs: { state: "ready", data: [claude] },
				});
			});
			expect(result.current).toEqual({ state: "ready", data: [claude] });
		} finally {
			test.close();
		}
	});
});
