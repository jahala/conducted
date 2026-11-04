/**
 * @feature SET-02 Settings navigation
 * Owns: the left column of the settings screen: the search box, the grouped page links, the
 * repository picker with its pages, and the Back button.
 * Behaviour: ui-map.md 6 (layout and navigation groups; Back and Esc leave; Cmd+F focuses search).
 * Must handle: the active page marked (aria-current), no repositories (the group says so and
 * offers Add project), many repositories (picker is searchable), keyboard navigation with the
 * arrow keys, and a narrow window (the column stays usable).
 * Test first: the active page link has aria-current and the others do not.
 */
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";
import type { SettingsTarget } from "./settings-pages.ts";

export interface SettingsNavProps {
	active: SettingsTarget;
	repos: { id: string; name: string }[];
	onNavigate: (target: SettingsTarget) => void;
	onBack: () => void;
	searchSlot: ReactNode;
}

export function SettingsNav(_props: SettingsNavProps): never {
	return notImplemented("SET-02");
}
