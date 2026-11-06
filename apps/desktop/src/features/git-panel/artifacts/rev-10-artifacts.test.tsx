/**
 * @feature REV-10 Artifacts tab
 * Owns: tests for the Artifacts tab body over the real container: the file list, the hover
 * "Attach to chat", "Upload files", the preview and port cards, the loading text and the omitted
 * notice.
 * Behaviour: services-map.md 5A.5.1, 5A.6.2; ui-map.md 3.6.
 * Test first: a `.context/notes.md` file is listed with an "Attach to chat" button.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok, type Result, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { ArtifactPage } from "../../../platform/platform.ts";
import { createTestContainer, seedWorkspace } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { ArtifactsTab } from "./ArtifactsTab.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
});

function renderTab(
	container: ReturnType<typeof createTestContainer>["container"],
	workspaceId: WorkspaceId,
) {
	return render(
		<ServicesProvider container={container}>
			<ArtifactsTab workspaceId={workspaceId} />
		</ServicesProvider>,
	);
}

describe("REV-10 artifacts tab", () => {
	it("lists .context files and attaches one to the active chat", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/artifacts" });
			test.memory.controls.files.set("/ws/artifacts/.context/notes.md", "notes");
			must(await test.container.services.sessions.start());
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.workspace.setActiveSession(workspace.id, session.id));
			const view = renderTab(test.container, workspace.id);

			expect(await screen.findByText("notes.md")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Attach to chat" }));

			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toEqual([
					"/ws/artifacts/.context/notes.md",
				]),
			);
			view.unmount();
		} finally {
			test.close();
		}
	});

	it("uploads picked files into .context and lists them", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/upload" });
			test.memory.controls.files.set("/picked/photo.png", "image bytes");
			test.memory.controls.queueDialogAnswers({ files: ["/picked/photo.png"] });
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "cp") return null;
				const [, source, target] = command.args;
				const contents = source === undefined ? undefined : test.memory.controls.files.get(source);
				if (contents === undefined || target === undefined) {
					return ok({ exitCode: 1, stdout: "", stderr: "missing source" });
				}
				test.memory.controls.files.set(target, contents);
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});
			const view = renderTab(test.container, workspace.id);

			fireEvent.click(await screen.findByRole("button", { name: "Upload files" }));

			expect(await screen.findByText("photo.png")).toBeTruthy();
			view.unmount();
		} finally {
			test.close();
		}
	});

	it("shows a preview URL and a forwarded port in the same list as the files", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/cards" });
			test.memory.controls.files.set("/ws/cards/.context/notes.md", "notes");
			test.container.services.runScripts.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspace.id]: {
						actions: [],
						running: [
							{
								actionId: "dev",
								terminalId: "t1" as TerminalId,
								url: "http://localhost:5173",
								phase: "running",
							},
						],
						spotlight: { active: false, terminalId: null },
						detectedPorts: [{ port: 3000, pid: 12, processName: "node", appName: null }],
					},
				},
			}));
			const view = renderTab(test.container, workspace.id);

			expect(await screen.findByText("Preview URL")).toBeTruthy();
			expect(screen.getByText("Forwarded port 3000")).toBeTruthy();
			expect(screen.getByText("notes.md")).toBeTruthy();
			expect(screen.getByRole("list", { name: "Artifacts" })).toBeTruthy();
			view.unmount();
		} finally {
			test.close();
		}
	});

	it("shows the loading text and then the omitted-file notice", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/slow" });
			let finish: (value: Result<ArtifactPage>) => void = () => {};
			const pending = new Promise<Result<ArtifactPage>>((resolve) => {
				finish = resolve;
			});
			vi.spyOn(test.memory.platform.fileSearch, "listArtifacts").mockReturnValue(pending);
			const view = renderTab(test.container, workspace.id);

			expect(await screen.findByText("Loading artifacts...")).toBeTruthy();
			finish(
				ok({
					entries: [
						{
							path: "/ws/slow/.context/notes.md",
							isDirectory: false,
							isSymlink: false,
							size: 5,
							modifiedAt: 1,
						},
					],
					nextCursor: null,
					omitted: 2,
				}),
			);

			expect(await screen.findByText("2 files are left out of this list.")).toBeTruthy();
			expect(screen.getByText("notes.md")).toBeTruthy();
			view.unmount();
		} finally {
			test.close();
		}
	});
});
