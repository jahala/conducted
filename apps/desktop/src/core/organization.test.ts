/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Tests the switcher's entries, the active entry, which workspaces an entry lists, the projects a
 * cloud workspace can be made from, and the page's launch state and Conductor's words for it.
 */
import type { RepoId } from "@conducted/shared";
import { appError } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Repo } from "./model.ts";
import {
	activeOrganization,
	type CloudReadiness,
	cloudLaunchDisabledReason,
	cloudLaunchState,
	cloudLaunchStatusLine,
	cloudRepositories,
	organizationsFor,
	workspaceInOrganization,
} from "./organization.ts";

const URL = "https://conducted-cloud.sam.workers.dev";
const READY: CloudReadiness = {
	github: true,
	agents: { anthropic: true, openai: false, cursor: false },
};

const repo = (id: string, remoteUrl: string | null): Repo => ({
	id: id as RepoId,
	name: id,
	rootPath: `/code/${id}`,
	remoteUrl,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 0,
	updatedAt: 0,
});

describe("CLOUD-19 the organisation switcher's rules", () => {
	it("a paired Mac lists this Mac and its Worker, and a stored cloud choice on an unpaired Mac is this Mac", () => {
		const paired = organizationsFor({ paired: true, url: URL });
		expect(paired).toEqual([
			{ id: "local", label: "My Mac", isCloud: false, url: null },
			{ id: "cloud", label: "conducted-cloud.sam.workers.dev", isCloud: true, url: URL },
		]);
		expect(activeOrganization("cloud", paired).id).toBe("cloud");
		expect(activeOrganization("local", paired).id).toBe("local");

		const unpaired = organizationsFor({ paired: false, url: null });
		expect(unpaired.map((organization) => organization.id)).toEqual(["local"]);
		expect(activeOrganization("cloud", unpaired).id).toBe("local");
		expect(activeOrganization("", unpaired).id).toBe("local");
	});

	it("this Mac lists local workspaces and the Worker lists only its own cloud workspaces", () => {
		const [local, cloud] = organizationsFor({ paired: true, url: URL });
		if (local === undefined || cloud === undefined) throw new Error("two entries expected");
		const onMac = { host: { kind: "local" } as const };
		const onWorker = { host: { kind: "cloud", url: URL, vmId: "ws-1" } as const };
		const onOtherWorker = {
			host: { kind: "cloud", url: "https://other.example.dev", vmId: "ws-2" } as const,
		};
		expect([onMac, onWorker, onOtherWorker].map((w) => workspaceInOrganization(w, local))).toEqual([
			true,
			false,
			false,
		]);
		expect([onMac, onWorker, onOtherWorker].map((w) => workspaceInOrganization(w, cloud))).toEqual([
			false,
			true,
			false,
		]);
	});

	it("offers GitHub projects only, labelled by name, with the owner when two share a name", () => {
		const listed = cloudRepositories([
			repo("api", "git@github.com:acme/api.git"),
			repo("api-fork", "https://github.com/sam/api"),
			repo("site", "https://github.com/acme/site.git"),
			repo("scratch", null),
			repo("gitlab", "git@gitlab.com:acme/tools.git"),
		]);
		expect(listed.map((entry) => [entry.repo.id, entry.label, entry.cloneUrl])).toEqual([
			["api", "acme/api", "https://github.com/acme/api.git"],
			["api-fork", "sam/api", "https://github.com/sam/api.git"],
			["site", "site", "https://github.com/acme/site.git"],
		]);
	});
});

describe("CLOUD-19 the new-workspace page's cloud launch state", () => {
	const state = (readiness: Parameters<typeof cloudLaunchState>[0]["readiness"], count = 1) =>
		cloudLaunchState({ url: URL, readiness, repositoryCount: count });

	it("maps each Worker answer to Conductor's reason, in Conductor's order", () => {
		const cases = [
			state({ state: "loading" }),
			state({ state: "error", error: appError("cloud_request_failed", "down") }),
			state({ state: "ready", data: { ...READY, github: false } }),
			state({
				state: "ready",
				data: { github: true, agents: { anthropic: false, openai: false, cursor: false } },
			}),
			state({ state: "ready", data: READY }, 0),
			state({ state: "ready", data: READY }),
		];
		expect(cases.map((launch) => launch.kind)).toEqual([
			"loading",
			"machine-not-ready",
			"github-access-required",
			"agent-credentials-required",
			"no-repos",
			"ready",
		]);
		expect(cases.map(cloudLaunchDisabledReason)).toEqual([
			"Checking machine availability...",
			"Computer isn't ready yet.",
			"Connect GitHub to create a cloud workspace.",
			"Set up an agent to create a cloud workspace.",
			"Add a repo to the computer to create a workspace.",
			undefined,
		]);
		expect(cases.map(cloudLaunchStatusLine)).toEqual([
			undefined,
			"Computer isn't ready yet.",
			"GitHub isn't connected.",
			"No agent set up yet.",
			"No repositories yet.",
			"Cloud unavailable with enterprise data privacy.",
		]);
	});

	it("counts any one model key as an agent", () => {
		const codexOnly = state({
			state: "ready",
			data: { github: true, agents: { anthropic: false, openai: true, cursor: false } },
		});
		expect(codexOnly).toEqual({ kind: "ready", url: URL });
	});
});
