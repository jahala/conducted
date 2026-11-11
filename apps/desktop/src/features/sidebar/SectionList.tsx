/**
 * @feature NAV-04 Sidebar sections
 * Owns: The user's named sections: header with name, emoji, count and actions, and the workspaces
 * inside.
 * Behaviour: ui-map.md 4 item 5 (sections from navigation_sections: name, optional emoji, collapse,
 * count, 'Create in section', 'New section...', rename, delete; errors 'Couldn't move workspace',
 * 'Couldn't reorder section', 'Couldn't delete section'), 5.3 (sidebar background menu: 'New
 * section...').
 * Must handle: Deleting a section moves its workspaces back to the main list; a failed move or
 * reorder shows a toast and the list keeps the saved order; a collapsed section is saved;
 * renaming to an empty name is refused; dragging a section header reorders sections (dropping on
 * the upper half of a header puts it before that section); row drags reorder only when 'Arrange
 * workspaces manually' is on, and a row dragged from another list joins this section there.
 * Our design choice: A drop writes through the sections service and the service store is the
 * only order the list shows, so a failed write leaves the previous order in place.
 * Test first: Placing a workspace into a section calls sections.place with the section id and the
 * drop position; a failed call restores the previous order.
 */
import type { SectionId, WorkspaceId } from "@conducted/shared";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useActions, useRepos, useSetting } from "../../core/hooks.ts";
import type { Repo, Section, Workspace } from "../../core/model.ts";
import { AlertDialog, AlertDialogContent } from "../../ui/AlertDialog.tsx";
import { Button } from "../../ui/Button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { cn } from "../../ui/cn.ts";
import { PencilIcon, PlusIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { SectionDialog } from "./SectionDialog.tsx";
import { HeaderChevron, HeaderCount } from "./section-header.tsx";
import { useWorkspaceDrag } from "./use-workspace-drag.ts";
import { WorkspaceRow } from "./WorkspaceRow.tsx";
import { useWorkspaceDragController, useWorkspaceHitTest } from "./workspace-drag-context.tsx";

export interface SectionListProps {
	sections: readonly Section[];
	workspaces: readonly Workspace[];
	/** Opens the one New section dialog, so the sidebar background menu and the row share it. */
	onNewSection?: () => void;
	/** Pinned workspaces: they show in Pinned only, so a section leaves them out. */
	excludedIds?: ReadonlySet<WorkspaceId>;
}

const REORDER_TITLE = "Couldn't reorder section";
const DELETE_TITLE = "Couldn't delete section";

function orderedSections(sections: readonly Section[]): Section[] {
	return [...sections].sort(
		(left, right) => left.position - right.position || left.id.localeCompare(right.id),
	);
}

/** True when a point lies inside a rectangle. jsdom gives every element a zero rectangle. */
function containsPoint(rect: DOMRect, point: { x: number; y: number }): boolean {
	return (
		point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
	);
}

export function SectionList({
	sections,
	workspaces,
	onNewSection,
	excludedIds = new Set(),
}: SectionListProps) {
	const actions = useActions();
	const repos = useRepos();
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;
	const manualOrder = useSetting<boolean>("manual_workspace_order");
	const [editing, setEditing] = useState<Section | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [deleting, setDeleting] = useState<Section | null>(null);

	const repoById = useMemo(
		() =>
			new Map<Repo["id"], Repo>(
				repos.state === "ready" ? repos.data.map((repo) => [repo.id, repo]) : [],
			),
		[repos],
	);
	const byId = useMemo(
		() => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
		[workspaces],
	);

	const openCreate =
		onNewSection ??
		(() => {
			setEditing(null);
			setDialogOpen(true);
		});

	const openRename = (section: Section) => {
		setEditing(section);
		setDialogOpen(true);
	};

	const remove = (section: Section) => {
		void actions.sections.remove(section.id).then((result) => {
			if (!result.ok) toastError(DELETE_TITLE, result.error);
			else setDeleting(null);
		});
	};

	const reorderSection = (dragged: SectionId, target: Section, after: boolean) => {
		if (dragged === target.id) return;
		const current = orderedSections(sections).map((section) => section.id);
		const without = current.filter((id) => id !== dragged);
		const targetIndex = without.indexOf(target.id);
		if (targetIndex === -1) return;
		const index = Math.max(0, after ? targetIndex + 1 : targetIndex);
		const next = [...without.slice(0, index), dragged, ...without.slice(index)];
		void actions.sections.reorder(next).then((result) => {
			if (!result.ok) toastError(REORDER_TITLE, result.error);
		});
	};

	const ordered = orderedSections(sections);

	return (
		<div className={cn("flex flex-col gap-1", ordered.length > 0 && "py-1")}>
			{ordered.map((section) => {
				const members = section.workspaceIds
					.filter((id) => !excludedIds.has(id))
					.map((id) => byId.get(id))
					.filter((workspace): workspace is Workspace => workspace !== undefined);
				return (
					<SectionGroup
						key={section.id}
						section={section}
						members={members}
						repoById={repoById}
						selectedId={selectedId}
						manualOrder={manualOrder}
						onReorderSection={reorderSection}
						onRename={() => openRename(section)}
						onDelete={() => setDeleting(section)}
						onNewSection={openCreate}
					/>
				);
			})}
			<SectionDialog open={dialogOpen} onOpenChange={setDialogOpen} section={editing} />

			<AlertDialog
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				{deleting === null ? null : (
					<AlertDialogContent
						title={`Delete section "${deleting.name}"?`}
						description="Its workspaces go back to the main list. No workspace is deleted."
						tone="destructive"
						confirmLabel="Delete section"
						onConfirm={() => remove(deleting)}
					/>
				)}
			</AlertDialog>
		</div>
	);
}

interface SectionGroupProps {
	section: Section;
	members: readonly Workspace[];
	repoById: ReadonlyMap<Repo["id"], Repo>;
	selectedId: WorkspaceId | null;
	manualOrder: boolean;
	onReorderSection: (dragged: SectionId, target: Section, after: boolean) => void;
	onRename: () => void;
	onDelete: () => void;
	onNewSection: () => void;
}

function SectionGroup({
	section,
	members,
	repoById,
	selectedId,
	manualOrder,
	onReorderSection,
	onRename,
	onDelete,
	onNewSection,
}: SectionGroupProps) {
	const pointer = useWorkspaceDragController();
	const sectionRef = useRef<HTMLElement | null>(null);
	const actions = useActions();
	// The saved collapse state is the source, so a failed write leaves the list where it was.
	const open = !section.collapsed;
	const drag = useWorkspaceDrag({
		order: members.map((workspace) => workspace.id),
		sectionId: section.id,
		manualOrder,
		place: (workspaceId, sectionId, position) =>
			actions.sections.place(workspaceId, sectionId, position),
		onError: toastError,
	});

	const changeOpen = (next: boolean) => {
		void actions.sections.setCollapsed(section.id, !next).then((result) => {
			if (!result.ok) toastError("Couldn't save the section", result.error);
		});
	};

	useWorkspaceHitTest((point) => {
		const root = sectionRef.current;
		if (root === null) return undefined;
		for (const row of root.querySelectorAll<HTMLElement>("[data-workspace-id]")) {
			const rect = row.getBoundingClientRect();
			if (!containsPoint(rect, point)) continue;
			const workspaceId = row.dataset.workspaceId as WorkspaceId | undefined;
			if (workspaceId === undefined) continue;
			return {
				key: `row:${workspaceId}`,
				element: row,
				drop: (payload, at) => {
					if (payload.kind !== "workspace") return;
					const after = rect.height > 0 && at.y > rect.top + rect.height / 2;
					drag.dropOn(`row:${workspaceId}`, after ? 1 : 0, payload.id);
				},
			};
		}
		const header = root.querySelector<HTMLElement>("[data-section-header]");
		if (header !== null) {
			const rect = header.getBoundingClientRect();
			if (containsPoint(rect, point)) {
				return {
					key: `section-header:${section.id}`,
					element: header,
					drop: (payload, at) => {
						if (payload.kind === "workspace") {
							drag.dropOn(`section:${section.id}`, members.length, payload.id);
							return;
						}
						if (payload.kind !== "section") return;
						const after = rect.height === 0 || at.y >= rect.top + rect.height / 2;
						onReorderSection(payload.id, section, after);
					},
				};
			}
		}
		const rect = root.getBoundingClientRect();
		if (!containsPoint(rect, point)) return undefined;
		return {
			key: `section:${section.id}`,
			element: root,
			drop: (payload) => {
				if (payload.kind !== "workspace") return;
				drag.dropOn(`section:${section.id}`, members.length, payload.id);
			},
		};
	});

	return (
		<section
			ref={sectionRef}
			aria-label={section.name}
			className={cn(
				"rounded-md px-1.5 pt-1.5 pb-3",
				pointer.drag?.target?.key === `section:${section.id}` && "bg-hover",
			)}
		>
			<Collapsible open={open} onOpenChange={changeOpen}>
				<div
					data-section-header={section.id}
					className="group/header mt-0.5 mb-1 flex touch-none items-center gap-0.5"
					onClickCapture={pointer.consumeClick}
					onPointerDown={(event) => pointer.start(event, { kind: "section", id: section.id })}
				>
					<CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-left text-xs font-medium text-sidebar-fg-muted hover:bg-hover">
						{section.emoji === null ? null : (
							<span
								aria-hidden="true"
								className="flex size-4 shrink-0 items-center justify-center text-xs leading-none"
							>
								{section.emoji}
							</span>
						)}
						<span className="min-w-0 truncate">{section.name}</span>
						<HeaderCount open={open} count={members.length} />
						<HeaderChevron open={open} />
					</CollapsibleTrigger>
					<Link
						to="/create"
						search={{ section: section.id }}
						aria-label={`Create workspace in ${section.name}`}
						title={`Create workspace in ${section.name}`}
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-fg-muted opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/header:opacity-100"
					>
						<PlusIcon className="size-3.5" />
					</Link>
					<Menu>
						<MenuTrigger asChild>
							<Button
								variant="ghost"
								size="xs"
								aria-label={`Actions for ${section.name}`}
								title={`Actions for ${section.name}`}
								className="w-6 px-0 text-sidebar-fg-muted opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100 data-[state=open]:opacity-100"
							>
								⋯
							</Button>
						</MenuTrigger>
						<MenuContent align="end">
							<MenuItem icon={<PencilIcon />} onSelect={onRename}>
								Rename
							</MenuItem>
							<MenuItem icon={<PlusIcon />} onSelect={onNewSection}>
								New section...
							</MenuItem>
							<MenuSeparator />
							<MenuItem destructive onSelect={onDelete}>
								Delete section
							</MenuItem>
						</MenuContent>
					</Menu>
				</div>
				<CollapsibleContent>
					<div className="flex flex-col gap-1">
						{members.map((workspace) => {
							const repo = repoById.get(workspace.repoId);
							return (
								<div
									key={workspace.id}
									data-workspace-id={workspace.id}
									className="touch-none"
									onClickCapture={pointer.consumeClick}
									onPointerDown={(event) => {
										drag.startDrag(workspace.id);
										pointer.start(event, { kind: "workspace", id: workspace.id });
									}}
								>
									{repo === undefined ? (
										<p className="truncate px-2 py-1.5 text-sm text-fg-muted">
											{workspace.displayName ?? workspace.branch}
										</p>
									) : (
										<WorkspaceRow
											workspace={workspace}
											repo={repo}
											selected={selectedId === workspace.id}
											shortcutIndex={null}
											indent="flush"
										/>
									)}
								</div>
							);
						})}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}
