/**
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: tests for the Linear access and issue hooks over the real container.
 * Behaviour: services-map.md 2.5 and ui-map.md 6. The Account page shows the connection these
 * hooks report.
 * Test first: no stored key reports signed out, and the issue list reports that Linear needs a key
 * without asking the network.
 */
import type { RepoId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import { useIssues } from "./github.ts";
import { useLinearAccess } from "./linear.ts";

let current: TestContainer | null = null;

afterEach(() => {
	cleanup();
	current?.close();
	current = null;
});

function wrapper(test: TestContainer, withQuery: boolean) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return ({ children }: { children: ReactNode }) =>
		withQuery ? (
			<QueryClientProvider client={client}>
				<ServicesProvider container={test.container}>{children}</ServicesProvider>
			</QueryClientProvider>
		) : (
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		);
}

describe("PR-09 useLinearAccess", () => {
	it("reports signed out when no key is stored", async () => {
		const test = createTestContainer();
		current = test;
		await test.container.services.linear.setApiKey(null);
		const { result } = renderHook(() => useLinearAccess(), { wrapper: wrapper(test, false) });
		expect(result.current).toEqual({ state: "ready", data: { state: "signed_out" } });
	});

	it("reports a rejected key", () => {
		const test = createTestContainer();
		current = test;
		act(() => {
			test.container.services.linear.store.setState({ connection: "key_rejected" });
		});
		const { result } = renderHook(() => useLinearAccess(), { wrapper: wrapper(test, false) });
		expect(result.current).toEqual({ state: "ready", data: { state: "key_rejected" } });
	});

	it("reports the connected account", () => {
		const test = createTestContainer();
		current = test;
		act(() => {
			test.container.services.linear.store.setState({
				connection: "connected",
				account: { name: "Ada", organization: "Acme" },
			});
		});
		const { result } = renderHook(() => useLinearAccess(), { wrapper: wrapper(test, false) });
		expect(result.current).toEqual({
			state: "ready",
			data: { state: "signed_in", name: "Ada", organization: "Acme" },
		});
	});

	it("is loading before the key has been checked", () => {
		const test = createTestContainer();
		current = test;
		const { result } = renderHook(() => useLinearAccess(), { wrapper: wrapper(test, false) });
		expect(result.current).toEqual({ state: "loading" });
	});
});

describe("PR-09 useIssues with Linear", () => {
	it("reports that Linear needs a key without asking the network", async () => {
		const test = createTestContainer();
		current = test;
		await test.container.services.linear.setApiKey(null);
		const { result } = renderHook(() => useIssues("repo-1" as RepoId, "linear", ""), {
			wrapper: wrapper(test, true),
		});
		expect(result.current.state).toBe("error");
		expect(result.current.state === "error" && result.current.error.code).toBe(
			"linear_not_connected",
		);
		expect(test.memory.controls.shellCalls).toHaveLength(0);
	});

	it("reports a rejected key without asking the network", () => {
		const test = createTestContainer();
		current = test;
		act(() => {
			test.container.services.linear.store.setState({ connection: "key_rejected" });
		});
		const { result } = renderHook(() => useIssues("repo-1" as RepoId, "linear", "ENG-12"), {
			wrapper: wrapper(test, true),
		});
		expect(result.current.state).toBe("error");
		expect(result.current.state === "error" && result.current.error.code).toBe(
			"linear_key_rejected",
		);
		expect(test.memory.controls.shellCalls).toHaveLength(0);
	});
});
