/**
 * @feature REV-08 File preview pane
 * Tests the preview chosen for a file, "Open in another app" and "Reveal in Finder" for a file the
 * tab cannot show, and a Markdown file's relative link and image, over the real container and the
 * in-memory file system.
 */
import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { FilePreviewPane } from "./FilePreviewPane.tsx";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

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
			render(<FilePreviewPane workspaceId={workspace.id} path="notes.md" onOpenFile={vi.fn()} />, {
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
			render(<FilePreviewPane workspaceId={workspace.id} path="data.bin" onOpenFile={vi.fn()} />, {
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
			render(<FilePreviewPane workspaceId={workspace.id} path="data.csv" onOpenFile={vi.fn()} />, {
				wrapper: wrapper(test.container),
			});
			expect(await screen.findAllByRole("columnheader")).toHaveLength(2);
		} finally {
			test.close();
		}
	});

	it("opens a file too large to show in the default Open in app", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-large",
			});
			test.memory.controls.files.set(`${workspace.path}/big.log`, "big");
			vi.spyOn(test.container.services.workspaceFiles, "readContent").mockResolvedValue(
				ok({ kind: "too_large", sizeBytes: 64 * 1024 * 1024 }),
			);
			expect((await test.container.actions.settings.set("default_open_in", "Zed")).ok).toBe(true);
			const openWith = vi.spyOn(test.container.platform.opener, "openWith");
			render(<FilePreviewPane workspaceId={workspace.id} path="big.log" onOpenFile={vi.fn()} />, {
				wrapper: wrapper(test.container),
			});
			expect(await screen.findByText("File is too large")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Open in another app" }));

			await waitFor(() =>
				expect(openWith).toHaveBeenCalledWith("Zed", `${workspace.path}/big.log`),
			);
		} finally {
			test.close();
		}
	});

	it("shows 'No default app configured' when Open in has no default app", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-no-app",
			});
			vi.spyOn(test.container.services.workspaceFiles, "readContent").mockResolvedValue(
				ok({ kind: "too_large", sizeBytes: 64 * 1024 * 1024 }),
			);
			const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
			render(<FilePreviewPane workspaceId={workspace.id} path="big.log" onOpenFile={vi.fn()} />, {
				wrapper: wrapper(test.container),
			});

			fireEvent.click(await screen.findByRole("button", { name: "Open in another app" }));

			await waitFor(() =>
				expect(toasted).toHaveBeenCalledWith("No default app configured", expect.anything()),
			);
		} finally {
			test.close();
		}
	});

	it("reveals a file with no preview in Finder", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-binary",
			});
			test.memory.controls.files.set(`${workspace.path}/data.bin`, "bytes");
			vi.spyOn(test.container.services.workspaceFiles, "readContent").mockResolvedValue(
				ok({ kind: "binary", sizeBytes: 5, modifiedAt: 0, previewUrl: null }),
			);
			const reveal = vi.spyOn(test.container.platform.opener, "revealInFinder");
			render(<FilePreviewPane workspaceId={workspace.id} path="data.bin" onOpenFile={vi.fn()} />, {
				wrapper: wrapper(test.container),
			});

			fireEvent.click(await screen.findByRole("button", { name: "Reveal in Finder" }));

			await waitFor(() => expect(reveal).toHaveBeenCalledWith(`${workspace.path}/data.bin`));
			expect(screen.getByRole("button", { name: "Open in another app" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("opens a Markdown link as a workspace file and loads a relative image from the workspace", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/preview-links",
			});
			test.memory.controls.files.set(
				`${workspace.path}/docs/notes.md`,
				"[the guide](guide.md)\n\n![chart](img/chart.png)\n",
			);
			const onOpenFile = vi.fn();
			const { container } = render(
				<FilePreviewPane workspaceId={workspace.id} path="docs/notes.md" onOpenFile={onOpenFile} />,
				{ wrapper: wrapper(test.container) },
			);

			fireEvent.click(await screen.findByRole("link", { name: "the guide" }));

			expect(onOpenFile).toHaveBeenCalledWith("docs/guide.md");
			await waitFor(() =>
				expect(container.querySelector("img")?.getAttribute("src")).toBe(
					`asset://localhost/${encodeURIComponent(`${workspace.path}/docs/img/chart.png`)}`,
				),
			);
		} finally {
			test.close();
		}
	});
});
