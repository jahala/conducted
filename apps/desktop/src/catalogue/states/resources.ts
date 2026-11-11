/**
 * @feature catalogue States of the resource chip's Resources popover
 * Owns: the popover open over made-up processes (never this Mac's), sorted by CPU, and grown with
 * "Show all" while the terminals' processes are included.
 * Behaviour: ui-map.md 1.3 (chip, header buttons, summary, the tree grouped under App and each
 * workspace, sorting, "Show all (n)").
 * Test first: not applicable; the screenshot run opens every state.
 */

import { type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

const MB = 1024 * 1024;

/** The most frames to wait for the composer to take focus, about five seconds at 60 a second. */
const MAX_FRAMES = 300;

/**
 * Waits until the composer has focused itself, as it does once its editor exists. A popover
 * opened before that closes when the focus moves.
 */
async function composerFocused(document: Document): Promise<void> {
	for (let frame = 0; frame < MAX_FRAMES; frame++) {
		if (document.activeElement?.getAttribute("aria-label") === "composer") return;
		await new Promise((resolve) => requestAnimationFrame(resolve));
	}
	throw new Error("The composer never took focus.");
}

/**
 * The app with its WebKit helpers and sidecar, two agents with the tools they started in arbor
 * and fjord, and a dev server in a terminal in arbor.
 */
function plantProcesses(world: World, cast: Cast): void {
	const arbor = cast.arbor.path;
	const fjord = cast.fjord.path;
	const app = "/Applications/Conducted.app";
	world.memory.controls.setProcesses([
		{ pid: 9100, ppid: 1, label: "Main", cpuPercent: 3.0, memoryBytes: 189 * MB, cwd: app },
		{ pid: 9101, ppid: 1, label: "Renderer", cpuPercent: 10.1, memoryBytes: 1065 * MB, cwd: "/" },
		{ pid: 9102, ppid: 1, label: "Networking", cpuPercent: 0, memoryBytes: 9.2 * MB, cwd: "/" },
		{ pid: 9103, ppid: 1, label: "GPU", cpuPercent: 0.4, memoryBytes: 61.5 * MB, cwd: "/" },
		{ pid: 9110, ppid: 9100, label: "Sidecar", cpuPercent: 0, memoryBytes: 133.4 * MB, cwd: app },
		{
			pid: 9200,
			ppid: 9110,
			label: "claude",
			cpuPercent: 38.2,
			memoryBytes: 462.1 * MB,
			cwd: arbor,
		},
		{ pid: 9201, ppid: 9200, label: "node", cpuPercent: 0.2, memoryBytes: 65.9 * MB, cwd: arbor },
		{ pid: 9202, ppid: 9200, label: "node", cpuPercent: 0, memoryBytes: 116.7 * MB, cwd: arbor },
		{ pid: 9203, ppid: 9200, label: "rg", cpuPercent: 12.4, memoryBytes: 4.6 * MB, cwd: arbor },
		{ pid: 9204, ppid: 9200, label: "git", cpuPercent: 1.1, memoryBytes: 3.8 * MB, cwd: arbor },
		{
			pid: 9300,
			ppid: 9110,
			label: "claude",
			cpuPercent: 0.4,
			memoryBytes: 439.1 * MB,
			cwd: fjord,
		},
		{ pid: 9301, ppid: 9300, label: "node", cpuPercent: 0, memoryBytes: 65.9 * MB, cwd: fjord },
		{ pid: 9302, ppid: 9300, label: "node", cpuPercent: 0, memoryBytes: 119.3 * MB, cwd: fjord },
		{
			pid: 9400,
			ppid: 9100,
			label: "zsh",
			cpuPercent: 0,
			memoryBytes: 5.1 * MB,
			cwd: arbor,
			terminalId: "catalogue-terminal",
		},
		{
			pid: 9401,
			ppid: 9400,
			label: "node",
			cpuPercent: 2.3,
			memoryBytes: 148.0 * MB,
			cwd: arbor,
			terminalId: "catalogue-terminal",
		},
	]);
}

const resourcesState = (
	id: string,
	title: string,
	then?: (context: AfterContext) => Promise<void>,
): CatalogueState => ({
	id,
	group: "App shell",
	title,
	seed: async (world): Promise<Scene> => {
		const cast = await seedCast(world);
		await setSetting(world, "sidebar_resource_usage", true);
		// Wide enough for the chip to show its memory beside the icon (260px or more).
		await setSetting(world, "left_panel_width", 320);
		plantProcesses(world, cast);
		return {
			route: chatRoute(cast.arbor, cast.chats.arbor),
			after: async (context) => {
				await refreshGit(context.app, cast.arbor);
				await composerFocused(context.document);
				await click(context.document, "button", "Resource usage:", { prefix: true });
				await then?.(context);
			},
			ready: (document) =>
				document.querySelector("[role=dialog] table") !== null && shows(document, "Resources"),
		};
	},
});

export const RESOURCE_STATES: CatalogueState[] = [
	resourcesState(
		"resources-open",
		"Resources popover: App's tree first, then each workspace, sorted by memory",
	),
	resourcesState("resources-sorted", "Resources popover sorted by CPU", ({ document }) =>
		click(document, "button", "CPU"),
	),
	resourcesState(
		"resources-show-all",
		"Resources popover grown with Show all, terminals' processes included",
		async ({ document }) => {
			await click(document, "button", "Include terminal processes");
			await click(document, "button", "Show all (", { prefix: true });
		},
	),
];
