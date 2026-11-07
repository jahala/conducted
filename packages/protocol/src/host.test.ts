/**
 * @feature CLOUD-01 Host interface: each workspace reaches git, shell, files, terminals and its sidecar through a local or cloud host
 * Tests the host value: local, or cloud with a Worker URL and a sandbox id (services-map 1.2).
 */
import { expect, test } from "bun:test";
import { LOCAL_HOST, zHost } from "./host.ts";
import { zWorkspaceContext } from "./session-config.ts";

test("a cloud host without a URL or a VM id is refused", () => {
	expect(zHost.safeParse({ kind: "cloud", url: "", vmId: "sandbox-1" }).success).toBe(false);
	expect(zHost.safeParse({ kind: "cloud", url: "https://w.example.dev" }).success).toBe(false);
	expect(zHost.safeParse({ kind: "local", url: "https://w.example.dev" }).success).toBe(false);
	expect(zHost.parse({ kind: "cloud", url: "https://w.example.dev", vmId: "sandbox-1" })).toEqual({
		kind: "cloud",
		url: "https://w.example.dev",
		vmId: "sandbox-1",
	});
	expect(zHost.parse(LOCAL_HOST)).toEqual({ kind: "local" });
});

test("the workspace context a chat is sent with carries its host", () => {
	const context = {
		workspaceId: "ws-1",
		workspaceName: "oslo",
		workspacePath: "/code/oslo",
		repoRootPath: "/code/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 55_000,
	};
	expect(zWorkspaceContext.safeParse(context).success).toBe(false);
	expect(zWorkspaceContext.parse({ ...context, host: LOCAL_HOST }).host).toEqual({ kind: "local" });
});
