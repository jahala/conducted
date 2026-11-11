/**
 * @feature WS-05 Archive: archive-on-merge, as the poll notices it
 * Owns: the composition root side of archive-on-merge: the stack rule, the toasts and their Open
 * PR and Unarchive actions, and the failures Conductor names.
 * Behaviour: success-side-effects.md row 7, main @733372 (the stack exception, the toasts and the
 * failure words); services-map.md 5B.1.9.
 * Test first: a merged PR whose stack still has open work keeps the workspace and says so.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createArchiveOnMerged, type UiToast } from "./container.ts";
import type { MergedPullRequest } from "./services/github.ts";

const workspaceId = "w1" as WorkspaceId;

const merged = (overrides: Partial<MergedPullRequest> = {}): MergedPullRequest => ({
	number: 7,
	url: "https://github.com/me/project/pull/7",
	stackHasOpenPrs: false,
	...overrides,
});

function ports(
	overrides: {
		archive?: (id: WorkspaceId, prNumber: number) => Promise<Result<void>>;
		archiveOnMerge?: boolean;
	} = {},
) {
	const shows: UiToast[] = [];
	const notify = vi.fn(async () => {});
	const unarchive = vi.fn();
	const openUrl = vi.fn();
	const archive = vi.fn(overrides.archive ?? (async () => ok(undefined)));
	const onMerged = createArchiveOnMerged({
		archive,
		archiveOnMerge: () => overrides.archiveOnMerge ?? true,
		unarchive,
		openUrl,
		showToast: (toast) => shows.push(toast),
		notify,
		reportError: vi.fn(),
	});
	return { onMerged, archive, shows, notify, unarchive, openUrl };
}

describe("WS-05 archive on merge", () => {
	it("keeps the workspace when its stack still has open pull requests", async () => {
		const h = ports();

		h.onMerged(workspaceId, merged({ stackHasOpenPrs: true }));

		await vi.waitFor(() => expect(h.shows).toHaveLength(1));
		expect(h.archive).not.toHaveBeenCalled();
		expect(h.shows[0]).toMatchObject({
			tone: "success",
			message: "PR #7 merged. Workspace kept for the rest of the stack.",
			action: { label: "Open PR" },
		});
		h.shows[0]?.action?.onClick();
		expect(h.openUrl).toHaveBeenCalledWith("https://github.com/me/project/pull/7");
	});

	it("archives and offers Open PR and Unarchive", async () => {
		const h = ports();

		h.onMerged(workspaceId, merged());

		await vi.waitFor(() => expect(h.shows).toHaveLength(1));
		expect(h.archive).toHaveBeenCalledWith(workspaceId, 7);
		expect(h.shows[0]).toMatchObject({
			tone: "success",
			message: "PR #7 merged and workspace archived",
			action: { label: "Open PR" },
			secondaryAction: { label: "Unarchive" },
		});
		h.shows[0]?.secondaryAction?.onClick();
		expect(h.unarchive).toHaveBeenCalledWith(workspaceId);
	});

	it("says nothing when archive on merge is off", async () => {
		const h = ports({ archiveOnMerge: false });

		h.onMerged(workspaceId, merged());

		await Promise.resolve();
		expect(h.archive).not.toHaveBeenCalled();
		expect(h.shows).toEqual([]);
	});

	it("names running agents instead of archiving", async () => {
		const h = ports({
			archive: async () =>
				err(appError("workspace_has_running_sessions", "Stop the running chats first.")),
		});

		h.onMerged(workspaceId, merged());

		await vi.waitFor(() => expect(h.shows).toHaveLength(1));
		expect(h.shows[0]).toMatchObject({
			tone: "error",
			message: "Merged PR, but workspace was not archived because agents are still running",
		});
	});

	it("points a corrupt workspace at the workspace list", async () => {
		const h = ports({
			archive: async () => err(appError("workspace_corrupted", "The folder is missing.")),
		});

		h.onMerged(workspaceId, merged());

		await vi.waitFor(() => expect(h.notify).toHaveBeenCalledTimes(1));
		expect(h.notify).toHaveBeenCalledWith({
			title: "Couldn't archive the workspace",
			body: "Archiving failed. This workspace might be corrupted. Delete it manually from the workspace list.",
			deepLink: "conducted://workspace?id=w1",
		});
		expect(h.shows).toEqual([]);
	});

	it("reports any other archive failure with its message", async () => {
		const h = ports({
			archive: async () => err(appError("archive_snapshot_failed", "The disk is full.")),
		});

		h.onMerged(workspaceId, merged());

		await vi.waitFor(() => expect(h.shows).toHaveLength(1));
		expect(h.shows[0]).toMatchObject({
			tone: "error",
			message: "Merged PR, but failed to archive workspace: The disk is full.",
		});
	});
});
