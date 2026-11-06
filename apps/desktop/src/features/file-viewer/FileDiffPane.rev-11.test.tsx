/**
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * Owns: the file diff pane's conflict rows: the three choices per conflict, saving the chosen
 * sides, refreshing the change list, and the "Failed to save conflict resolution" toast.
 * Behaviour: inventory-controls.md "Resolve merge conflict hunks inline" and
 * inventory-messages-sidecar.md "Merge conflicts in the editor".
 * Test first: picking "both" and saving writes both sides with no markers and refetches the
 * change list.
 */
import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { toast } from "../../ui/Toast.tsx";
import { FileDiffPane } from "./FileDiffPane.tsx";

afterEach(cleanup);

const preferences = {
	layout: "unified" as const,
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const conflict = (current: string, incoming: string): string =>
	`<<<<<<< HEAD\n${current}\n=======\n${incoming}\n>>>>>>> feature\n`;

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

function diffOf(text: string): FileDiff {
	return {
		path: "a.ts",
		oldText: "before",
		newText: text,
		patch: "",
		binary: false,
		tooLarge: false,
	};
}

async function setup(diffText: string, diskText: string) {
	const test = createTestContainer();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const workspace = await seedWorkspace(test.container, {
		path: "/code/workspaces/conflict-diff",
	});
	const absolute = `${workspace.path}/a.ts`;
	test.memory.controls.files.set(absolute, diskText);
	vi.spyOn(test.container.services.fileDiff, "load").mockResolvedValue(ok(diffOf(diffText)));
	const gitCalls: string[] = [];
	test.memory.controls.scriptShell((command) => {
		if (command.program !== "git") return null;
		gitCalls.push(command.args.join(" "));
		return ok({ stdout: "", stderr: "", exitCode: 0 });
	});
	render(
		<FileDiffPane
			workspaceId={workspace.id}
			path="a.ts"
			scope={{ kind: "uncommitted" }}
			preferences={preferences}
		/>,
		{ wrapper: wrapper(test.container, client) },
	);
	return { test, client, absolute, gitCalls };
}

describe("REV-11 FileDiffPane conflict rows", () => {
	it("offers the three choices per conflict and saves both sides", async () => {
		const { test, client, absolute, gitCalls } = await setup(
			conflict("ours", "theirs"),
			conflict("ours", "theirs"),
		);
		const invalidate = vi.spyOn(client, "invalidateQueries");
		try {
			expect(await screen.findByRole("button", { name: "Accept current change" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Accept incoming change" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Accept both" }));
			fireEvent.click(screen.getByRole("button", { name: "Save resolution" }));

			await waitFor(() => expect(test.memory.controls.files.get(absolute)).toBe("ours\ntheirs\n"));
			expect(gitCalls.some((call) => call.includes("add"))).toBe(true);
			expect(invalidate).toHaveBeenCalledWith({ queryKey: ["git"] });
		} finally {
			client.clear();
			test.close();
		}
	});

	it("shows the failure toast when the file cannot be saved", async () => {
		const { test, client, absolute } = await setup(
			conflict("ours", "theirs"),
			"<<<<<<< HEAD\nours\n>>>>>>> feature\n",
		);
		const toastError = vi.spyOn(toast, "error");
		try {
			fireEvent.click(await screen.findByRole("button", { name: "Accept both" }));
			fireEvent.click(screen.getByRole("button", { name: "Save resolution" }));

			await waitFor(() =>
				expect(toastError).toHaveBeenCalledWith(
					"Failed to save conflict resolution",
					expect.anything(),
				),
			);
			expect(test.memory.controls.files.get(absolute)).toBe(
				"<<<<<<< HEAD\nours\n>>>>>>> feature\n",
			);
		} finally {
			toastError.mockRestore();
			client.clear();
			test.close();
		}
	});
});
