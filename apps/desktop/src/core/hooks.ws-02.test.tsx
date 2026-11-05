/**
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: the useBranches query hook behind the create-from branch list.
 * Behaviour: services-map.md 3.1 (workspace create) and ui-map.md 3.9 (the create-from list).
 * Test first: useBranches reports a repository's branches and its read failure as a Loadable.
 */
import { appError, ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedRepo, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useBranches } from "./hooks.ts";

let test: TestContainer | null = null;
let client: QueryClient | null = null;

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
	client?.clear();
	client = null;
	test?.close();
	test = null;
});

const wrapper = (container: TestContainer["container"], queryClient: QueryClient) => {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
};

describe("WS-02 useBranches", () => {
	it("reports the loaded branches", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, { rootPath: "/repo" });
		vi.spyOn(test.container.services.git, "listBranches").mockResolvedValue(
			ok(["main", "feature/login"]),
		);
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = renderHook(() => useBranches(repo.id), {
			wrapper: wrapper(test.container, client),
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));

		expect(result.current).toEqual({ state: "ready", data: ["main", "feature/login"] });
		expect(test.container.services.git.listBranches).toHaveBeenCalledWith("/repo");
	});

	it("reports a failed branch read as an error value", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, { rootPath: "/repo" });
		vi.spyOn(test.container.services.git, "listBranches").mockResolvedValue({
			ok: false,
			error: appError("git_failed", "fatal: not a git repository"),
		});
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		const { result } = renderHook(() => useBranches(repo.id), {
			wrapper: wrapper(test.container, client),
		});
		await waitFor(() => expect(result.current.state).toBe("error"));

		expect(result.current.state).toBe("error");
		if (result.current.state === "error") {
			expect(result.current.error.message).toBe("fatal: not a git repository");
		}
	});
});
