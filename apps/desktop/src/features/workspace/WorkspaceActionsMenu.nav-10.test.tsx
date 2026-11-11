/**
 * @feature NAV-10 Workspace actions menu
 * Owns: tests for the one workspace actions list, the sidebar row's right-click menu.
 * Test first: Choosing Pin calls workspaces.setPinned(id, true); for a pinned workspace the item
 * reads Unpin.
 */
import { appError, err, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Session, Workspace } from "../../core/model.ts";
import { toast } from "../../ui/Toast.tsx";

const state = vi.hoisted(() => {
	const snapshot = { sections: [] as { id: string; name: string }[] };
	const sectionsStore = {
		getState: () => snapshot,
		getInitialState: () => snapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	return {
		workspace: {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			},
		} as Loadable<Workspace>,
		sessions: { state: "ready", data: [] } as Loadable<Session[]>,
		sectionsStore,
		snapshot,
		setPinned: vi.fn(),
		markRead: vi.fn(),
		markUnread: vi.fn(),
		setKanbanStatus: vi.fn(),
		rename: vi.fn(),
		archive: vi.fn(),
		unarchive: vi.fn(),
		remove: vi.fn(),
		place: vi.fn(),
		createSection: vi.fn(),
		copyText: vi.fn(),
		pauseWorkspace: vi.fn(),
	};
});

vi.mock("../../core/hooks.ts", () => ({
	useSetting: () => "",
	useGitHubAccess: () => ({ state: "loading" }),
	useLiveShortcut: () => null,
	useWorkspace: () => state.workspace,
	useSessions: () => state.sessions,
	usePortForwards: () => ({
		forwardingEnabled: false,
		autoForwardEnabled: false,
		waiting: false,
		forwards: [],
		detectedPorts: [],
		error: null,
	}),
	useActions: () => ({
		workspaces: {
			setPinned: state.setPinned,
			markRead: state.markRead,
			markUnread: state.markUnread,
			setKanbanStatus: state.setKanbanStatus,
			rename: state.rename,
			archive: state.archive,
			unarchive: state.unarchive,
			remove: state.remove,
		},
		sections: { place: state.place, create: state.createSection },
		portForwards: { pauseWorkspace: state.pauseWorkspace },
		app: { copyText: state.copyText },
	}),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sections: { store: state.sectionsStore } } }),
}));

const { WorkspaceActionsMenu } = await import("./WorkspaceActionsMenu.tsx");

const workspaceId = "w1" as WorkspaceId;

const openMenu = async () => {
	render(
		<WorkspaceActionsMenu workspaceId={workspaceId}>
			<button type="button">Actions</button>
		</WorkspaceActionsMenu>,
	);
	// The menu is the sidebar row's right-click menu, as in Conductor (D098).
	fireEvent.contextMenu(screen.getByRole("button", { name: "Actions" }));
	return screen.findByRole("menu");
};

beforeEach(() => {
	for (const fn of [
		state.setPinned,
		state.markRead,
		state.markUnread,
		state.setKanbanStatus,
		state.rename,
		state.archive,
		state.unarchive,
		state.remove,
		state.place,
		state.createSection,
		state.copyText,
		state.pauseWorkspace,
	]) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: undefined });
	}
	state.snapshot.sections = [];
	state.sessions = { state: "ready", data: [] };
	state.workspace = {
		state: "ready",
		data: {
			pinnedAt: null,
			directoryName: "quiet-meadow",
			state: "ready",
			host: { kind: "local" },
		} as Workspace,
	};
});

afterEach(cleanup);

describe("NAV-10 WorkspaceActionsMenu", () => {
	it("pins an unpinned workspace", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Pin/ }));
		await waitFor(() => expect(state.setPinned).toHaveBeenCalledWith(workspaceId, true));
	});

	it("reads Unpin for a pinned workspace", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: 10,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		expect(await screen.findByRole("menuitem", { name: /^Unpin/ })).toBeTruthy();
	});

	it("offers Unarchive instead of Rename for an archived workspace", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "archived",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		expect(await screen.findByRole("menuitem", { name: "Unarchive" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
	});

	it("marks the workspace as read when it is unread", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		state.sessions = {
			state: "ready",
			data: [{ id: "s1", unreadCount: 2 } as Session],
		};
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Mark as read/ }));
		await waitFor(() => expect(state.markRead).toHaveBeenCalledWith(workspaceId));
	});

	it("marks the workspace as unread when all chats are read", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		state.sessions = {
			state: "ready",
			data: [{ id: "s1", unreadCount: 0 } as Session],
		};
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Mark as unread/ }));
		await waitFor(() => expect(state.markUnread).toHaveBeenCalledWith(workspaceId));
	});

	it("sets the status from the submenu", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		const trigger = await screen.findByRole("menuitem", { name: "Set status" });
		fireEvent.keyDown(trigger, { key: "ArrowRight" });
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "In progress" }));
		await waitFor(() =>
			expect(state.setKanbanStatus).toHaveBeenCalledWith(workspaceId, "in_progress"),
		);
	});

	it("moves the workspace to a section", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		state.snapshot.sections = [{ id: "sec1", name: "Today" }];
		await openMenu();
		const trigger = await screen.findByRole("menuitem", { name: "Move to section" });
		fireEvent.keyDown(trigger, { key: "ArrowRight" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Today" }));
		await waitFor(() => expect(state.place).toHaveBeenCalledWith(workspaceId, "sec1", 0));
	});

	it("renames the workspace from the shared dialog", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
				displayName: "Old",
			} as Workspace,
		};
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
		const field = await screen.findByRole("textbox", { name: "Name" });
		fireEvent.change(field, { target: { value: "New name" } });
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() => expect(state.rename).toHaveBeenCalledWith(workspaceId, "New name"));
	});

	it("creates a new section", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		const trigger = await screen.findByRole("menuitem", { name: "Move to section" });
		fireEvent.keyDown(trigger, { key: "ArrowRight" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "New section..." }));
		const field = await screen.findByRole("textbox", { name: "Name" });
		fireEvent.change(field, { target: { value: "Later" } });
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(state.createSection).toHaveBeenCalledWith("Later", null));
	});

	it("copies a deep link", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Copy link/ }));
		await waitFor(() => expect(state.copyText).toHaveBeenCalledWith("conducted://workspace?id=w1"));
	});

	it("archives a workspace", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Archive/ }));
		await waitFor(() =>
			expect(state.archive).toHaveBeenCalledWith(workspaceId, { deleteBranch: false }),
		);
	});

	it("asks before archiving a workspace whose agents are running", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "ready",
				host: { kind: "local" },
			} as Workspace,
		};
		state.archive
			.mockResolvedValueOnce(
				err(appError("workspace_has_running_sessions", "Stop the running chats first.")),
			)
			.mockResolvedValueOnce({ ok: true, value: undefined });
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Archive/ }));

		expect(await screen.findByRole("alertdialog")).toBeTruthy();
		expect(screen.getByText("Archive workspace?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Stop agents and archive" }));

		await waitFor(() =>
			expect(state.archive).toHaveBeenLastCalledWith(workspaceId, {
				deleteBranch: false,
				stopRunningAgents: true,
			}),
		);
	});

	it("offers Delete permanently when the archive finds a corrupt workspace", async () => {
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		try {
			state.workspace = {
				state: "ready",
				data: {
					pinnedAt: null,
					directoryName: "quiet-meadow",
					state: "ready",
					host: { kind: "local" },
				} as Workspace,
			};
			state.archive.mockResolvedValue(
				err(appError("workspace_corrupted", "The folder is missing.")),
			);
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /^Archive/ }));

			await waitFor(() =>
				expect(toasted).toHaveBeenCalledWith(
					"Archiving failed. This workspace might be corrupted. Delete permanently?",
					expect.objectContaining({
						action: expect.objectContaining({ label: "Delete permanently" }),
					}),
				),
			);
			const options = toasted.mock.calls.at(-1)?.[1] as {
				action?: { onClick: () => void };
			};
			options.action?.onClick();
			await waitFor(() => expect(state.remove).toHaveBeenCalledWith(workspaceId));
		} finally {
			toasted.mockRestore();
		}
	});

	it("warns about a Git operation and archives on request", async () => {
		const warned = vi.spyOn(toast, "warning").mockReturnValue("t");
		try {
			state.workspace = {
				state: "ready",
				data: {
					pinnedAt: null,
					directoryName: "quiet-meadow",
					state: "ready",
					host: { kind: "local" },
				} as Workspace,
			};
			state.archive
				.mockResolvedValueOnce(err(appError("archive_git_busy", "Git has an unfinished merge.")))
				.mockResolvedValueOnce({ ok: true, value: undefined });
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /^Archive/ }));

			await waitFor(() =>
				expect(warned).toHaveBeenCalledWith(
					"Because a Git operation (merge, rebase, cherry-pick, or revert) is in progress, archiving may lose some of your work.",
					expect.objectContaining({
						action: expect.objectContaining({ label: "Archive" }),
					}),
				),
			);
			const options = warned.mock.calls.at(-1)?.[1] as {
				action?: { onClick: () => void };
			};
			options.action?.onClick();
			await waitFor(() =>
				expect(state.archive).toHaveBeenLastCalledWith(workspaceId, {
					deleteBranch: false,
					discardGitOperationState: true,
				}),
			);
		} finally {
			warned.mockRestore();
		}
	});

	it("offers Delete anyway for any other archive failure, and reports a failed delete", async () => {
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		try {
			state.workspace = {
				state: "ready",
				data: {
					pinnedAt: null,
					directoryName: "quiet-meadow",
					state: "ready",
					host: { kind: "local" },
				} as Workspace,
			};
			state.archive.mockResolvedValue(err(appError("db", "The disk is full.")));
			state.remove.mockResolvedValue(err(appError("db", "The disk is still full.")));
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /^Archive/ }));

			await waitFor(() =>
				expect(toasted).toHaveBeenCalledWith(
					"The disk is full.",
					expect.objectContaining({
						action: expect.objectContaining({ label: "Delete anyway" }),
					}),
				),
			);
			const options = toasted.mock.calls.at(-1)?.[1] as {
				action?: { onClick: () => void };
			};
			options.action?.onClick();
			await waitFor(() =>
				expect(toasted).toHaveBeenCalledWith(
					"Failed to delete workspace: The disk is still full.",
					expect.objectContaining({ duration: Number.POSITIVE_INFINITY }),
				),
			);
		} finally {
			toasted.mockRestore();
		}
	});

	it("unarchives an archived workspace", async () => {
		state.workspace = {
			state: "ready",
			data: {
				pinnedAt: null,
				directoryName: "quiet-meadow",
				state: "archived",
				host: { kind: "local" },
			} as Workspace,
		};
		state.unarchive.mockResolvedValue({
			ok: true,
			value: { needsBranchName: false, uncommittedChangesLost: false },
		});
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Unarchive" }));
		await waitFor(() =>
			expect(state.unarchive).toHaveBeenCalledWith(workspaceId, {
				branchName: null,
				clearChats: false,
			}),
		);
	});

	it("warns when unarchive could not recover the uncommitted changes", async () => {
		const warned = vi.spyOn(toast, "warning").mockReturnValue("t");
		try {
			state.workspace = {
				state: "ready",
				data: {
					pinnedAt: null,
					directoryName: "quiet-meadow",
					state: "archived",
					host: { kind: "local" },
				} as Workspace,
			};
			state.unarchive.mockResolvedValue({
				ok: true,
				value: { needsBranchName: false, uncommittedChangesLost: true },
			});
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: "Unarchive" }));
			await waitFor(() =>
				expect(warned).toHaveBeenCalledWith("Uncommitted changes couldn't be recovered."),
			);
		} finally {
			warned.mockRestore();
		}
	});

	it("lists the statuses in board order", async () => {
		await openMenu();
		fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Set status" }), {
			key: "ArrowRight",
		});
		await screen.findByRole("menuitemradio", { name: "Backlog" });
		expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
			"Backlog",
			"In progress",
			"In review",
			"Done",
			"Canceled",
		]);
	});

	it("shows the failure's message when an action returns a failed Result", async () => {
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		try {
			state.setPinned.mockResolvedValue({
				ok: false,
				error: { code: "db", message: "The database is locked." },
			});
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /^Pin/ }));
			await waitFor(() =>
				expect(toasted).toHaveBeenCalledWith("Couldn't pin the workspace", {
					description: "The database is locked.",
				}),
			);
		} finally {
			toasted.mockRestore();
		}
	});

	it("shows a toast when an action is not built yet and throws", async () => {
		const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
		try {
			state.markUnread.mockImplementation(() => {
				throw new Error("Not built yet: NAV-11");
			});
			state.sessions = { state: "ready", data: [{ id: "s1", unreadCount: 0 } as Session] };
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: /^Mark as unread/ }));
			await waitFor(() =>
				expect(toasted).toHaveBeenCalledWith("Couldn't mark the workspace as unread", {
					description: "Not built yet: NAV-11",
				}),
			);
		} finally {
			toasted.mockRestore();
		}
	});
});
