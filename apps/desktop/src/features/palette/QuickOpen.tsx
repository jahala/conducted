/**
 * @feature REV-07 Quick open
 * Owns: The Cmd+P dialog that opens a file of the current workspace by typing part of its name.
 * Behaviour: ui-map.md 3.6 (quick open Cmd+P 'Open file picker'), 3.10 (Quick open dialog).
 * Data: useFileSearch(workspaceId, query) does the fuzzy matching. Choosing a file sets tab=file in
 * the URL.
 * Must handle: No workspace selected (explains and offers nothing); tree loading (spinner); huge
 * tree (show the first 50 matches); files ignored by git are not offered; recently opened files
 * first when the query is empty; Escape closes.
 * Test first: Typing 'appshell' lists 'src/app/AppShell.tsx'; Enter opens it as a file tab.
 */
import { notImplemented } from "@conducted/shared";
import type { OverlayProps } from "../../ui/overlay-props.ts";

export function QuickOpen(_props: OverlayProps): never {
	return notImplemented("REV-07");
}
