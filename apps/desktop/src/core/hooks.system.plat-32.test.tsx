import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useSystemInfo } from "./hooks.ts";

function wrapper(container: ReturnType<typeof createTestContainer>["container"]) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

describe("PLAT-32 useSystemInfo", () => {
	it("PLAT-32 reports the macOS version and CPU facts from the shell", async () => {
		const test = createTestContainer();
		try {
			const info = { osVersion: "13.6.1", machineArch: "arm64", buildArch: "x86_64" } as const;
			test.memory.controls.setSystemInfo(info);

			const { result } = renderHook(() => useSystemInfo(), {
				wrapper: wrapper(test.container),
			});
			expect(result.current).toEqual({ state: "loading" });

			await waitFor(() => {
				expect(result.current).toEqual({ state: "ready", data: info });
			});
		} finally {
			test.close();
		}
	});

	it("PLAT-32 reports an unreadable shell as an error, not as made-up facts", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.failSystemInfo("sw_vers is missing");

			const { result } = renderHook(() => useSystemInfo(), {
				wrapper: wrapper(test.container),
			});

			await waitFor(() => {
				expect(result.current.state).toBe("error");
			});
			if (result.current.state !== "error") throw new Error("expected an error state");
			expect(result.current.error.code).toBe("system_info_failed");
			expect(result.current.error.message).toBe("The Mac's system information could not be read.");
		} finally {
			test.close();
		}
	});
});
