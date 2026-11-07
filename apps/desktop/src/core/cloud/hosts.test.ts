// @vitest-environment node
/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests the cloud-folder lookup: the longest matching cloud workspace owns a path, and a path that
 * no cloud workspace owns is the Mac's.
 */
import { describe, expect, it } from "vitest";
import { type HostedFolder, hostAtPath } from "./hosts.ts";

const CLOUD_A = { kind: "cloud" as const, url: "https://a.example.dev", vmId: "oslo" };
const CLOUD_B = { kind: "cloud" as const, url: "https://b.example.dev", vmId: "bergen" };

const folders: HostedFolder[] = [
	{ path: "/workspace", host: CLOUD_A },
	{ path: "/workspace/nested", host: CLOUD_B },
	{ path: "/code/local", host: { kind: "local" } },
];

describe("CLOUD-03 the cloud-folder lookup", () => {
	it("the longest matching cloud folder wins, and an unrelated folder is null", () => {
		expect(hostAtPath(folders, "/workspace/file.txt")).toEqual(CLOUD_A);
		expect(hostAtPath(folders, "/workspace/nested/file.txt")).toEqual(CLOUD_B);
		expect(hostAtPath(folders, "/workspace/nestedness")).toEqual(CLOUD_A);
		expect(hostAtPath(folders, "/code/local/file.txt")).toBeNull();
		expect(hostAtPath(folders, "/elsewhere")).toBeNull();
	});
});
