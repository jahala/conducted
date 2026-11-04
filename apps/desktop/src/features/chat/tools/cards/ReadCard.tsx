/**
 * @feature CHAT-08 Read card
 * Owns: The card for a file read: path, line range and a short excerpt of the result.
 * Behaviour: frontend.md 5 (registry key 'read'), ui-map.md 3.3.
 * Must handle: Result not back yet (running); result is an error (file missing, shown in the
 * frame); a very large result (truncated flag, 'Output was cut'); a path inside the workspace is
 * shown relative; clicking the path opens the file tab.
 * Test first: A read call with a result shows the relative path; clicking it sets tab=file and path
 * in the URL.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ReadCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
