/**
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: tests for the repository-name check the Create project and Create a private GitHub repo?
 * dialogs show.
 * Behaviour: services-map.md 3.9 (name availability with `gh repo view`), ui-map.md 3.9.
 * Test first: a valid name asks GitHub through the real container's GitHub service.
 */

import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import type { GithubAccess } from "../services/github.ts";
import { useRepoNameCheck } from "./github.ts";

const signedIn: GithubAccess = {
	status: "ok",
	login: "acme",
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "ssh",
};

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return (
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

function setAccess(access: GithubAccess) {
	test.container.services.github.store.setState((state) => ({ ...state, access }));
}

describe("PRJ-03 useRepoNameCheck", () => {
	it("reports an available name from the real GitHub service", async () => {
		setAccess(signedIn);
		const check = vi
			.spyOn(test.container.services.github, "checkRepoName")
			.mockResolvedValue(ok("available"));
		const { result } = renderHook(() => useRepoNameCheck("acme", "My App!"), { wrapper });

		await waitFor(() => expect(result.current).toEqual({ state: "ready", data: "available" }));
		expect(check).toHaveBeenCalledWith("acme", "my-app");
	});

	it("reports a taken name", async () => {
		setAccess(signedIn);
		vi.spyOn(test.container.services.github, "checkRepoName").mockResolvedValue(ok("taken"));
		const { result } = renderHook(() => useRepoNameCheck("acme", "app"), { wrapper });

		await waitFor(() => expect(result.current).toEqual({ state: "ready", data: "taken" }));
	});

	it("answers that a name with no letters or numbers is invalid without asking GitHub", () => {
		setAccess(signedIn);
		const check = vi.spyOn(test.container.services.github, "checkRepoName");
		const { result } = renderHook(() => useRepoNameCheck("acme", "!!!"), { wrapper });

		expect(result.current).toEqual({ state: "ready", data: "invalid" });
		expect(check).not.toHaveBeenCalled();
	});

	it("reports GitHub unavailable without asking for a name", () => {
		setAccess({ status: "signed_out" });
		const check = vi.spyOn(test.container.services.github, "checkRepoName");
		const { result } = renderHook(() => useRepoNameCheck("acme", "app"), { wrapper });

		expect(result.current.state).toBe("error");
		expect(check).not.toHaveBeenCalled();
	});
});
