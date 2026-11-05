/**
 * @feature WS-05 Archive: report a failed archive-on-merge
 * Owns: the composition root side of archive-on-merge: handing the archive's failure to the user
 * instead of dropping the Result.
 * Behaviour: services-map.md 5B.1.9 (archive_on_merge errors for running agents or a corrupted workspace).
 * Test first: a failed archive-on-merge shows a notification with the failure's message.
 */
import { appError, err, ok, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createArchiveOnMerged } from "./container.ts";

describe("WS-05 archive on merge reporting", () => {
	it("tells the user when the archive fails", async () => {
		const notify = vi.fn(async () => {});
		const reportError = vi.fn();
		const onMerged = createArchiveOnMerged({
			archive: async () =>
				err(appError("workspace_has_running_sessions", "Stop the running chats first.")),
			notify,
			reportError,
		});

		onMerged("w1" as WorkspaceId, 7);

		await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
		expect(notify).toHaveBeenCalledWith({
			title: "Couldn't archive the workspace",
			body: "Stop the running chats first.",
			deepLink: "conducted://workspace?id=w1",
		});
		expect(reportError).not.toHaveBeenCalled();
	});

	it("says nothing when the archive succeeds", async () => {
		const archive = vi.fn(async () => ok(undefined));
		const notify = vi.fn(async () => {});
		const onMerged = createArchiveOnMerged({ archive, notify, reportError: vi.fn() });

		onMerged("w1" as WorkspaceId, 7);

		await vi.waitFor(() => expect(archive).toHaveBeenCalledWith("w1", 7));
		expect(notify).not.toHaveBeenCalled();
	});
});
