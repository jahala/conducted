/**
 * @feature NAV-10 Tab item
 * Owns: One tab in the strip: icon by type (a file tab shows its language icon), label, close
 * button, and for chats the status icon while the agent works or waits for the user, else the
 * unread dot, before the title. An idle chat tab has no icon (Conductor's renderApp chat tab).
 * Behaviour: ui-map.md 3.2 (chat tab: status icon, title, unread dot, fixed width; terminal tab
 * 'Terminal N' with its cloud or laptop host icon in a cloud workspace (CLOUD-09); comment tab
 * 'Comment by <author>'; PR tab 'PR #N'; browser tab shows the URL host),
 * ui-dimensions.md (tab 40px tall, chat 176px wide, other tabs 128px, 2px accent underline when
 * active, close button 20px).
 * Our design choice: the tab is one focusable element with role "tab"; the close button sits beside
 * the label and never nests a button inside another button.
 * Must handle: Long titles truncate with the full title in a tooltip; the close button is reachable
 * by keyboard and has the label 'Close <title>'; middle click closes; a dragged tab reports its ref;
 * the active tab is marked by an underline and weight; role 'tab' with aria-selected.
 * Test first: Middle click calls onClose; the close button's name includes the tab title.
 */
import type { DragEvent, HTMLAttributes, Ref } from "react";
import { cn } from "../../ui/cn.ts";
import { FileTypeIcon } from "../../ui/file-icon.tsx";
import {
	ChatIcon,
	CloseIcon,
	CloudIcon,
	GlobeIcon,
	LaptopIcon,
	PullRequestIcon,
	TerminalIcon,
} from "../../ui/icons.tsx";
import { UnreadDot } from "../sidebar/UnreadDot.tsx";
import { statusText } from "./status-text.ts";
import type { TabDescriptor } from "./tab-layout.ts";
import { WorkspaceStatusIcon } from "./WorkspaceStatusIcon.tsx";

export interface TabItemProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
	tab: TabDescriptor;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
	onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
	ref?: Ref<HTMLDivElement>;
}

/**
 * A chat tab shows a mark only while there is something to say: its status while the agent works or
 * waits for the user, else the unread dot. An idle chat shows none, as in Conductor (renderApp's chat
 * tab icon).
 */
function sessionMark(tab: TabDescriptor) {
	const tone = statusText(tab.status ?? null).tone;
	if (tone === "active" || tone === "attention") {
		return <WorkspaceStatusIcon status={tab.status ?? null} />;
	}
	return tab.unread === true ? <UnreadDot unread /> : null;
}

function TabIcon({ tab }: { tab: TabDescriptor }) {
	switch (tab.kind) {
		case "session":
			return sessionMark(tab);
		case "terminal":
			if (tab.hostKind === "cloud") {
				return (
					<span data-host="cloud" className="contents">
						<CloudIcon />
					</span>
				);
			}
			if (tab.hostKind === "local") {
				return (
					<span data-host="local" className="contents">
						<LaptopIcon />
					</span>
				);
			}
			return <TerminalIcon />;
		case "file":
			return <FileTypeIcon path={tab.ref} />;
		case "comment":
			return <ChatIcon />;
		case "pr":
			return <PullRequestIcon />;
		case "browser":
			return <GlobeIcon />;
	}
}

export function TabItem({
	tab,
	active,
	onSelect,
	onClose,
	onDragStart,
	ref,
	...rest
}: TabItemProps) {
	return (
		// The tab is a div so the close button can sit inside it without nesting buttons.
		<div
			{...rest}
			ref={ref}
			role="tab"
			aria-selected={active}
			aria-label={tab.title}
			title={tab.title}
			tabIndex={active ? 0 : -1}
			draggable={onDragStart !== undefined}
			onDragStart={onDragStart}
			onClick={onSelect}
			onAuxClick={(event) => {
				if (event.button === 1) {
					event.preventDefault();
					onClose();
				}
			}}
			onKeyDown={(event) => {
				// A key pressed on the close button belongs to that button, not to the tab.
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onSelect();
				}
			}}
			className={cn(
				"group flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm",
				tab.kind === "session" ? "w-44" : "w-32",
				active
					? "border-accent font-medium text-fg"
					: "border-transparent text-fg-muted hover:bg-hover hover:text-fg",
			)}
		>
			{tab.kind === "session" && sessionMark(tab) === null ? null : (
				<span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
					<TabIcon tab={tab} />
				</span>
			)}
			<span className="min-w-0 flex-1 truncate">
				{/* A file tab shows the file's own name, as Conductor's tabs do; the full path is its tooltip. */}
				{tab.kind === "file" ? (tab.title.split("/").at(-1) ?? tab.title) : tab.title}
			</span>
			<button
				type="button"
				aria-label={`Close ${tab.title}`}
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
				className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle opacity-0 hover:bg-active hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
			>
				<CloseIcon />
			</button>
		</div>
	);
}
