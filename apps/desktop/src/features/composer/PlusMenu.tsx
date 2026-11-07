/**
 * @feature COMP-07 Composer plus menu
 * Owns: the '+' menu: add attachment, link issue, link workspaces, plan mode, Remote Control and add
 * snippet.
 * Behaviour: ui-map.md 3.5 ('+' menu: 'Link issue' (Cmd+I), 'Link workspaces', 'Plan mode' or 'Exit
 * plan mode' (Shift+Tab), 'Add attachment' (Cmd+U), 'Add snippet' (Cmd+;)), 5.2 (the composer's '+'
 * popover), 5.4 (the shortcuts come from the command registry).
 * Our design choice: Add attachment opens the file picker through the attachments controller.
 * Plan mode runs the chat.togglePlanMode command, as Shift+Tab does. Remote Control (RC-02, ours) is a
 * per-chat mode like plan mode, so its switch sits after it, on Claude chats only (D098). Link workspaces (WS-07) opens the linked
 * directories dialog, and Link issue (PR-09) the Link issue dialog. Add snippet opens the create
 * form, and Insert snippet opens the picker with the same Cmd+; binding as the shortcut (COMP-09).
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
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useRemoteControlSwitch } from "../chat/RemoteControlButton.tsx";
import { PLAN_MODE_UNAVAILABLE } from "./mentions/SlashCommandExtension.ts";

export interface PlusMenuProps {
	sessionId: SessionId;
	/** Opens the file picker and adds what the user chose. */
	onAddAttachment: () => void;
	/** Opens the Link issue dialog. */
	onLinkIssue: () => void;
	/** Opens the Link workspaces and directories dialog. */
	onLinkWorkspaces: () => void;
	/** Opens the Create snippet form. */
	onAddSnippet: () => void;
	/** Opens the snippet picker. */
	onInsertSnippet: () => void;
}

export function PlusMenu({
	sessionId,
	onAddAttachment,
	onLinkIssue,
	onLinkWorkspaces,
	onAddSnippet,
	onInsertSnippet,
}: PlusMenuProps) {
	const { services } = useServices();
	const runCommand = useRunCommandHandlers();
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const planMode = session?.config.planMode === true;
	const addShortcut = useLiveShortcut("chat.addAttachment");
	const issueShortcut = useLiveShortcut("chat.linkIssue");
	const planShortcut = useLiveShortcut("chat.togglePlanMode");
	const snippetShortcut = useLiveShortcut("chat.insertSnippet");
	const remoteControl = useRemoteControlSwitch(sessionId);

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
					shortcut={issueShortcut ?? undefined}
					icon={<SearchIcon />}
					onSelect={onLinkIssue}
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
				{remoteControl.offered ? (
					<MenuCheckboxItem
						checked={remoteControl.on}
						onCheckedChange={(checked) => remoteControl.setOn(checked)}
					>
						Remote Control
					</MenuCheckboxItem>
				) : null}
				<MenuItem icon={<FileTextIcon />} onSelect={onAddSnippet}>
					Add snippet
				</MenuItem>
				<MenuItem
					shortcut={snippetShortcut ?? undefined}
					icon={<FileTextIcon />}
					onSelect={onInsertSnippet}
				>
					Insert snippet
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}
