/**
 * @feature NAV-08 Command palette
 * Owns: The Cmd+K dialog: one search box over workspaces, projects, actions, settings and, in a
 * workspace, its actions.
 * Behaviour: ui-map.md 5.1 (dialog 'cmdk-dialog' on the cmdk library; tabs all, workspaces,
 * projects, actions, settings cycled with Tab and Shift+Tab; placeholders 'Type a command or
 * search...' and per tab; groups Recent workspaces, Workspaces, Archived, Projects, workspace
 * actions, Actions, Navigation, Settings, Open in; empty 'No results found'; loading spinner in the
 * heading).
 * Our design choice: Built on cmdk's Command.Dialog, Command.Input, Command.List, Command.Group,
 * Command.Item, Command.Empty and Command.Loading. The items come from palette-model.ts and the
 * command registry (useCommands). Cloud groups (Organizations, People, Templates) are left out.
 * Must handle: No workspace selected (workspace actions hidden); archived workspaces appear only
 * under 'Archived'; a disabled command is shown muted and does nothing; results while typing keep
 * the first match highlighted; Escape closes; opening again starts clean; chat history search
 * (CHAT-17) shows as its own group when the query is long enough.
 * Test first: Typing 'arch' lists 'Archive workspace' when a workspace is open and not when none
 * is.
 */
import { notImplemented } from "@conducted/shared";
import type { OverlayProps } from "../../ui/overlay-props.ts";

export function CommandPalette(_props: OverlayProps): never {
	return notImplemented("NAV-08");
}
