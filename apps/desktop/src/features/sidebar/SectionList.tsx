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
 * renaming to an empty name is refused; dragging a section header reorders sections; row drags
 * reorder only when 'Arrange workspaces by hand' is on.
 * Our design choice: A drop writes through the sections service and the service store is the
 * only order the list shows, so a failed write leaves the previous order in place.
 * Test first: Placing a workspace into a section calls sections.place with the section id and the
 * drop position; a failed call restores the previous order.
 */
import type { SectionId, WorkspaceId } from "@conducted/shared";
import { Link, useParams } from "@tanstack/react-router";
import { type DragEvent, useMemo, useState } from "react";
import { useActions, useRepos, useSetting } from "../../core/hooks.ts";
import type { Repo, Section, Workspace } from "../../core/model.ts";
import { AlertDialog, AlertDialogContent } from "../../ui/AlertDialog.tsx";
import { Button } from "../../ui/Button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/Collapsible.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, PlusIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { SectionDialog } from "./SectionDialog.tsx";
import { useNow } from "./use-now.ts";
import { useWorkspaceDrag, WORKSPACE_DRAG_MIME } from "./use-workspace-drag.ts";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

export interface SectionListProps {
	sections: readonly Section[];
	workspaces: readonly Workspace[];
}

const SECTION_DRAG_MIME = "application/x-conducted-section";
const REORDER_TITLE = "Couldn't reorder section";
const DELETE_TITLE = "Couldn't delete section";

function orderedSections(sections: readonly Section[]): Section[] {
	return [...sections].sort(
		(left, right) => left.position - right.position || left.id.localeCompare(right.id),
	);
}

function carriedWorkspace(event: DragEvent): WorkspaceId | null {
	const value =
		event.dataTransfer?.getData(WORKSPACE_DRAG_MIME) ||
		event.dataTransfer?.getData("text/plain") ||
		"";
	return value === "" ? null : (value as WorkspaceId);
}

export function SectionList({ sections, workspaces }: SectionListProps) {
	const actions = useActions();
	const repos = useRepos();
	const params = useParams({ strict: false });
	const selectedId = (params as { workspaceId?: WorkspaceId }).workspaceId ?? null;
	const now = useNow();
	const manualOrder = useSetting<boolean>("manual_workspace_order");
	const [editing, setEditing] = useState<Section | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [deleting, setDeleting] = useState<Section | null>(null);
	const [draggingSection, setDraggingSection] = useState<SectionId | null>(null);
	const [overSection, setOverSection] = useState<SectionId | null>(null);

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

	const openCreate = () => {
		setEditing(null);
		setDialogOpen(true);
	};

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

	const reorderSection = (target: Section, after: boolean) => {
		if (draggingSection === null || draggingSection === target.id) {
			setDraggingSection(null);
			setOverSection(null);
			return;
		}
		const current = orderedSections(sections).map((section) => section.id);
		const without = current.filter((id) => id !== draggingSection);
		const targetIndex = without.indexOf(target.id);
		const index = Math.max(0, after ? targetIndex + 1 : targetIndex);
		const next = [...without.slice(0, index), draggingSection, ...without.slice(index)];
		setDraggingSection(null);
		setOverSection(null);
		void actions.sections.reorder(next).then((result) => {
			if (!result.ok) toastError(REORDER_TITLE, result.error);
		});
	};

	const ordered = orderedSections(sections);

	return (
		<div className="flex flex-col gap-1 py-1">
			{ordered.map((section) => {
				const members = section.workspaceIds
					.map((id) => byId.get(id))
					.filter((workspace): workspace is Workspace => workspace !== undefined);
				return (
					<SectionGroup
						key={section.id}
						section={section}
						members={members}
						repoById={repoById}
						selectedId={selectedId}
						now={now}
						manualOrder={manualOrder}
						over={overSection === section.id}
						draggingSection={draggingSection !== null}
						onDragSectionStart={(event) => {
							event.dataTransfer?.setData(SECTION_DRAG_MIME, section.id);
							event.dataTransfer?.setData("text/plain", section.id);
							setDraggingSection(section.id);
						}}
						onDragSectionEnd={() => {
							setDraggingSection(null);
							setOverSection(null);
						}}
						onDragOverSection={() => setOverSection(section.id)}
						onDropSection={(after) => reorderSection(section, after)}
						onRename={() => openRename(section)}
						onDelete={() => setDeleting(section)}
						onNewSection={openCreate}
					/>
				);
			})}
			<Button
				variant="ghost"
				size="sm"
				className="mx-2 justify-start text-fg-muted"
				onClick={openCreate}
			>
				<PlusIcon />
				New section...
			</Button>

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
	now: number;
	manualOrder: boolean;
	over: boolean;
	draggingSection: boolean;
	onDragSectionStart: (event: DragEvent) => void;
	onDragSectionEnd: () => void;
	onDragOverSection: () => void;
	onDropSection: (after: boolean) => void;
	onRename: () => void;
	onDelete: () => void;
	onNewSection: () => void;
}

function SectionGroup({
	section,
	members,
	repoById,
	selectedId,
	now,
	manualOrder,
	over,
	draggingSection,
	onDragSectionStart,
	onDragSectionEnd,
	onDragOverSection,
	onDropSection,
	onRename,
	onDelete,
	onNewSection,
}: SectionGroupProps) {
	const actions = useActions();
	const [open, setOpen] = useState(!section.collapsed);
	const [renaming, setRenaming] = useState(false);
	const drag = useWorkspaceDrag({
		order: members.map((workspace) => workspace.id),
		sectionId: section.id,
		manualOrder,
		place: (workspaceId, sectionId, position) =>
			actions.sections.place(workspaceId, sectionId, position),
		onError: toastError,
	});

	const changeOpen = (next: boolean) => {
		setOpen(next);
		void actions.sections.setCollapsed(section.id, !next).then((result) => {
			if (!result.ok) toastError("Couldn't save the section", result.error);
		});
	};

	const drop = (event: DragEvent) => {
		event.preventDefault();
		drag.dragOver(null);
		const carried = carriedWorkspace(event);
		if (carried === null) return;
		drag.dropOn(`section:${section.id}`, members.length, carried);
	};

	return (
		<section
			aria-label={section.name}
			className={cn("rounded-md", over && "bg-hover")}
			onDragOver={(event) => {
				event.preventDefault();
				drag.dragOver(`section:${section.id}`);
			}}
			onDragLeave={() => drag.dragOver(null)}
			onDrop={drop}
		>
			<Collapsible open={open} onOpenChange={changeOpen}>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: the header is the drop target that reorders sections. */}
				<div
					className="flex items-center gap-1 px-2"
					onDragOver={(event) => {
						if (!draggingSection) return;
						event.preventDefault();
						event.stopPropagation();
						onDragOverSection();
					}}
					onDrop={(event) => {
						if (!draggingSection) return;
						event.preventDefault();
						event.stopPropagation();
						onDropSection(true);
					}}
				>
					<CollapsibleTrigger
						draggable
						onDragStart={onDragSectionStart}
						onDragEnd={onDragSectionEnd}
						className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-sidebar-fg-muted hover:bg-hover hover:text-fg"
					>
						{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
						{section.emoji === null ? null : (
							<span aria-hidden="true" className="text-sm">
								{section.emoji}
							</span>
						)}
						<span className="truncate">{section.name}</span>
						{open ? null : <span className="ml-1 text-2xs text-fg-subtle">{members.length}</span>}
					</CollapsibleTrigger>
					<Link
						to="/create"
						search={{ section: section.id }}
						aria-label={`Create workspace in ${section.name}`}
						title={`Create workspace in ${section.name}`}
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
					>
						<PlusIcon />
					</Link>
					<Menu>
						<MenuTrigger asChild>
							<Button
								variant="ghost"
								size="xs"
								aria-label={`Actions for ${section.name}`}
								title={`Actions for ${section.name}`}
								className="w-6 px-0 text-fg-muted"
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
					<div className="flex flex-col gap-0.5 py-0.5">
						{members.map((workspace) => {
							const repo = repoById.get(workspace.repoId);
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: a sidebar row is a drag source; its link is the interactive part.
								<div
									key={workspace.id}
									draggable
									data-workspace-id={workspace.id}
									onDragStart={(event) => {
										event.dataTransfer?.setData(WORKSPACE_DRAG_MIME, workspace.id);
										event.dataTransfer?.setData("text/plain", workspace.id);
										drag.startDrag(workspace.id);
									}}
									onDragEnd={drag.cancel}
									onDragOver={(event) => {
										event.preventDefault();
										event.stopPropagation();
										drag.dragOver(`row:${workspace.id}`);
									}}
									onDrop={(event) => {
										event.preventDefault();
										event.stopPropagation();
										const carried = carriedWorkspace(event);
										if (carried === null) return;
										drag.dropOn(`row:${workspace.id}`, 1, carried);
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
											now={now}
										/>
									)}
								</div>
							);
						})}
					</div>
				</CollapsibleContent>
			</Collapsible>
			<SectionDialog open={renaming} onOpenChange={setRenaming} section={section} />
		</section>
	);
}
