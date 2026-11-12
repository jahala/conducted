/**
 * @feature APP-05 Toast
 * Owns: the one toast host, built on sonner, themed with our tokens. Screens and services call `toast` for
 * short feedback; `workspaceToast` is the variant that shows only while its workspace is open.
 * Behaviour: ui-map.md 7.4 (toasts such as "Failed to create workspace"; success, error and warning kinds; a
 * workspace-scoped variant), 1.1 (one toast area at the root); ui-dimensions.md 4 (356px wide, 16px padding,
 * 8px gap, 8px radius, 1px border, 13px text, title weight 500).
 * Our design choice: toasts report an outcome. Anything the user must act on gets a designed state or a card.
 * The workspace-scoped toast keeps its workspace id beside the toast, so switching workspace dismisses it.
 * Must handle: the host sits at the bottom right and a toast closes after 5 seconds unless it sets
 * its own time, as Conductor's toaster does; `role="status"` for screen readers (sonner); a
 * workspace-scoped toast is hidden while another workspace is open and removed when the user leaves or the
 * toast closes on its own.
 * Test first: toast.error("x") shows "x" in the host; a workspace-scoped toast for a closed workspace does not.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useEffect } from "react";
import { type ExternalToast, Toaster as Sonner, toast } from "sonner";
import { create } from "zustand";

export { toast };

/** How long a toast shows when it does not set its own time, as in Conductor. */
export const TOAST_DURATION_MS = 5_000;

interface WorkspaceToastState {
	open: WorkspaceId | null;
	owned: Record<string, WorkspaceId>;
	next: number;
	setOpen: (workspaceId: WorkspaceId | null) => void;
	claim: (workspaceId: WorkspaceId) => string;
	release: (id: string) => void;
}

const useWorkspaceToastStore = create<WorkspaceToastState>()((set, get) => ({
	open: null,
	owned: {},
	next: 1,
	setOpen: (workspaceId) => set({ open: workspaceId }),
	claim: (workspaceId) => {
		const id = `workspace-toast-${get().next}`;
		set((state) => ({
			next: state.next + 1,
			owned: { ...state.owned, [id]: workspaceId },
		}));
		return id;
	},
	release: (id) =>
		set((state) => {
			const owned = { ...state.owned };
			delete owned[id];
			return { owned };
		}),
}));

/**
 * Tell the toast host which workspace is open, and dismiss the workspace toasts that belong to any other one.
 * `Toaster` does this when it receives `workspaceId`; the app shell does it on every route change.
 */
export function setCurrentWorkspace(workspaceId: WorkspaceId | null): void {
	const { setOpen, owned, release } = useWorkspaceToastStore.getState();
	setOpen(workspaceId);
	for (const [id, owner] of Object.entries(owned)) {
		if (owner === workspaceId) continue;
		toast.dismiss(id);
		release(id);
	}
}

/** Ids of the workspace toasts that have not closed yet. */
export function workspaceToastIds(): string[] {
	return Object.keys(useWorkspaceToastStore.getState().owned);
}

/**
 * Show an error toast with a failure's plain-language message as its description. Screens call this with the
 * `Result` error, so the `Result` to toast path lives in one place.
 */
export function toastError(
	title: string,
	error: { message: string },
	options?: ExternalToast,
): string | number {
	return toast.error(title, { ...options, description: error.message });
}

/**
 * Show a toast only while `workspaceId` is the open workspace. Before a workspace is set the toast is shown,
 * so an unwired host behaves like a plain toast rather than hiding the message.
 */
export function workspaceToast(
	workspaceId: WorkspaceId,
	message: string,
	options?: ExternalToast,
): string | null {
	const { open, claim, release } = useWorkspaceToastStore.getState();
	if (open !== null && open !== workspaceId) return null;
	const id = claim(workspaceId);
	const onDismiss = options?.onDismiss;
	const onAutoClose = options?.onAutoClose;
	toast(message, {
		...options,
		id,
		onAutoClose: (closed) => {
			release(String(closed.id));
			onAutoClose?.(closed);
		},
		onDismiss: (dismissed) => {
			release(String(dismissed.id));
			onDismiss?.(dismissed);
		},
	});
	return id;
}

export interface ToasterProps {
	/** The workspace in the current route. Passing it dismisses toasts owned by other workspaces. */
	workspaceId?: WorkspaceId | null;
}

export function Toaster({ workspaceId }: ToasterProps = {}) {
	useEffect(() => {
		if (workspaceId === undefined) return;
		setCurrentWorkspace(workspaceId);
	}, [workspaceId]);

	return (
		<Sonner
			position="bottom-right"
			// Conductor's toaster closes a toast after 5 seconds unless it sets its own time (renderApp
			// @614297); sonner's own default is 4.
			duration={TOAST_DURATION_MS}
			toastOptions={{
				unstyled: true,
				classNames: {
					toast:
						"flex w-(--toast-width) items-start gap-2 rounded-lg border border-border bg-raised p-4 text-code text-fg shadow-toast",
					title: "font-medium",
					// Conductor keeps a description's line breaks (renderApp CSS @10462, `[data-description]`
					// white-space: pre-line), so a quoted parse error reads line by line.
					description: "whitespace-pre-line text-fg-muted",
					error: "text-danger",
					warning: "text-warning",
					success: "text-success",
					actionButton:
						"ml-auto shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-fg hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
					cancelButton:
						"ml-2 shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-fg-muted hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
				},
			}}
		/>
	);
}
