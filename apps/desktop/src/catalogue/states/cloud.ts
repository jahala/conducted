/**
 * @feature catalogue States of a cloud workspace's port forwarding, shared preview URL and file sync
 * Owns: a cloud workspace open on its Ports tab with a forwarded port and a detected one, the
 * Forward ports popover, the Choose preview URL port picker, the Waiting for ports state, the
 * workspace actions menu's Pause port forwarding dialog, the file-sync states in the scripts
 * panel and the header popover (CLOUD-09, CLOUD-11), a sandbox whose disk is nearly full, and the
 * Open in menu on a Mac with none of the remote editors.
 * Behaviour: ui-map.md 3.7 (the Ports tab, its popover and the file-sync states), 5.2 (the
 * workspace actions menu), 4 (the sidebar's Forwarding ports badge); the words are Conductor's.
 * Our design choice: the Worker answers the catalogue's cloud requests through the memory
 * Platform's scriptCloud, exactly as the app asks a real one; the workspace's forward rows and
 * switches are written through its own repositories before the app starts.
 * Test first: not applicable; the screenshot run opens every state.
 */

import { ok } from "@conducted/shared";
import type { Workspace } from "../../core/model.ts";
import { seedCast, workspaceRoute } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { addWorkspace, must, setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

/** Lets React effects (the sync a panel starts on mount) run, so a state can show their next step. */
async function frames(count: number): Promise<void> {
	for (let index = 0; index < count; index += 1) {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
}

const CLOUD = {
	kind: "cloud" as const,
	url: "https://cloud.example.dev",
	vmId: "oslo",
};

interface CloudOptions {
	/** Whether the Worker lists a message-free tree, or fails the file list. */
	files?: "ok" | "failed";
	/** The sandbox's listening ports. */
	ports?: { port: number; processName: string }[];
	/** The Advanced setting, which also gives the workspace its Sync files switch, as a create does. */
	autoSync?: boolean;
	/** A forward the catalogue writes before start, with its workspace switch on. */
	forward?: { remotePort: number; localPort: number };
	/** More forwards, such as one whose sandbox port is gone. */
	extraForwards?: { remotePort: number; localPort: number }[];
	/** The sandbox's disk nearly full: 200 MB left of 4 GB. */
	lowDisk?: boolean;
}

/** The cloud requests every state needs: the workspace's state, its ports and its file list. */
function scriptCloud(world: World, options: CloudOptions = {}): void {
	const files = options.files ?? "ok";
	const ports = options.ports ?? [];
	world.memory.controls.scriptCloud((request) => {
		if (request.path === `/w/${CLOUD.vmId}/state`) {
			return ok({
				status: 200,
				body: JSON.stringify({
					running: true,
					resources: {
						cpu: { capacityCores: 0.25, usedPercent: 12 },
						memory: { totalBytes: 1024 ** 3, usedPercent: 20 },
						disk:
							options.lowDisk === true
								? { totalBytes: 4 * 1024 ** 3, availableBytes: 200 * 1024 ** 2, usedPercent: 95 }
								: { totalBytes: 4 * 1024 ** 3, availableBytes: 2 * 1024 ** 3, usedPercent: 50 },
					},
				}),
			});
		}
		if (request.path === `/w/${CLOUD.vmId}/ports`) {
			return ok({ status: 200, body: JSON.stringify({ ports }) });
		}
		if (request.path === `/w/${CLOUD.vmId}/files`) {
			if (files === "failed") {
				return ok({ status: 500, body: JSON.stringify({ error: "sandbox asleep" }) });
			}
			const body = (request.body ?? {}) as { operation?: string; path?: string };
			const binary = body.path?.endsWith("logo.png") === true;
			const text = "export const app = 1;\n";
			const base64 = binary ? "AA==" : "ZXhwb3J0IGNvbnN0IGFwcCA9IDE7Cg==";
			if (body.operation === "list") {
				return ok({
					status: 200,
					body: JSON.stringify({
						entries: [
							{
								path: `/workspace/${CLOUD.vmId}/src/app.ts`,
								isDirectory: false,
								isSymlink: false,
								size: text.length,
								modifiedAt: 0,
							},
							{
								path: `/workspace/${CLOUD.vmId}/assets/logo.png`,
								isDirectory: false,
								isSymlink: false,
								size: 1,
								modifiedAt: 0,
							},
						],
						truncated: false,
					}),
				});
			}
			if (body.operation === "read") return ok({ status: 200, body: JSON.stringify({ text }) });
			if (body.operation === "readBytes") {
				return ok({ status: 200, body: JSON.stringify({ base64 }) });
			}
			if (body.operation === "stat") {
				return ok({
					status: 200,
					body: JSON.stringify({
						stat: {
							path: body.path ?? "",
							isDirectory: false,
							isSymlink: false,
							size: binary ? 1 : text.length,
							modifiedAt: 0,
						},
					}),
				});
			}
			if (body.operation === "exists")
				return ok({ status: 200, body: JSON.stringify({ exists: true }) });
			return ok({ status: 200, body: "{}" });
		}
		return null;
	});
}

/**
 * Shows the workspace's Sync files switch on in the workspace store without saving it or starting
 * a sync, so a state can hold a sync view still for its picture.
 */
function switchOnInStore(app: AfterContext["app"], workspace: Workspace): void {
	app.container.services.workspace.store.setState((state) => {
		const current = state.workspacesById[workspace.id];
		if (current === undefined) return state;
		return {
			...state,
			workspacesById: {
				...state.workspacesById,
				[workspace.id]: { ...current, remoteFileSyncEnabled: true },
			},
		};
	});
}

/** Adds a ready cloud workspace to the cast's atlas project and scripts its Worker. */
async function cloudWorkspace(
	world: World,
	name: string,
	options: CloudOptions = {},
): Promise<{ workspace: Workspace; scene: Omit<Scene, "after" | "ready"> }> {
	const cast = await seedCast(world);
	scriptCloud(world, options);
	const autoSync = options.autoSync ?? true;
	await setSetting(world, "auto_sync_files_in_new_cloud_workspaces", autoSync);
	const workspace = await addWorkspace(world, cast.atlas, {
		name,
		displayName: name,
		host: CLOUD,
		remoteFileSyncEnabled: autoSync,
	});
	const forwards = [
		...(options.forward === undefined ? [] : [options.forward]),
		...(options.extraForwards ?? []),
	];
	for (const forward of forwards) {
		must(
			await world.repositories.portForwards.add({
				workspaceId: workspace.id,
				remotePort: forward.remotePort,
				localPort: forward.localPort,
				label: null,
				autoDetected: false,
				enabled: true,
			}),
		);
	}
	if (forwards.length > 0) {
		must(await world.repositories.portForwards.setForwardingEnabled(workspace.id, true));
	}
	return { workspace, scene: { route: workspaceRoute(workspace) } };
}

const portsState = (
	id: string,
	title: string,
	text: string,
	options: CloudOptions & { then?: (scene: Scene, workspace: Workspace) => void },
): CatalogueState => ({
	id,
	group: "Cloud",
	title,
	seed: async (world): Promise<Scene> => {
		const { workspace, scene } = await cloudWorkspace(world, "preview", options);
		return {
			...scene,
			after: async (context) => {
				await click(context.document, "[role=tab]", "Ports", { prefix: true });
				options.then?.(scene, workspace);
			},
			ready: (document) => shows(document, text),
		};
	},
});

const syncState = (
	id: string,
	title: string,
	text: string,
	options: CloudOptions & { openRow?: boolean; clickName?: string; clickPrefix?: boolean },
): CatalogueState => ({
	id,
	group: "Cloud",
	title,
	seed: async (world): Promise<Scene> => {
		const { workspace, scene } = await cloudWorkspace(world, "sync", options);
		return {
			...scene,
			after: async (context) => {
				await click(context.document, "[role=tab]", "Ports", { prefix: true });
				if (options.clickName !== undefined) {
					await click(context.document, "button", options.clickName, {
						prefix: options.clickPrefix ?? false,
					});
				}
			},
			ready: (document) => shows(document, text),
		};
	},
});

export const CLOUD_STATES: CatalogueState[] = [
	{
		id: "cloud-open-in-no-apps",
		group: "Cloud",
		title: "Cloud workspace's Open in menu on a Mac with none of the three remote editors",
		seed: async (world): Promise<Scene> => {
			const { scene } = await cloudWorkspace(world, "preview");
			world.memory.platform.opener.installedApps = async () => ["Finder", "Ghostty", "Fork"];
			return {
				...scene,
				after: ({ document }) => click(document, "button", "Open in menu"),
				ready: (document) => shows(document, "No apps available"),
			};
		},
	},
	portsState(
		"cloud-ports",
		"Cloud workspace Ports tab: one forwarded port, a detected one and the preview URL row",
		"Forwarding ports",
		{
			ports: [
				{ port: 3000, processName: "node" },
				{ port: 5173, processName: "vite" },
			],
			forward: { remotePort: 3000, localPort: 20000 },
		},
	),
	{
		id: "cloud-ports-popover",
		group: "Cloud",
		title: "Cloud workspace Ports tab with the Forward ports popover open",
		seed: async (world): Promise<Scene> => {
			const { workspace, scene } = await cloudWorkspace(world, "preview", {
				ports: [
					{ port: 3000, processName: "node" },
					{ port: 5173, processName: "vite" },
				],
				forward: { remotePort: 3000, localPort: 20000 },
				extraForwards: [{ remotePort: 4000, localPort: 20001 }],
			});
			return {
				...scene,
				after: async ({ document }) => {
					await click(document, "[role=tab]", "Ports", { prefix: true });
					await click(document, "button", "Forward ports");
				},
				ready: (document) =>
					shows(document, "Ports detected") &&
					shows(document, "Forward port") &&
					shows(document, "Ports unavailable"),
			};
		},
	},
	{
		id: "cloud-preview-picker",
		group: "Cloud",
		title: "Cloud workspace Ports tab with the Choose preview URL port picker open",
		seed: async (world): Promise<Scene> => {
			const { scene } = await cloudWorkspace(world, "preview", {
				ports: [
					{ port: 3000, processName: "node" },
					{ port: 5173, processName: "vite" },
				],
				forward: { remotePort: 3000, localPort: 20000 },
			});
			return {
				...scene,
				after: async ({ document }) => {
					await click(document, "[role=tab]", "Ports", { prefix: true });
					await click(document, "button", "Choose preview URL port");
				},
				ready: (document) =>
					shows(document, "Select a port to share via a URL. Workspace read permissions required."),
			};
		},
	},
	portsState(
		"cloud-ports-waiting",
		"Cloud workspace Ports tab forwarding with no listening port yet",
		"Waiting for ports",
		{
			forward: { remotePort: 3000, localPort: 20000 },
			ports: [],
		},
	),
	{
		id: "cloud-low-disk",
		group: "Cloud",
		title: "Cloud workspace whose sandbox disk is nearly full",
		seed: async (world): Promise<Scene> => {
			const { scene } = await cloudWorkspace(world, "preview", { lowDisk: true });
			return { ...scene, ready: (document) => shows(document, "Low disk") };
		},
	},
	{
		id: "cloud-actions-pause",
		group: "Cloud",
		title: "Cloud workspace actions menu: Pause port forwarding?",
		seed: async (world): Promise<Scene> => {
			const { scene } = await cloudWorkspace(world, "preview", {
				ports: [{ port: 3000, processName: "node" }],
				forward: { remotePort: 3000, localPort: 20000 },
			});
			return {
				...scene,
				after: async ({ document }) => {
					await click(document, "button", "preview · Running", { prefix: true });
					await click(document, "button", "Workspace actions");
					await click(document, "[role=menuitem]", "Pause port forwarding");
				},
				ready: (document) => shows(document, "Pause port forwarding?"),
			};
		},
	},
	{
		id: "cloud-sync-unavailable",
		group: "Cloud",
		title: "Cloud workspace header: Sync folder unavailable and where the mirror belongs",
		seed: async (world): Promise<Scene> => {
			const { workspace, scene } = await cloudWorkspace(world, "sync", { autoSync: false });
			return {
				...scene,
				after: async ({ app, document }) => {
					const service = app.container.services.cloudFileSync;
					await frames(6);
					switchOnInStore(app, workspace);
					service.store.setState((state) => {
						const byWorkspace = { ...state.byWorkspace };
						delete byWorkspace[workspace.id];
						return { ...state, byWorkspace };
					});
					await click(document, "[role=tab]", "Ports", { prefix: true });
				},
				ready: (document) => shows(document, "Sync folder unavailable"),
			};
		},
	},
	{
		id: "cloud-sync-syncing",
		group: "Cloud",
		title: "Cloud workspace scripts panel: Syncing…",
		seed: async (world): Promise<Scene> => {
			const { workspace, scene } = await cloudWorkspace(world, "sync", { autoSync: false });
			return {
				...scene,
				after: async ({ app, document }) => {
					const service = app.container.services.cloudFileSync;
					const mirror = service.mirrorPathOf(workspace.id);
					await frames(6);
					switchOnInStore(app, workspace);
					service.store.setState((state) => ({
						...state,
						byWorkspace: {
							...state.byWorkspace,
							[workspace.id]: {
								state: "syncing",
								mirrorPath: mirror.ok ? mirror.value : "",
								lastSyncedAt: null,
								error: null,
								files: 0,
								truncated: false,
							},
						},
					}));
					await click(document, "[role=tab]", "Ports", { prefix: true });
				},
				ready: (document) => shows(document, "Syncing…"),
			};
		},
	},
	{
		id: "cloud-local-terminal-not-ready",
		group: "Cloud",
		title: "Cloud workspace: the Local terminal is refused before the workspace is ready",
		seed: async (world): Promise<Scene> => {
			const { workspace, scene } = await cloudWorkspace(world, "sync", { autoSync: false });
			must(
				await world.repositories.workspaces.transitionState(workspace.id, "ready", "initializing"),
			);
			return {
				...scene,
				after: async ({ document }) => {
					await click(document, "button", "New terminal");
					await click(document, "[role=menuitem]", "Local terminal");
				},
				ready: (document) => shows(document, "The workspace is not ready yet."),
			};
		},
	},
	{
		id: "cloud-local-terminal-off",
		group: "Cloud",
		title: "Cloud workspace: the Local terminal is refused while Sync files is off",
		seed: async (world): Promise<Scene> => {
			const { scene } = await cloudWorkspace(world, "sync", { autoSync: false });
			return {
				...scene,
				after: async ({ document }) => {
					await click(document, "[role=tab]", "Ports", { prefix: true });
					await click(document, "button", "New terminal");
					await click(document, "[role=menuitem]", "Local terminal");
				},
				ready: (document) =>
					shows(document, "Sync files needs to be ready before this terminal starts."),
			};
		},
	},
	{
		id: "cloud-local-terminal-failed",
		group: "Cloud",
		title: "Cloud workspace: the Local terminal is refused while Sync files failed",
		seed: async (world): Promise<Scene> => {
			const { scene } = await cloudWorkspace(world, "sync", { files: "failed" });
			return {
				...scene,
				after: async ({ document }) => {
					await click(document, "[role=tab]", "Ports", { prefix: true });
					await click(document, "button", "New terminal");
					await click(document, "[role=menuitem]", "Local terminal");
				},
				ready: (document) =>
					shows(document, "The local terminal cannot start until Sync files recovers."),
			};
		},
	},
	syncState(
		"cloud-sync-off",
		"Cloud workspace scripts panel: Sync files is off",
		"Sync files is off. Local files may be outdated.",
		{ autoSync: false },
	),
	syncState(
		"cloud-sync-failed",
		"Cloud workspace scripts panel: Sync files failed",
		"Sync files failed",
		{ files: "failed" },
	),
	syncState(
		"cloud-sync-row",
		"Cloud workspace header: the Sync files row, its switch and the local folder",
		"Mirrors this cloud workspace to a local folder for local tools.",
		{ autoSync: false, openRow: true, clickName: "sync · Running", clickPrefix: true },
	),
	syncState(
		"cloud-sync-error",
		"Cloud workspace header: a failed sync with Conductor's Sync failed and Internal sync error",
		"Internal sync error",
		{ files: "failed", openRow: true, clickName: "sync · Running", clickPrefix: true },
	),
];
