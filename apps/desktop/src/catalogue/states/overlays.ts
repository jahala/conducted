/**
 * @feature catalogue States of the command palette, the file viewer and the scripts panel
 * Owns: the command palette open over a workspace, the Passport opened from it, the Feedback dialog (opened as Send feedback opens it), the Clone GitHub repo dialog with its repository lists, a code file open in the file viewer, the file viewer
 * for a file that is gone (its error state), a browser tab waiting for its dev server, and the scripts panel's Run tab before and after its dev
 * script ran. The in-memory Platform ends a command's terminal at once (platform/memory.ts), so a script
 * that is still running cannot be shown.
 * Behaviour: ui-map.md 5.1 (command palette), 3.4 (file tab), 3.7 (scripts panel).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { useOverlayStore } from "../../app/overlay-store.ts";
import { chatRoute, refreshGit, seedCast, workspaceRoute } from "../cast.ts";
import { click, has, pressUntilTaken, shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";

export const OVERLAY_STATES: CatalogueState[] = [
	{
		id: "command-palette",
		group: "Overlays and panels",
		title: "Command palette open",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await pressUntilTaken(document, "k", { meta: true });
				},
				ready: (document) => document.querySelector('[aria-label="Command palette tabs"]') !== null,
			};
		},
	},
	{
		id: "passport",
		group: "Overlays and panels",
		title: "The Passport, opened from the command palette",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await pressUntilTaken(document, "k", { meta: true });
					await click(document, "[role=option]", "Passport", { prefix: true });
				},
				ready: (document) => shows(document, "CITIES VISITED"),
			};
		},
	},
	{
		// A tall dialog: its lists of repositories reach below a laptop window's fold, so the dialog
		// must stay inside the window and scroll, as Conductor's does.
		id: "clone-github-dialog",
		group: "Overlays and panels",
		title: "Clone GitHub repo dialog with its repositories",
		seed: async (world) => {
			await seedCast(world);
			const row = (name: string, description: string, isPrivate = false) => ({
				name,
				owner: { login: "sam" },
				description,
				isPrivate,
				url: `https://github.com/sam/${name}`,
				sshUrl: `git@github.com:sam/${name}.git`,
				updatedAt: "2026-11-02T10:00:00Z",
			});
			const answer = (stdout: string) => ({
				ok: true as const,
				value: { stdout, stderr: "", exitCode: 0 },
			});
			world.scriptShell((command) => {
				if (command.program !== "gh") return null;
				const args = command.args.join(" ");
				if (args === "api user/orgs --paginate --jq .[].login") return answer("");
				if (args.startsWith("api user/repos")) {
					// GitHub's REST shape, which the Recent repos list reads.
					const recent = (name: string, description: string) => ({
						name,
						owner: { login: "sam" },
						updated_at: "2026-11-02T10:00:00Z",
						description,
						private: true,
						clone_url: `https://github.com/sam/${name}.git`,
						ssh_url: `git@github.com:sam/${name}.git`,
					});
					return answer(
						JSON.stringify([
							recent("atlas", "The marketing site and its blog"),
							recent("relay", "Webhook relay with retries and a dead-letter queue"),
							recent("ledger", "Double-entry bookkeeping for the billing service"),
						]),
					);
				}
				if (args.startsWith("repo list ")) {
					return answer(
						JSON.stringify([
							row("atlas", "The marketing site and its blog"),
							row("relay", "Webhook relay with retries and a dead-letter queue"),
							row("ledger", "Double-entry bookkeeping for the billing service"),
							row("tern", "A tiny command-line task runner"),
						]),
					);
				}
				return null;
			});
			return {
				route: "/",
				after: ({ document }) => click(document, "button", "Open GitHub project"),
				ready: (document) => shows(document, "Recent repos"),
			};
		},
	},
	{
		id: "feedback-dialog",
		group: "Overlays and panels",
		title: "Feedback dialog",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				// The app.sendFeedback command's own step: show the overlay.
				after: async () => useOverlayStore.getState().show("feedback"),
				ready: (document) => shows(document, "Your email"),
			};
		},
	},
	{
		id: "file-viewer",
		group: "Overlays and panels",
		title: "File viewer with a code file, opened from All files",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				// As in Conductor's capture: All files, then one click per folder and on the file.
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button,[role=tab]", "All files");
					await click(document, '[role="treeitem"]', "src");
					await click(document, '[role="treeitem"]', "auth");
					await click(document, '[role="treeitem"]', "safe-next.ts");
				},
				ready: (document) =>
					document
						.querySelector("[data-file-viewer] .cm-content")
						?.textContent?.includes("safeNext") === true,
			};
		},
	},
	{
		id: "file-viewer-missing",
		group: "Overlays and panels",
		title: "File viewer for a file that is gone (error)",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: workspaceRoute(cast.arbor, {
					tab: "file",
					path: "src/auth/old-login.ts",
					fileMode: "edit",
				}),
				after: ({ app }) => refreshGit(app, cast.arbor),
			};
		},
	},
	{
		id: "browser-tab-starting",
		group: "Overlays and panels",
		title: "Browser tab while the dev server has not answered yet",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				// arbor's own port, where nothing listens in the catalogue.
				route: workspaceRoute(cast.arbor, {
					tab: "browser",
					browserUrl: `http://localhost:${cast.arbor.port}/`,
				}),
				ready: (document) =>
					has(document, "button", "Reload") && shows(document, "Starting preview"),
			};
		},
	},
	{
		id: "scripts-run",
		group: "Overlays and panels",
		title: "Scripts panel, Run tab with the project's run actions",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button,[role=tab]", "Run");
				},
				ready: (document) => shows(document, "Run Dev"),
			};
		},
	},
	{
		id: "scripts-run-ended",
		group: "Overlays and panels",
		title: "Scripts panel, Run tab after the dev script ended",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button,[role=tab]", "Run");
					await click(document, "button", "Run Dev");
				},
				ready: (document) => shows(document, "Shell exited"),
			};
		},
	},
];
