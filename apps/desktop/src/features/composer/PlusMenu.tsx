/**
 * @feature COMP-07 Composer plus menu
 * Owns: the '+' menu: add attachment, link issue, link workspaces, plan mode and add snippet.
 * Behaviour: ui-map.md 3.5 ('+' menu: 'Link issue' (Cmd+I), 'Link workspaces', 'Plan mode' or 'Exit
 * plan mode' (Shift+Tab), 'Add attachment' (Cmd+U), 'Add snippet' (Cmd+;)), 5.2 (the composer's '+'
 * popover), 5.4 (the shortcuts come from the command registry).
 * Our design choice: Add attachment opens the file picker through the attachments controller.
 * Plan mode runs the same command as the toolbar chip. Link workspaces (WS-07) opens the linked
 * directories dialog. Link issue (PR-09) and Add snippet (COMP-09) are listed disabled until
 * their features build them.
 * Must handle: a cancelled picker; a chat whose agent has no plan mode (the command explains); the
 * menu follows the live bindings.
 * Test first: choosing 'Add attachment' opens the file picker and adds the chosen paths to the
 * draft.
 */
import type { SessionId } from "@conducted/shared";
import { useStore } from "zustand";
import { useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useLiveShortcut } from "../../core/hooks.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import {
	FileTextIcon,
	FolderPlusIcon,
	ListTodoIcon,
	PlusIcon,
	SearchIcon,
} from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { PLAN_MODE_UNAVAILABLE } from "./mentions/SlashCommandExtension.ts";

export interface PlusMenuProps {
	sessionId: SessionId;
	/** Opens the file picker and adds what the user chose. */
	onAddAttachment: () => void;
	/** Opens the Link workspaces and directories dialog. */
	onLinkWorkspaces: () => void;
}

export function PlusMenu({ sessionId, onAddAttachment, onLinkWorkspaces }: PlusMenuProps) {
	const { services } = useServices();
	const runCommand = useRunCommandHandlers();
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const planMode = session?.config.planMode === true;
	const addShortcut = useLiveShortcut("chat.addAttachment");
	const issueShortcut = useLiveShortcut("chat.linkIssue");
	const planShortcut = useLiveShortcut("chat.togglePlanMode");
	const snippetShortcut = useLiveShortcut("chat.insertSnippet");

	return (
		<Menu>
			<MenuTrigger asChild>
				<IconButton
					size="xs"
					label="Add attachments, link issues, and more"
					shortcut={addShortcut ?? undefined}
					icon={<PlusIcon />}
				/>
			</MenuTrigger>
			<MenuContent align="start">
				<MenuItem shortcut={addShortcut ?? undefined} onSelect={onAddAttachment}>
					Add attachment
				</MenuItem>
				<MenuItem
					disabled
					title="Link issue needs Linear"
					shortcut={issueShortcut ?? undefined}
					icon={<SearchIcon />}
				>
					Link issue
				</MenuItem>
				<MenuItem icon={<FolderPlusIcon />} onSelect={onLinkWorkspaces}>
					Link workspaces
				</MenuItem>
				<MenuItem
					shortcut={planShortcut ?? undefined}
					icon={<ListTodoIcon />}
					onSelect={() => {
						if (!runCommand("chat.togglePlanMode")) toast.error(PLAN_MODE_UNAVAILABLE);
					}}
				>
					{planMode ? "Exit plan mode" : "Plan mode"}
				</MenuItem>
				<MenuItem
					disabled
					title="Add snippet needs snippets"
					shortcut={snippetShortcut ?? undefined}
					icon={<FileTextIcon />}
				>
					Add snippet
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}
