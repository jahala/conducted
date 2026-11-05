import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import { useFileTree } from "./hooks.ts";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const wrapper = (container: Container, client: QueryClient) => {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
};

describe("REV-06 useFileTree", () => {
	it("refetches a tree older than 15 seconds and polls every 30 seconds", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const tree = vi
				.spyOn(test.container.services.workspaceFiles, "tree")
				.mockResolvedValue(ok([{ path: "README.md", isDirectory: false }]));
			const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));

			const first = renderHook(() => useFileTree(workspace.id), {
				wrapper: wrapper(test.container, client),
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(first.result.current).toEqual({
				state: "ready",
				data: [{ path: "README.md", isDirectory: false }],
			});
			expect(tree).toHaveBeenCalledTimes(1);
			first.unmount();

			await act(async () => {
				await vi.advanceTimersByTimeAsync(16_000);
			});
			const second = renderHook(() => useFileTree(workspace.id), {
				wrapper: wrapper(test.container, client),
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(tree).toHaveBeenCalledTimes(2);

			await act(async () => {
				await vi.advanceTimersByTimeAsync(30_000);
			});
			expect(tree).toHaveBeenCalledTimes(3);
			second.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});
});
