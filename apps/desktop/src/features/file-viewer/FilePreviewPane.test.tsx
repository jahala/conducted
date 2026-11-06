/**
 * @feature REV-08 File preview pane
 * Tests the preview chosen for a file over the real container and the in-memory file system.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { FilePreviewPane } from "./FilePreviewPane.tsx";

afterEach(cleanup);

function wrapper(container: ReturnType<typeof createTestContainer>["container"]) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

describe("REV-08 FilePreviewPane", () => {
	it("renders the Markdown preview for a .md file", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-md",
			});
			test.memory.controls.files.set(`${workspace.path}/notes.md`, "# Hello from the file\n");
			render(<FilePreviewPane workspaceId={workspace.id} path="notes.md" />, {
				wrapper: wrapper(test.container),
			});
			expect(await screen.findByRole("heading", { name: "Hello from the file" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("renders the unavailable notice for a .bin file", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-bin",
			});
			test.memory.controls.files.set(`${workspace.path}/data.bin`, "not really binary");
			render(<FilePreviewPane workspaceId={workspace.id} path="data.bin" />, {
				wrapper: wrapper(test.container),
			});
			expect(await screen.findByText("Preview not available")).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("renders a CSV file as a table", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-csv",
			});
			test.memory.controls.files.set(`${workspace.path}/data.csv`, "a,b\n1,2\n");
			render(<FilePreviewPane workspaceId={workspace.id} path="data.csv" />, {
				wrapper: wrapper(test.container),
			});
			expect(await screen.findAllByRole("columnheader")).toHaveLength(2);
		} finally {
			test.close();
		}
	});
});
