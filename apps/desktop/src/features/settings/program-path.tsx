/**
 * @feature SET-02 Agent program path rows
 * Owns: the check a program path passes before it is saved, and the warning under a custom path, for
 * the Advanced page's program path rows (Conductor's, renderApp @11098556).
 * Behaviour: ui-map.md 6, "Advanced" and "Agents"; the warning is Conductor's (renderApp @10971526).
 * Must handle: an empty value (the bundled program, no warning and no check), a path that does not
 * exist (refused with its reason), and a setting that is not a program path (left alone).
 * Test first: AdvancedPage.test.tsx, a path that does not exist is refused and not saved.
 */
import type { ReactNode } from "react";
import type { SettingDef, SettingValue } from "../../core/registries/settings.ts";

const isProgramPath = (def: SettingDef): boolean => def.key.endsWith("_executable_path");

/** Refuses a program path that does not exist; any other value passes. */
export function programPathCheck(exists: (path: string) => Promise<boolean>) {
	return async (def: SettingDef, value: SettingValue): Promise<string | null> => {
		if (!isProgramPath(def)) return null;
		const text = typeof value === "string" ? value.trim() : "";
		if (text === "") return null;
		return (await exists(text)) ? null : `No program exists at ${text}.`;
	};
}

/** Conductor's warning under a custom program path. */
export function programPathWarning(def: SettingDef, value: SettingValue): ReactNode {
	if (!isProgramPath(def) || typeof value !== "string" || value.trim() === "") return null;
	return (
		<p className="mt-2 text-xs text-warning">
			Changing this may cause issues if the executable is not compatible with Conducted.
		</p>
	);
}
