/**
 * @feature REV-07 Quick open and search in files
 * Owns: tests for the file search and content search hooks that back the two dialogs.
 * Behaviour: services-map.md 2.5.3 (fuzzy and grep queries), 5A.5.1 (minimum 2 characters).
 * Test first: a two-character fuzzy query returns files, and an older slower answer never replaces
 * the newest query's answer.
 */
import type { Result } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import type { FileEntry } from "../api.ts";
import { ServicesProvider } from "../context.tsx";
import { useContentSearch, useFileSearch } from "../hooks.ts";

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

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("REV-07 useFileSearch", () => {
	it("waits for two characters before searching", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const quickOpen = vi.spyOn(test.container.services.workspaceFiles, "quickOpen");
			const { result } = renderHook(() => useFileSearch(workspace.id, "a"), {
				wrapper: wrapper(test.container),
			});
			expect(result.current).toEqual({ state: "ready", data: [] });
			expect(quickOpen).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("returns the newest answer when an older search finishes last", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const older = deferred<Result<FileEntry[]>>();
			const newer = deferred<Result<FileEntry[]>>();
			vi.spyOn(test.container.services.workspaceFiles, "quickOpen").mockImplementation(
				(_id, query) => (query === "fi" ? older.promise : newer.promise),
			);
			const { result, rerender } = renderHook(({ query }) => useFileSearch(workspace.id, query), {
				wrapper: wrapper(test.container),
				initialProps: { query: "fi" },
			});
			rerender({ query: "fix" });
			await act(async () => {
				newer.resolve({
					ok: true,
					value: [{ path: "src/fix.ts", isDirectory: false }],
				});
			});
			await waitFor(() => expect(result.current).toMatchObject({ state: "ready" }));
			await act(async () => {
				older.resolve({
					ok: true,
					value: [{ path: "src/fi.ts", isDirectory: false }],
				});
			});
			expect(result.current).toEqual({
				state: "ready",
				data: [{ path: "src/fix.ts", isDirectory: false }],
			});
		} finally {
			test.close();
		}
	});
});

describe("REV-07 useContentSearch", () => {
	it("passes the match options and returns the matching lines", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/hook" });
			test.memory.controls.files.set(`${workspace.path}/src/a.ts`, "retry now\nretrying later\n");
			const { result } = renderHook(
				() =>
					useContentSearch(workspace.id, "retry", {
						matchCase: true,
						wholeWord: true,
						regex: false,
					}),
				{ wrapper: wrapper(test.container) },
			);
			await waitFor(() => expect(result.current.state).toBe("ready"));
			expect(result.current).toMatchObject({
				state: "ready",
				data: [{ path: "src/a.ts", line: 1 }],
			});
		} finally {
			test.close();
		}
	});
});
