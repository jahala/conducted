/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: tests for the visualization frame: the outside-workspace notice, the sandboxed frame and
 * its "Open" button, the load failure that recovers when the file appears, the frame following its
 * content's height, and a reload after the file changes on disk.
 * Behaviour: inventory-ui-text.md ("Codex inline visualizations"); ui-map.md 3.3.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:"
 * with the path and loads no frame.
 */
import type { WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { CodexVisualization } from "./CodexVisualization.tsx";

interface MountOptions {
	/** The file's text. Null leaves the file out. */
	html?: string | null;
	/** Where the file is written, relative to the workspace root. */
	file?: string;
	/** The path the component is given, when it differs from the file. */
	display?: (workspacePath: string) => string;
}

interface Mounted {
	test: TestContainer;
	client: QueryClient;
	workspaceId: WorkspaceId;
	onOpen: (path: string) => void;
	/** Writes a file into the workspace and moves the clock, so the modified time changes. */
	write: (text: string) => Promise<void>;
	/** Reads the modified time again, as the open-file poll does. */
	refresh: () => Promise<void>;
}

const mounted: Mounted[] = [];
let now = 1_700_000_000_000;

afterEach(async () => {
	cleanup();
	for (const entry of mounted.splice(0)) {
		entry.client.clear();
		await entry.test.container.stop();
		entry.test.close();
	}
});

async function mount(options: MountOptions = {}): Promise<Mounted> {
	const file = options.file ?? "viz/chart.html";
	const test = createTestContainer({ clock: { now: () => now } });
	const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/viz" });
	if (options.html !== undefined && options.html !== null) {
		await test.container.platform.fs.writeTextAtomic(`${workspace.path}/${file}`, options.html);
	}
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, networkMode: "always" } },
	});
	const onOpen = vi.fn<(path: string) => void>();
	const entry: Mounted = {
		test,
		client,
		workspaceId: workspace.id,
		onOpen,
		write: async (text) => {
			now += 1_000;
			await test.container.platform.fs.writeTextAtomic(`${workspace.path}/${file}`, text);
		},
		refresh: async () => {
			await act(() =>
				client.refetchQueries({
					queryKey: ["files", "content", workspace.id, file, "modified-at"],
				}),
			);
		},
	};
	mounted.push(entry);
	const path = options.display === undefined ? file : options.display(workspace.path);
	render(
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>
				<CodexVisualization workspaceId={workspace.id} path={path} onOpen={onOpen} />
			</ServicesProvider>
		</QueryClientProvider>,
	);
	return entry;
}

describe("CHAT-22 Codex visualization", () => {
	it("renders the file inside a script-running frame that cannot reach the app's origin", async () => {
		await mount({ html: "<h1>Revenue chart</h1>" });
		const frame = (await screen.findByTitle("Visualization")) as HTMLIFrameElement;
		const documentText = frame.getAttribute("srcdoc") ?? "";
		expect(documentText).toContain("<h1>Revenue chart</h1>");
		expect(documentText).toContain("Content-Security-Policy");
		expect(documentText).toContain("default-src 'none'");
		const sandbox = frame.getAttribute("sandbox") ?? "";
		expect(sandbox.split(/\s+/)).toContain("allow-scripts");
		expect(sandbox).not.toContain("allow-same-origin");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
	});

	it("opens the file by its path inside the workspace", async () => {
		const entry = await mount({ html: "<p>Hi</p>" });
		await screen.findByTitle("Visualization");
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(entry.onOpen).toHaveBeenCalledWith("viz/chart.html");
	});

	it("accepts an absolute path inside the workspace", async () => {
		const entry = await mount({
			html: "<p>Hi</p>",
			display: (workspacePath) => `${workspacePath}/viz/chart.html`,
		});
		await screen.findByTitle("Visualization");
		fireEvent.click(screen.getByRole("button", { name: "Open" }));
		expect(entry.onOpen).toHaveBeenCalledWith("viz/chart.html");
	});

	it("follows the content height up to its maximum", async () => {
		await mount({ html: "<p>Hi</p>" });
		const frame = (await screen.findByTitle("Visualization")) as HTMLIFrameElement;
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "conducted-visualization", height: 10_000 },
					source: frame.contentWindow,
				}),
			);
		});
		expect(frame.style.height).toBe("480px");
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "conducted-visualization", height: 120 },
					source: frame.contentWindow,
				}),
			);
		});
		expect(frame.style.height).toBe("120px");
	});

	it("ignores a height message from another window", async () => {
		await mount({ html: "<p>Hi</p>" });
		const frame = (await screen.findByTitle("Visualization")) as HTMLIFrameElement;
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "conducted-visualization", height: 10_000 },
					source: window,
				}),
			);
		});
		expect(frame.style.height).toBe("96px");
	});

	it("reloads the frame when the file changes on disk", async () => {
		const entry = await mount({ html: "<p>First</p>" });
		expect((await screen.findByTitle("Visualization")).getAttribute("srcdoc")).toContain("First");
		await entry.write("<p>Second</p>");
		await entry.refresh();
		await waitFor(() =>
			expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Second"),
		);
	});

	it("recovers when a missing file appears", async () => {
		const entry = await mount({ html: null });
		await screen.findByText("Couldn’t load visualization");
		expect(document.querySelector("iframe")).toBeNull();
		await entry.write("<p>Now here</p>");
		await entry.refresh();
		await waitFor(() =>
			expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Now here"),
		);
	});

	it("shows the load failure for a workspace that no longer exists", async () => {
		const entry = await mount({ html: "<p>Hi</p>" });
		cleanup();
		render(
			<QueryClientProvider client={entry.client}>
				<ServicesProvider container={entry.test.container}>
					<CodexVisualization
						workspaceId={"gone" as WorkspaceId}
						path="viz/chart.html"
						onOpen={entry.onOpen}
					/>
				</ServicesProvider>
			</QueryClientProvider>,
		);
		await screen.findByText("Couldn’t load visualization");
		expect(document.querySelector("iframe")).toBeNull();
	});
});

describe("CHAT-22 path outside the workspace", () => {
	it("shows the notice and the path for a relative path that climbs out", async () => {
		await mount({ html: null, display: () => "../outside.html" });
		expect(await screen.findByText("Visualization is outside the workspace:")).toBeTruthy();
		expect(screen.getByText("../outside.html")).toBeTruthy();
		expect(document.querySelector("iframe")).toBeNull();
	});

	it("shows the notice for an absolute path outside the workspace", async () => {
		await mount({ html: null, display: () => "/tmp/elsewhere/chart.html" });
		expect(await screen.findByText("Visualization is outside the workspace:")).toBeTruthy();
		expect(screen.getByText("/tmp/elsewhere/chart.html")).toBeTruthy();
		expect(document.querySelector("iframe")).toBeNull();
	});

	it("treats a home-relative path as outside the workspace", async () => {
		await mount({ html: null, display: () => "~/chart.html" });
		expect(await screen.findByText("Visualization is outside the workspace:")).toBeTruthy();
		expect(screen.getByText("~/chart.html")).toBeTruthy();
		expect(document.querySelector("iframe")).toBeNull();
	});
});
