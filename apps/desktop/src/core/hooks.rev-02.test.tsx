/**
 * @feature REV-02 File diff query
 * Tests that the file diff hook asks the service for the file and maps its states.
 */
import { appError, type Result, type WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { FileDiff } from "./api.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import { useFileDiff } from "./hooks.ts";

const workspaceId = "ws-1" as WorkspaceId;
const scope = { kind: "branch" } as const;

afterEach(cleanup);

const diff: FileDiff = {
	path: "src/a.ts",
	oldText: "old\n",
	newText: "new\n",
	patch: "",
	binary: false,
	tooLarge: false,
};

function containerWith(
	load: typeof import("./services/file-diff.ts")["FileDiffService"]["prototype"]["load"],
) {
	const settings = {
		store: createStore(() => ({ values: {} })),
		get: () => false,
	};
	return {
		services: { fileDiff: { load }, settings },
	} as unknown as Container;
}

const wrapper = (container: Container, client: QueryClient) => {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
};

describe("REV-02 useFileDiff", () => {
	it("loads one file and passes the whitespace preference", async () => {
		const load = vi.fn(async (): Promise<Result<FileDiff>> => ({ ok: true, value: diff }));
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result, unmount } = renderHook(() => useFileDiff(workspaceId, "src/a.ts", scope), {
			wrapper: wrapper(containerWith(load), client),
		});
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current).toMatchObject({ state: "ready", data: diff });
		expect(load).toHaveBeenCalledWith(workspaceId, "src/a.ts", scope, {
			withPatch: false,
			ignoreWhitespace: false,
		});
		unmount();
		client.clear();
	});

	it("reports a failed load as an error state", async () => {
		const load = vi.fn(
			async (): Promise<Result<FileDiff>> => ({
				ok: false,
				error: appError("git_failed", "nope"),
			}),
		);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const { result, unmount } = renderHook(() => useFileDiff(workspaceId, "src/a.ts", scope), {
			wrapper: wrapper(containerWith(load), client),
		});
		await waitFor(() => expect(result.current.state).toBe("error"));
		if (result.current.state === "error") {
			expect(result.current.error.message).toBe("nope");
		}
		unmount();
		client.clear();
	});
});
