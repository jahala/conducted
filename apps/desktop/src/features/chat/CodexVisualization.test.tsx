/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: tests for the visualization frame: the outside-workspace notice, the sandboxed frame served
 * from the visualization scheme and its "Open" button, the page dropped when the frame goes, the
 * load failure that recovers when the file appears, the frame following its content's height, and
 * a reload after the file changes on disk.
 * Behaviour: inventory-ui-text.md ("Codex inline visualizations"); ui-map.md 3.3.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:"
 * with the path and loads no frame.
 */
import type { Result, WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { VISUALIZATION_MAX_STORE_BYTES, type VisualizationPage } from "../../platform/platform.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { CodexVisualization } from "./CodexVisualization.tsx";

interface MountOptions {
	/** The file's text. Null leaves the file out. */
	html?: string | null;
	/** Where the file is written, relative to the workspace root. */
	file?: string;
	/** The path the component is given, when it differs from the file. */
	display?: (workspacePath: string) => string;
	/** Holds every page the shell serves until this settles, as a slow shell would. */
	holdServe?: Promise<void>;
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
	/** The pages the visualization scheme would serve, by address. */
	pages: () => ReadonlyMap<string, string>;
	/** The shell's answer to every serve the frame asked for, in order. */
	serves: Promise<Result<VisualizationPage>>[];
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
		test.memory.controls.addFile(`${workspace.path}/${file}`, options.html);
	}
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, networkMode: "always" } },
	});
	const onOpen = vi.fn<(path: string) => void>();
	const visualizations = test.container.platform.visualizations;
	const serve = visualizations.serve;
	const held = options.holdServe ?? Promise.resolve();
	const serves: Promise<Result<VisualizationPage>>[] = [];
	visualizations.serve = (document) => {
		const answer = held.then(() => serve(document));
		serves.push(answer);
		return answer;
	};
	const entry: Mounted = {
		test,
		client,
		workspaceId: workspace.id,
		onOpen,
		write: async (text) => {
			now += 1_000;
			test.memory.controls.addFile(`${workspace.path}/${file}`, text);
		},
		refresh: async () => {
			await act(() =>
				client.refetchQueries({
					queryKey: ["files", "content", workspace.id, file, "modified-at"],
				}),
			);
		},
		pages: () => test.memory.controls.visualizationPages,
		serves,
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

/** Waits for the frame to get its address, and answers the page the scheme serves there. */
async function servedPage(entry: Mounted): Promise<{ frame: HTMLIFrameElement; page: string }> {
	const frame = (await screen.findByTitle("Visualization")) as HTMLIFrameElement;
	await waitFor(() => expect(frame.getAttribute("src")).toMatch(/^visualization:\/\/localhost\//));
	return { frame, page: entry.pages().get(frame.getAttribute("src") ?? "") ?? "" };
}

describe("CHAT-22 Codex visualization", () => {
	it("renders the file inside a script-running frame that cannot reach the app's origin", async () => {
		const entry = await mount({ html: "<h1>Revenue chart</h1>" });
		const { frame, page } = await servedPage(entry);
		expect(page).toContain("<h1>Revenue chart</h1>");
		expect(frame.hasAttribute("srcdoc")).toBe(false);
		expect(frame.getAttribute("src")).toMatch(/^visualization:\/\/localhost\/[^/]+$/);
		const sandbox = frame.getAttribute("sandbox") ?? "";
		expect(sandbox.split(/\s+/)).toContain("allow-scripts");
		expect(sandbox).not.toContain("allow-same-origin");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
	});

	it("keeps every script of the page in order and its doctype first, with the policy left to the scheme", async () => {
		const entry = await mount({
			html: '<!DOCTYPE html><script>early()</script><html><head><title>Chart</title></head><body><form action="https://example.com/collect"></form><script>late()</script></body></html>',
		});
		const { page } = await servedPage(entry);
		const parsed = new DOMParser().parseFromString(page, "text/html");

		// The policy travels as the page's header (visualization.rs), so it covers every script.
		expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')).toBeNull();
		expect(page.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(parsed.compatMode).toBe("CSS1Compat");
		const scripts = [...parsed.querySelectorAll("script")].map((script) => script.textContent);
		expect(scripts.filter((text) => text === "early()" || text === "late()")).toEqual([
			"early()",
			"late()",
		]);
		const height = [...parsed.querySelectorAll("script")].at(-1);
		for (const script of parsed.querySelectorAll("script")) {
			if (script === height) continue;
			const position = height?.compareDocumentPosition(script) ?? 0;
			expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBe(Node.DOCUMENT_POSITION_PRECEDING);
		}
	});

	it("gives two visualizations on screen their own pages", async () => {
		const first = await mount({ html: "<p>First chart</p>" });
		render(
			<QueryClientProvider client={first.client}>
				<ServicesProvider container={first.test.container}>
					<CodexVisualization
						workspaceId={first.workspaceId}
						path="viz/other.html"
						onOpen={first.onOpen}
					/>
				</ServicesProvider>
			</QueryClientProvider>,
		);
		first.test.memory.controls.addFile(
			"/code/workspaces/viz/viz/other.html",
			"<p>Second chart</p>",
		);
		await act(() => first.client.refetchQueries());
		// Wait for what the screen shows: the shell can hold both pages before React has put the
		// second page's address on its frame, which a busy machine shows as one frame.
		let sources: string[] = [];
		await waitFor(() => {
			sources = screen
				.getAllByTitle("Visualization")
				.map((frame) => frame.getAttribute("src") ?? "")
				.filter((source) => source !== "");
			expect(new Set(sources).size).toBe(2);
		});
		expect(first.pages().size).toBe(2);
		const pages = sources.map((source) => first.pages().get(source) ?? "");
		expect(pages.filter((page) => page.includes("First chart"))).toHaveLength(1);
		expect(pages.filter((page) => page.includes("Second chart"))).toHaveLength(1);
	});

	it("drops its page from the shell when the frame goes", async () => {
		const entry = await mount({ html: "<p>Hi</p>" });
		await servedPage(entry);
		expect(entry.pages().size).toBe(1);
		cleanup();
		await waitFor(() => expect(entry.pages().size).toBe(0));
	});

	it("drops a page the shell serves after the frame is gone", async () => {
		let answer: () => void = () => {};
		const holdServe = new Promise<void>((resolve) => {
			answer = resolve;
		});
		const entry = await mount({ html: "<p>Hi</p>", holdServe });
		await screen.findByTitle("Visualization");
		expect(entry.serves).toHaveLength(1);
		cleanup();
		answer();
		const served = await entry.serves[0];
		expect(served?.ok).toBe(true);
		if (served?.ok !== true) return;
		await waitFor(() => expect(entry.pages().has(served.value.url)).toBe(false));
		expect(entry.pages().size).toBe(0);
	});

	it("shows the load failure for a page too large for the shell to serve", async () => {
		await mount({ html: "x".repeat(VISUALIZATION_MAX_STORE_BYTES) });
		expect(await screen.findByText("Couldn’t load visualization")).toBeTruthy();
		expect(document.querySelector("iframe")).toBeNull();
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
		expect((await servedPage(entry)).page).toContain("First");
		await entry.write("<p>Second</p>");
		await entry.refresh();
		await waitFor(() =>
			expect(
				entry.pages().get(document.querySelector("iframe")?.getAttribute("src") ?? ""),
			).toContain("Second"),
		);
		await waitFor(() => expect(entry.pages().size).toBe(1));
	});

	it("recovers when a missing file appears", async () => {
		const entry = await mount({ html: null });
		await screen.findByText("Couldn’t load visualization");
		expect(document.querySelector("iframe")).toBeNull();
		await entry.write("<p>Now here</p>");
		await entry.refresh();
		await waitFor(() =>
			expect(
				entry.pages().get(document.querySelector("iframe")?.getAttribute("src") ?? ""),
			).toContain("Now here"),
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
