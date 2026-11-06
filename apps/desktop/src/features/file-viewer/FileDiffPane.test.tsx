/**
 * @feature REV-08 File diff pane
 * Tests that the previous diff stays on screen while the next one loads, over the real container.
 */

import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffScope, FileDiff } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { FileDiffPane } from "./FileDiffPane.tsx";

afterEach(cleanup);

const preferences = {
	layout: "unified" as const,
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const firstDiff: FileDiff = {
	path: "a.ts",
	oldText: "one",
	newText: "first",
	patch: "",
	binary: false,
	tooLarge: false,
};

function wrapper(
	container: ReturnType<typeof createTestContainer>["container"],
	client: QueryClient,
) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

describe("REV-08 FileDiffPane", () => {
	it("keeps the previous diff while a second request is in flight", async () => {
		const test = createTestContainer();
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/diff-pane" });
			const service = test.container.services.fileDiff;
			vi.spyOn(service, "load").mockImplementation(async (_id, _path, scope: DiffScope) =>
				scope.kind === "branch"
					? ok(firstDiff)
					: new Promise((resolve) => {
							// The second request never settles, so the pane must keep what it has.
							void resolve;
						}),
			);

			const { rerender } = render(
				<FileDiffPane
					workspaceId={workspace.id}
					path="a.ts"
					scope={{ kind: "branch" }}
					preferences={preferences}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);
			await waitFor(() => expect(document.querySelector("[data-diff]")).not.toBeNull());

			rerender(
				<FileDiffPane
					workspaceId={workspace.id}
					path="a.ts"
					scope={{ kind: "commit", sha: "abc123" }}
					preferences={preferences}
				/>,
			);
			await waitFor(() => expect(screen.queryByLabelText("Loading file")).toBeNull());
			expect(document.querySelector("[data-diff]")).not.toBeNull();
		} finally {
			client.clear();
			test.close();
		}
	});
});
