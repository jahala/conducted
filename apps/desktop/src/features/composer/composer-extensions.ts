/**
 * @feature COMP-04 Composer extensions
 * Owns: The list of TipTap extensions the editor loads, built from the trigger extensions for @, #
 * and /.
 * Behaviour: ui-map.md 3.5 (triggers: '@' files and directories, plans, terminal output, linked
 * directories; '#' pull requests and issues; '/' built-in commands, project commands and skills).
 * Our design choice: A function from dependencies to extensions, so the editor can be tested with
 * stand-in search functions. The fourth Conductor trigger (a section sign for saved snippets) is
 * not verified and is left out.
 * Must handle: Each trigger is an independent extension; a trigger character inside a word or a
 * code span does not open a popup; extensions are created once per editor, not per render.
 * Test first: buildComposerExtensions returns one extension for each of the three triggers plus the
 * base kit.
 */
import { notImplemented } from "@conducted/shared";
import type { Extensions } from "@tiptap/react";
import type { FileMentionDeps } from "./mentions/FileMention.ts";
import type { PrMentionDeps } from "./mentions/PrMention.ts";
import type { SlashCommandDeps } from "./mentions/SlashCommandExtension.ts";

export interface ComposerExtensionDeps {
	files: FileMentionDeps;
	pullRequests: PrMentionDeps;
	slash: SlashCommandDeps;
}

export function buildComposerExtensions(_props: ComposerExtensionDeps): Extensions {
	return notImplemented("COMP-04");
}
