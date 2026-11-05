import type { SessionId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	buildDeepLink,
	dockBadgeCount,
	isSuppressed,
	notificationTitle,
	parseDeepLink,
	shouldNotifyFinished,
} from "./notifications.ts";

const quiet = {
	hasBackgroundTasks: false,
	hasError: false,
	queuedCount: 0,
	alreadyNotifiedForTurn: false,
};

describe("shouldNotifyFinished", () => {
	it("notifies for a plain finish", () => {
		expect(shouldNotifyFinished(quiet)).toBe(true);
	});
	it.each([
		["a queued follow-up", { queuedCount: 1 }],
		["background tasks", { hasBackgroundTasks: true }],
		["an error", { hasError: true }],
		["an earlier notice for the turn", { alreadyNotifiedForTurn: true }],
	])("stays quiet with %s", (_name, over) => {
		expect(shouldNotifyFinished({ ...quiet, ...over })).toBe(false);
	});
});

describe("isSuppressed", () => {
	const base = {
		kind: "finished" as const,
		sessionHidden: false,
		workspaceArchived: false,
		viewingThisChat: true,
		windowFocused: true,
	};
	it("skips what the user is already looking at", () => {
		expect(isSuppressed(base)).toBe(true);
	});
	it("still shows tool approvals for the open chat", () => {
		expect(isSuppressed({ ...base, kind: "tool_approval" })).toBe(false);
	});
	it("shows a finish when the window is not focused", () => {
		expect(isSuppressed({ ...base, windowFocused: false })).toBe(false);
	});
	it("never notifies for archived workspaces", () => {
		expect(isSuppressed({ ...base, viewingThisChat: false, workspaceArchived: true })).toBe(true);
	});
});

describe("notificationTitle", () => {
	it("cuts long titles to 50 characters", () => {
		expect(notificationTitle("a".repeat(80))).toHaveLength(50);
		expect(notificationTitle("short")).toBe("short");
	});
	it("does not split an emoji when it cuts", () => {
		const cut = notificationTitle(`${"a".repeat(48)}😀😀😀`);
		expect(Array.from(cut)).toHaveLength(50);
		expect(cut.endsWith("😀…")).toBe(true);
		expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
	});
});

describe("deep links", () => {
	it("round-trips workspace and chat", () => {
		const url = buildDeepLink("w1" as WorkspaceId, "s1" as SessionId);
		expect(url).toBe("conducted://workspace?id=w1&session=s1");
		expect(parseDeepLink(url)).toEqual({ workspaceId: "w1", sessionId: "s1" });
	});
	it("allows a link without a chat", () => {
		expect(parseDeepLink(buildDeepLink("w1" as WorkspaceId, null))).toEqual({
			workspaceId: "w1",
			sessionId: null,
		});
	});
	it("rejects other schemes, hosts and garbage", () => {
		expect(parseDeepLink("https://workspace?id=w1")).toBeNull();
		expect(parseDeepLink("conducted://settings?id=w1")).toBeNull();
		expect(parseDeepLink("conducted://workspace")).toBeNull();
		expect(parseDeepLink("not a url")).toBeNull();
	});
});

describe("dockBadgeCount", () => {
	it("counts workspaces, not chats, and skips archived workspaces and closed chats", () => {
		const workspaces = new Map<WorkspaceId, { state: "ready" | "archived" }>([
			["w1" as WorkspaceId, { state: "ready" }],
			["w2" as WorkspaceId, { state: "archived" }],
			["w3" as WorkspaceId, { state: "ready" }],
		]);
		const sessions = [
			{ workspaceId: "w1" as WorkspaceId, unreadCount: 1, closedAt: null },
			{ workspaceId: "w1" as WorkspaceId, unreadCount: 1, closedAt: null },
			{ workspaceId: "w2" as WorkspaceId, unreadCount: 1, closedAt: null },
			{ workspaceId: "w3" as WorkspaceId, unreadCount: 1, closedAt: 5 },
		];
		expect(dockBadgeCount(workspaces, sessions)).toBe(1);
	});
});
