/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests the cloud header strip over the real container: the "Conductor Cloud" badge, status, CPU,
 * memory, disk, "Low disk", agent cost and Restart, with Conductor's messages. The Worker is the
 * in-memory Platform's scripted answer, and the cost is a real stored usage event.
 * Test first: a running workspace shows its badge, status and meters, and Restart reports
 * "Restarted workspace".
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedSessionEvent,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import {
	CloudWorkspaceStatus,
	formatBytes,
	formatCores,
	formatCost,
	formatPercent,
} from "./CloudWorkspaceStatus.tsx";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

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

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const COST_EVENT: SessionEvent = {
	type: "agent",
	eventId: "cost-1" as never,
	at: 100,
	turnId: "turn-1" as never,
	message: {
		agent: "claude",
		items: [
			{
				kind: "usage",
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				costUsd: 0.75,
			},
		],
	},
};

async function renderCloud(
	availableBytes = 2 * GIB,
	restartStarted = true,
): Promise<{ test: TestContainer }> {
	const test = createTestContainer();
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		host: { kind: "cloud", url: "https://cloud.example.dev", vmId: "oslo" },
	});
	must(await test.container.services.settings.set("experimental_show_agent_cost", true));
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	await seedSessionEvent(test.container, session.id, COST_EVENT, 100);
	test.memory.controls.scriptCloud((request) => {
		if (request.path.endsWith("/state")) {
			return {
				ok: true,
				value: {
					status: 200,
					body: JSON.stringify({
						running: true,
						resources: {
							cpu: { capacityCores: 0.25, usedPercent: 40 },
							memory: { totalBytes: GIB, usedPercent: 25 },
							disk: { totalBytes: 4 * GIB, availableBytes, usedPercent: 50 },
						},
					}),
				},
			};
		}
		if (request.path.endsWith("/restart")) {
			return {
				ok: true,
				value: {
					status: 200,
					body: JSON.stringify({ started: restartStarted, readyMs: 1400, instance: "basic" }),
				},
			};
		}
		return null;
	});
	renderIn(test.container, workspace.id, <CloudWorkspaceStatus workspaceId={workspace.id} />);
	return { test };
}

function renderIn(container: Container, workspaceId: string, node: ReactNode) {
	return render(
		<ServicesProvider container={container}>
			<Toaster workspaceId={workspaceId as never} />
			{node}
		</ServicesProvider>,
	);
}

afterEach(() => {
	toast.dismiss();
	cleanup();
});

describe("CLOUD-15 formats", () => {
	it("writes bytes, cores, percents and cost as Conductor does", () => {
		expect(formatBytes(GIB)).toBe("1 GB");
		expect(formatBytes(512 * MIB)).toBe("512 MB");
		expect(formatBytes(1.5 * GIB)).toBe("1.5 GB");
		expect(formatCores(1)).toBe("1 core");
		expect(formatCores(0.25)).toBe("0.3 cores");
		expect(formatPercent(40)).toBe("40.0%");
		expect(formatCost(0.75)).toBe("$0.75");
	});
});

describe("CLOUD-15 cloud workspace header", () => {
	it("shows the badge, status, CPU, memory, disk and agent cost", async () => {
		const { test } = await renderCloud();
		try {
			expect(await screen.findByText("Conductor Cloud")).toBeTruthy();
			expect(await screen.findByText("Running")).toBeTruthy();
			expect(await screen.findByText(/CPU 40\.0%/)).toBeTruthy();
			expect(await screen.findByText(/Memory 25\.0%/)).toBeTruthy();
			expect(await screen.findByText(/Disk 50\.0%/)).toBeTruthy();
			expect(await screen.findByText("Agent cost $0.75")).toBeTruthy();
			expect(screen.getByRole("button", { name: /Restart/ })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("shows 'Low disk' and the space left when the sandbox is nearly full", async () => {
		const { test } = await renderCloud(512 * MIB);
		try {
			expect(await screen.findByText("Low disk")).toBeTruthy();
			expect(await screen.findByText(/512 MB left/)).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("restarts the workspace and says 'Restarted workspace'", async () => {
		const { test } = await renderCloud();
		try {
			expect(await screen.findByText("Running")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: /Restart/ }));
			expect(await screen.findByText("Restarted workspace")).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("shows the failure instead of claiming a restart", async () => {
		const { test } = await renderCloud(2 * GIB, false);
		try {
			expect(await screen.findByText("Running")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: /Restart/ }));
			expect(await screen.findByText("Couldn't restart the workspace")).toBeTruthy();
			expect(screen.queryByText("Restarted workspace")).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("renders nothing for a local workspace", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const view = renderIn(
				test.container,
				workspace.id,
				<CloudWorkspaceStatus workspaceId={workspace.id} />,
			);
			expect(view.container.textContent).toBe("");
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
