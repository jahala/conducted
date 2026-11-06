import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useFullDiskAccess } from "./hooks.ts";

function wrapper(container: ReturnType<typeof createTestContainer>["container"]) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

describe("PLAT-24 useFullDiskAccess", () => {
	it("PLAT-24 reports the access the platform check returns", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.setFullDiskAccess(false);

			const { result } = renderHook(() => useFullDiskAccess(), {
				wrapper: wrapper(test.container),
			});
			expect(result.current).toEqual({ state: "loading" });

			await waitFor(() => {
				expect(result.current).toEqual({ state: "ready", data: false });
			});
		} finally {
			test.close();
		}
	});

	it("PLAT-24 reports a check that cannot run as an error, not as an answer", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.failFullDiskAccessCheck("the check crashed");

			const { result } = renderHook(() => useFullDiskAccess(), {
				wrapper: wrapper(test.container),
			});

			await waitFor(() => {
				expect(result.current.state).toBe("error");
			});
			if (result.current.state !== "error") throw new Error("expected an error state");
			expect(result.current.error.code).toBe("full_disk_access_check_failed");
			expect(result.current.error.message).toBe("Full Disk Access could not be checked.");
		} finally {
			test.close();
		}
	});
});
