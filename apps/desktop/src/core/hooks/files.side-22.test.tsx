/**
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the tests for `useRepoFileSearch`: the `@` menu's file list before a workspace exists.
 * Behaviour: ui-map.md 3.5 (the new-workspace composer searches the chosen repository's files).
 * Test first: a two-character query searches the repository root, not a workspace folder.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedRepo } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import { useRepoFileSearch } from "../hooks.ts";

afterEach(cleanup);

function wrapper(container: ReturnType<typeof createTestContainer>["container"]) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, networkMode: "always" } },
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

describe("SIDE-22 useRepoFileSearch", () => {
	it("SIDE-22 waits for two characters before searching a repository", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/app" });
			const search = vi.spyOn(test.container.services.workspaceFiles, "quickOpenRoot");
			const { result } = renderHook(() => useRepoFileSearch(repo.id, "a"), {
				wrapper: wrapper(test.container),
			});

			expect(result.current).toEqual({ state: "ready", data: [] });
			expect(search).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("SIDE-22 searches the repository's own folder and returns paths relative to it", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/app" });
			test.memory.controls.files.set("/code/projects/app/src/app.ts", "export {};\n");
			const { result } = renderHook(() => useRepoFileSearch(repo.id, "app"), {
				wrapper: wrapper(test.container),
			});

			await waitFor(() => expect(result.current.state).toBe("ready"));
			expect(result.current).toEqual({
				state: "ready",
				data: [{ path: "src/app.ts", isDirectory: false }],
			});
		} finally {
			test.close();
		}
	});

	it("SIDE-22 returns no files when the repository is not loaded yet", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/missing" });
			test.container.services.repo.store.setState((state) => {
				const reposById = { ...state.reposById };
				delete reposById[repo.id];
				return { reposById };
			});
			const { result } = renderHook(() => useRepoFileSearch(repo.id, "app"), {
				wrapper: wrapper(test.container),
			});

			expect(result.current).toEqual({ state: "ready", data: [] });
		} finally {
			test.close();
		}
	});
});
