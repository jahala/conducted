/**
 * @feature NAV-08 Command palette
 * Owns: The Cmd+K dialog: one search box over workspaces, projects, actions, settings and, in a
 * workspace, its actions.
 * Behaviour: ui-map.md 5.1 (dialog on cmdk; tabs all, workspaces, projects, actions, settings cycled
 * with Tab and Shift+Tab; the placeholder changes per tab; groups for recent workspaces, workspaces,
 * archived, projects, chats, workspace actions, actions, navigation, settings and open-in; empty
 * "No results found"; loading spinner in the heading), 5.4 (Cmd+E edits and Cmd+Backspace deletes a
 * highlighted section).
 * Our design choice: the items come from palette-model.ts and the live command registry. The screen
 * routes a chosen item by its id prefix. Cloud groups (organizations, people, templates) are left out.
 * A "Chat history" group appears only when the caller supplies hits; CHAT-17 owns searching for them.
 * Must handle: no workspace selected (workspace actions hidden); archived workspaces only under
 * Archived; a disabled command shown muted and doing nothing; Escape closes; opening again starts
 * clean; the section sub-page for "Move to section"; renaming and removing a section from the palette.
 * Test first: Typing "arch" lists "Archive workspace" when a workspace is open and not when none is.
 */
import type { SectionId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { createLatestWins } from "../../core/async/latest-wins.ts";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useCommands,
	useRepos,
	useSections,
	useSessions,
	useSetting,
	useWorkspaces,
} from "../../core/hooks.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { Spinner } from "../../ui/Spinner.tsx";
import { toastError } from "../../ui/Toast.tsx";
import type { PaletteItem, PaletteTab } from "./palette-model.ts";
import {
	buildPaletteGroups,
	buildSectionGroups,
	nextPaletteTab,
	palettePlaceholder,
} from "./palette-model.ts";

const TAB_LABELS: Readonly<Record<PaletteTab, string>> = {
	all: "All",
	workspaces: "Workspaces",
	projects: "Projects",
	actions: "Actions",
	settings: "Settings",
};

const itemClass =
	"flex h-11 cursor-default items-center gap-3 rounded-md px-3 text-sm text-fg outline-none data-[selected=true]:bg-active data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50";

export function CommandPalette({ open, onOpenChange, workspaceId }: OverlayProps) {
	const navigate = useNavigate();
	const services = useServices();
	const actions = useActions();
	const repos = useRepos();
	const workspaces = useWorkspaces();
	const sections = useSections();
	const commands = useCommands();
	const sessions = useSessions((workspaceId ?? "") as WorkspaceId);
	const defaultOpenIn = useSetting<string>("default_open_in");
	const showOverlay = useOverlayStore((state) => state.show);

	const [tab, setTab] = useState<PaletteTab>("all");
	const [query, setQuery] = useState("");
	const [subpage, setSubpage] = useState<"root" | "sections">("root");
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
	const [installedApps, setInstalledApps] = useState<string[]>([]);

	const latestApps = useRef(createLatestWins<"installed-apps">()).current;

	useEffect(() => {
		if (!open) {
			setTab("all");
			setQuery("");
			setSubpage("root");
			setSelectedId(undefined);
			setEditing(null);
			return;
		}
		const ticket = latestApps.begin("installed-apps");
		void services.platform.opener.installedApps().then(
			(apps) => {
				if (latestApps.isLatest(ticket)) {
					setInstalledApps((current) =>
						current.length === apps.length && current.every((app, index) => app === apps[index])
							? current
							: apps,
					);
				}
				latestApps.settle(ticket);
			},
			(cause: unknown) => {
				latestApps.settle(ticket);
				const message = cause instanceof Error ? cause.message : String(cause);
				services.platform.app.writeLog("warn", `Could not list installed apps: ${message}`);
			},
		);
		return () => latestApps.invalidate("installed-apps");
	}, [latestApps, open, services]);

	const repoList = repos.state === "ready" ? repos.data : [];
	const workspaceList = workspaces.state === "ready" ? workspaces.data : [];
	const sectionList = sections.state === "ready" ? sections.data : [];
	const sessionList = workspaceId !== null && sessions.state === "ready" ? sessions.data : [];

	const visibleGroups = useMemo(() => {
		if (subpage === "sections") {
			return buildSectionGroups(query, sectionList, workspaceId);
		}
		return buildPaletteGroups({
			tab,
			query,
			workspaces: workspaceList,
			repos: repoList,
			commands,
			currentWorkspaceId: workspaceId,
			sessions: sessionList,
			installedApps,
			defaultOpenInApp: defaultOpenIn === "" ? null : defaultOpenIn,
		});
	}, [
		commands,
		defaultOpenIn,
		installedApps,
		query,
		repoList,
		sessionList,
		sectionList,
		subpage,
		tab,
		workspaceId,
		workspaceList,
	]);

	const loading = repos.state === "loading" || workspaces.state === "loading";
	const loadError =
		repos.state === "error" ? repos.error : workspaces.state === "error" ? workspaces.error : null;

	const close = () => onOpenChange(false);

	const workspaceById = (id: string) =>
		workspaceList.find((workspace) => workspace.id === id) ?? null;

	const openWorkspace = (id: string) => {
		const workspace = workspaceById(id);
		if (workspace === null) return false;
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: workspace.repoId, workspaceId: workspace.id },
		});
		close();
		return true;
	};

	const openSettings = (page: string) => {
		void navigate({ to: "/settings/$page", params: { page } });
		close();
		return true;
	};

	const moveToSection = async (sectionId: SectionId | null) => {
		if (workspaceId === null) return;
		const section = sectionList.find((entry) => entry.id === sectionId);
		const position = section === undefined ? 0 : section.workspaceIds.length;
		const result = await actions.sections.place(workspaceId as WorkspaceId, sectionId, position);
		if (!result.ok) {
			toastError("Couldn't move the workspace", result.error);
			return;
		}
		close();
	};

	const saveSection = async () => {
		if (editing === null) return;
		const section = sectionList.find((entry) => entry.id === editing.id);
		if (section === undefined) {
			setEditing(null);
			return;
		}
		const result = await actions.sections.rename(section.id, editing.text, section.emoji);
		if (!result.ok) {
			toastError("Couldn't rename the section", result.error);
			return;
		}
		setEditing(null);
	};

	const removeSection = async (id: string) => {
		const result = await actions.sections.remove(id as SectionId);
		if (!result.ok) {
			toastError("Couldn't delete the section", result.error);
			return;
		}
		close();
	};

	const runItem = async (item: PaletteItem) => {
		if (item.disabled) return;

		if (subpage === "sections") {
			if (item.id === "section:none") {
				await moveToSection(null);
			} else if (item.id.startsWith("section:")) {
				await moveToSection(item.id.slice("section:".length) as SectionId);
			}
			return;
		}

		if (item.id === "workspace.moveToSection") {
			setSubpage("sections");
			setQuery("");
			setSelectedId(undefined);
			return;
		}
		if (item.id === "nav.quickOpenFile") {
			showOverlay("quick-open");
			return;
		}
		if (item.id === "nav.searchInFiles") {
			showOverlay("search-files");
			return;
		}
		if (item.id === "app.showShortcuts") {
			showOverlay("shortcuts");
			return;
		}
		if (item.id === "app.openPassport") {
			showOverlay("passport");
			return;
		}
		if (item.id === "app.openSettings") {
			openSettings("general");
			return;
		}
		if (item.id.startsWith("workspace:")) {
			openWorkspace(item.id.slice("workspace:".length));
			return;
		}
		if (item.id.startsWith("project:")) {
			void navigate({ to: "/all-workspaces" });
			close();
			return;
		}
		if (item.id.startsWith("chat:")) {
			const session = sessionList.find((entry) => entry.id === item.id.slice("chat:".length));
			const workspace = session === undefined ? null : workspaceById(session.workspaceId);
			if (session !== undefined && workspace !== null) {
				void navigate({
					to: "/repository/$repositoryId/workspace/$workspaceId",
					params: { repositoryId: workspace.repoId, workspaceId: workspace.id },
					search: { tab: "session", sessionId: session.id },
				});
				close();
			}
			return;
		}
		if (item.id.startsWith("settings:")) {
			const parts = item.id.split(":");
			openSettings(parts[1] ?? "general");
			return;
		}
		if (item.id.startsWith("open-in:") && workspaceId !== null) {
			const result = await actions.workspaces.openIn(
				workspaceId as WorkspaceId,
				item.id.slice("open-in:".length),
			);
			if (!result.ok) {
				toastError("Couldn't open the workspace", result.error);
				return;
			}
			close();
			return;
		}
		if (item.id.startsWith("history:")) {
			close();
			return;
		}

		const result = await services.services.commands.run(item.id);
		if (!result.ok) {
			toastError(`Couldn't ${item.label.toLowerCase()}`, result.error);
			return;
		}
		close();
	};

	useCommandHandler("palette.nextTab", "modal", () => {
		setTab((current) => nextPaletteTab(current, 1));
		return true;
	});
	useCommandHandler("palette.previousTab", "modal", () => {
		setTab((current) => nextPaletteTab(current, -1));
		return true;
	});
	useCommandHandler("palette.editItem", "modal", () => {
		if (subpage === "sections" && selectedId !== undefined) {
			if (selectedId.startsWith("section:") && selectedId !== "section:none") {
				const section = sectionList.find((entry) => `section:${entry.id}` === selectedId);
				if (section !== undefined) setEditing({ id: section.id, text: section.name });
			}
		}
		return true;
	});
	useCommandHandler("palette.deleteItem", "modal", () => {
		if (subpage === "sections" && selectedId !== undefined) {
			if (selectedId.startsWith("section:") && selectedId !== "section:none") {
				void removeSection(selectedId.slice("section:".length));
			}
		}
		return true;
	});

	const placeholder = subpage === "sections" ? "Search sections..." : palettePlaceholder(tab);

	return (
		<Command.Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
			label="Command palette"
			shouldFilter={false}
			value={selectedId ?? ""}
			onValueChange={setSelectedId}
			overlayClassName="fixed inset-0 z-40 bg-overlay"
			contentClassName="fixed left-1/2 top-[max(2rem,calc(50%-250px))] z-50 flex w-(--palette-width) max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-raised text-fg shadow-palette"
		>
			<h2 className="sr-only">Command palette</h2>
			<div className="flex h-11 items-center gap-2 border-b border-border px-3">
				{loading ? <Spinner label="Searching" size="sm" className="text-fg-muted" /> : null}
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder={placeholder}
					aria-label={placeholder}
					className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>
			<div role="tablist" aria-label="Command palette tabs" className="flex gap-1 px-2 pt-2">
				{(Object.keys(TAB_LABELS) as PaletteTab[]).map((value) => (
					<button
						key={value}
						type="button"
						role="tab"
						aria-selected={tab === value}
						onClick={() => {
							setTab(value);
							setSubpage("root");
							setQuery("");
						}}
						className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-hover aria-selected:bg-active aria-selected:text-fg"
					>
						{TAB_LABELS[value]}
					</button>
				))}
			</div>
			{loading ? (
				<div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted">
					<Spinner label="Loading the command palette" size="sm" />
					Loading
				</div>
			) : null}
			{loadError !== null ? (
				<p role="alert" className="px-3 py-2 text-xs text-danger">
					Couldn't load the palette. {loadError.message}
				</p>
			) : null}
			{editing !== null ? (
				<div className="flex items-center gap-2 p-3">
					<label className="sr-only" htmlFor="palette-section-name">
						Section name
					</label>
					<input
						id="palette-section-name"
						value={editing.text}
						onChange={(event) =>
							setEditing((current) =>
								current === null ? null : { ...current, text: event.target.value },
							)
						}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void saveSection();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								setEditing(null);
							}
						}}
						className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-transparent px-2 text-sm text-fg outline-none focus:border-accent"
					/>
					<button
						type="button"
						onClick={() => void saveSection()}
						className="h-8 rounded-md bg-primary-fill px-3 text-sm font-medium text-canvas"
					>
						Save
					</button>
					<button
						type="button"
						onClick={() => setEditing(null)}
						className="h-8 rounded-md border border-border-strong px-3 text-sm font-medium text-fg hover:bg-hover"
					>
						Cancel
					</button>
				</div>
			) : null}
			<Command.List className="max-h-(--palette-max-height) overflow-y-auto p-2">
				{visibleGroups.map((group) => (
					<Command.Group
						key={group.heading}
						heading={group.heading}
						className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
					>
						{group.items.map((item) => (
							<Command.Item
								key={item.id}
								value={item.id}
								disabled={item.disabled}
								onSelect={() => {
									void runItem(item);
								}}
								className={itemClass}
							>
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
								{item.hint === null ? null : (
									<span className="shrink-0 text-xs text-fg-subtle">{item.hint}</span>
								)}
								{item.shortcut === null ? null : <Kbd>{item.shortcut}</Kbd>}
							</Command.Item>
						))}
					</Command.Group>
				))}
				<Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">
					No results found
				</Command.Empty>
			</Command.List>
			<div className="flex items-center gap-2 border-t border-border px-3 py-2 text-2xs text-fg-subtle">
				<Kbd>Tab</Kbd>
				<span>Switch tabs</span>
				<Kbd>↵</Kbd>
				<span>Choose</span>
			</div>
			<button type="button" className="sr-only" onClick={close}>
				Close
			</button>
		</Command.Dialog>
	);
}
