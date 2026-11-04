/**
 * @feature COMP-02 Model picker
 * Owns: The button and menu that choose agent, model, effort and fast mode for a chat, with
 * favourites.
 * Behaviour: ui-map.md 3.5 (Model picker, Cmd+/: favourites up to 5 selectable with Cmd+Ctrl+1..5,
 * submenus Agent, Model, Effort, toggle Fast (Cmd+Shift+E), search 'Search models', 'No models
 * found'; switching agent or model in a started chat shows 'Opens in new chat'; Cmd+Shift+/ cycles
 * effort), claude-runner.md 7.
 * Our design choice: A started chat keeps its agent: picking another agent opens a new chat. A
 * model change in a started chat is applied live when the agent allows it (the sidecar decides) and
 * warns that the next reply may be slower and cost more.
 * Must handle: Models not loaded (loading row); the agent is not installed or not signed in (item
 * disabled with a link to settings); a model that lacks the current effort (switch to its default
 * and say so); fast mode not available for the model or the account (toggle hidden); no models
 * match the search; ACP agents (OpenCode, Pi) listed under Agent.
 * Test first: Choosing a model that supports only 'high' effort while 'max' is set updates the
 * config to 'high'.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ModelPickerProps {
	sessionId: SessionId;
}

export function ModelPicker(_props: ModelPickerProps): never {
	return notImplemented("COMP-02");
}
