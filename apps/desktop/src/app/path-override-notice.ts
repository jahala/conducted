/**
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: the notice that a program path chosen in Advanced settings could not be used, so the
 * terminal or script that just opened runs the bundled program instead.
 * Behaviour: services-map.md 5A.8.2 (staging the chosen paths can fail; Conductor then uses the
 * plain bundled prefix).
 * Must handle: no problem (no notice); a second failure (the stable id replaces the notice instead
 * of stacking); staging that works again (nothing more is shown).
 * Our design choice: Conductor only logs the failure. We show it, because a terminal that silently
 * runs another program than the one the user chose is a silent failure.
 * Test first: a failed staging shows "Your chosen program path can't be used" with the reason.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { useServices } from "../core/context.tsx";
import { toast } from "../ui/Toast.tsx";

export const PATH_OVERRIDE_NOTICE_TITLE = "Your chosen program path can't be used";

/** Mount once at the app root. Renders nothing; the notice is a toast. */
export function PathOverrideNotice(): null {
	const system = useServices().services.system;
	const problem = useStore(system.store, (state) => state.pathOverrideProblem);

	useEffect(() => {
		if (problem === null) return;
		toast.error(PATH_OVERRIDE_NOTICE_TITLE, {
			id: "path-override-problem",
			description: `${problem.message} Terminals and scripts use the bundled program until you fix the path in Settings, Advanced.`,
		});
	}, [problem]);

	return null;
}
