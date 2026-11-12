/**
 * @feature REV-08 File content query and the editor's draft for the viewer
 * Owns: tests for useFileContent's poll and useFileDraft's save.
 * Behaviour: services-map.md 2.5.2 (an open file's modified time is polled every 5 s, so a change on
 * disk shows early).
 * Test first: a poll that finds the same modified time reads no text; a poll that finds a newer
 * time reads the new text.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import { useFileContent, useFileDraft } from "../hooks.ts";

afterEach(cleanup);

async function setup(path: string) {
	let now = 1_700_000_000_000;
	const test = createTestContainer({ clock: { now: () => now } });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, networkMode: "always" } },
	});
	const workspace = await seedWorkspace(test.container, { path });
	const writeDisk = async (text: string): Promise<void> => {
		now += 1_000;
		test.memory.controls.addFile(`${workspace.path}/a.ts`, text);
	};
	await writeDisk("one");
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
	const modifiedAtKey = ["files", "content", workspace.id, "a.ts", "modified-at"];
	return { test, client, workspace, writeDisk, wrapper, modifiedAtKey };
}

describe("REV-08 useFileContent", () => {
	it("polls the modified time and reads the text only when it changed", async () => {
		const { test, client, workspace, writeDisk, wrapper, modifiedAtKey } =
			await setup("/code/workspaces/poll");
		try {
			const readContent = vi.spyOn(test.container.services.workspaceFiles, "readContent");
			const { result } = renderHook(() => useFileContent(workspace.id, "a.ts"), { wrapper });
			await waitFor(() => expect(result.current.state).toBe("ready"));
			expect(readContent).toHaveBeenCalledTimes(1);

			const poll = client.getQueryCache().find({ queryKey: modifiedAtKey });
			expect(poll?.observers[0]?.options.refetchInterval).toBe(5_000);

			await act(() => client.refetchQueries({ queryKey: modifiedAtKey }));
			expect(readContent).toHaveBeenCalledTimes(1);

			await writeDisk("two");
			await act(() => client.refetchQueries({ queryKey: modifiedAtKey }));
			await waitFor(() =>
				expect(result.current).toMatchObject({ state: "ready", data: { text: "two" } }),
			);
			expect(readContent).toHaveBeenCalledTimes(2);
		} finally {
			client.clear();
			test.close();
		}
	});
});

describe("REV-08 useFileDraft", () => {
	it("shows the saved text at once, without reading the file again", async () => {
		const { test, client, workspace, wrapper } = await setup("/code/workspaces/draft-save");
		try {
			const readContent = vi.spyOn(test.container.services.workspaceFiles, "readContent");
			const { result } = renderHook(
				() => ({
					content: useFileContent(workspace.id, "a.ts"),
					draft: useFileDraft(workspace.id, "a.ts"),
				}),
				{ wrapper },
			);
			await waitFor(() => expect(result.current.content.state).toBe("ready"));
			const loaded = result.current.content;
			if (loaded.state !== "ready" || loaded.data.kind !== "text") throw new Error("Not text.");
			const disk = { text: loaded.data.text, modifiedAt: loaded.data.modifiedAt };
			act(() => {
				result.current.draft.edit("saved text", disk);
			});
			expect(result.current.draft.draft?.text).toBe("saved text");

			let saved: Awaited<ReturnType<typeof result.current.draft.save>> | undefined;
			await act(async () => {
				saved = await result.current.draft.save();
			});

			expect(saved).toEqual({ ok: true, value: true });
			expect(result.current.draft.draft).toBeUndefined();
			// React Query hands a cache write to its observers on its next tick, after act returns.
			await waitFor(() =>
				expect(result.current.content).toMatchObject({
					state: "ready",
					data: { text: "saved text" },
				}),
			);
			expect(readContent).toHaveBeenCalledTimes(1);
		} finally {
			client.clear();
			test.close();
		}
	});
});
