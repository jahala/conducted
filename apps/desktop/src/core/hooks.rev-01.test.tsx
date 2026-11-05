import { appError, type Result, type WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ChangedFile } from "./api.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import type { ChangesSnapshot } from "./git/status.ts";
import { useBranchCommits, useChangedFiles } from "./hooks.ts";

const workspaceId = "ws-1" as WorkspaceId;

afterEach(cleanup);

const testWrapper = (container: Container, client: QueryClient) => {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
};

const snapshot = (): ChangesSnapshot =>
	({
		depth: "full",
		branch: "feat",
		mergeBase: "mb",
		mergeBaseError: null,
		files: [],
		conflictedPaths: [],
		untrackedTruncated: false,
		uncommittedFiles: 0,
		changedFiles: 0,
		operation: "none",
		commits: [
			{
				hash: "abcdef1234567",
				subject: "Add the changes list",
				authorName: "Ada",
				authorEmail: "ada@example.com",
				authoredAt: 1_700_000_000,
			},
		],
		sync: { ahead: 1, behind: 0, rewritten: false, hasUpstream: true },
		behindTarget: 0,
	}) as ChangesSnapshot;

function containerWith(git: Record<string, unknown>): Container {
	return { services: { git } } as unknown as Container;
}

describe("REV-01 useChangedFiles", () => {
	it("loads the changed files for the scope and reports an error value", async () => {
		const changedFiles = vi.fn(
			async (): Promise<Result<ChangedFile[]>> => ({
				ok: true,
				value: [
					{
						path: "src/a.ts",
						status: "modified",
						linesAdded: 1,
						linesRemoved: 0,
						binary: false,
						conflicted: false,
						viewed: false,
					},
				],
			}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const container = containerWith({
			changedFiles,
			store: createStore(() => ({ byWorkspace: {} })),
		});
		const { result, unmount } = renderHook(() => useChangedFiles(workspaceId, { kind: "branch" }), {
			wrapper: testWrapper(container, client),
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current).toMatchObject({ state: "ready", data: [{ path: "src/a.ts" }] });
		expect(changedFiles).toHaveBeenCalledWith(workspaceId, { kind: "branch" });
		unmount();
		client.clear();

		changedFiles.mockResolvedValueOnce({
			ok: false,
			error: appError("git_failed", "nope"),
		});
		const failing = renderHook(() => useChangedFiles(workspaceId, { kind: "uncommitted" }), {
			wrapper: testWrapper(container, client),
		});
		await waitFor(() => expect(failing.result.current.state).toBe("error"));
		failing.unmount();
		client.clear();
	});
});

describe("REV-01 useBranchCommits", () => {
	it("maps the polled commits to view rows", () => {
		const store = createStore(() => ({
			byWorkspace: {
				[workspaceId]: { snapshot: snapshot(), error: null, refreshedAt: 0 },
			},
		}));
		const container = containerWith({ store });
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result } = renderHook(() => useBranchCommits(workspaceId), {
			wrapper: testWrapper(container, client),
		});
		expect(result.current).toEqual({
			state: "ready",
			data: [
				{
					sha: "abcdef1234567",
					shortSha: "abcdef1",
					subject: "Add the changes list",
					authorName: "Ada",
					at: 1_700_000_000_000,
				},
			],
		});
	});
});
