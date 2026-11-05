/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the command hooks: saved key bindings, the command list and its live key hints.
 * Behaviour: services-map.md 1.3; core/hooks.ts states the contract.
 * Must handle: overrides whose text cannot be read; a command with no binding.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import type { AppError } from "@conducted/shared";
import { useMemo } from "react";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import {
	liveShortcut,
	parseShortcutOverrides,
	type ShortcutOverrides,
	toCommandEntries,
} from "../registries/commands.ts";
import { useSetting } from "./settings.ts";

/**
 * The saved key bindings and, when the text cannot be read, the reason. A screen that can show a
 * notice reads `error` instead of leaving the user with defaults that do not match what they saved.
 */
export function useShortcutOverrides(): { overrides: ShortcutOverrides; error: AppError | null } {
	const stored = useSetting<string>("keybinding_overrides_v1");
	return useMemo(() => {
		const parsed = parseShortcutOverrides(stored);
		return parsed.ok
			? { overrides: parsed.value, error: null }
			: { overrides: {}, error: parsed.error };
	}, [stored]);
}
export const useCommands: Queries["useCommands"] = () => {
	const { services } = useServices();
	const { overrides } = useShortcutOverrides();
	return useMemo(
		() => toCommandEntries((id) => services.commands.isEnabled(id), overrides),
		[services, overrides],
	);
};
/**
 * Display form of a command's live first binding, for a key-cap hint. Follows the saved overrides.
 * Null when the command is unknown or unbound.
 */
export function useLiveShortcut(commandId: string): string | null {
	const { overrides } = useShortcutOverrides();
	return useMemo(() => liveShortcut(commandId, overrides), [commandId, overrides]);
}
