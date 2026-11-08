/**
 * @feature APP-17 Import from Conductor: the screen's view of the import
 * Owns: `useConductorImport`, the import service's state for the Settings row, its dialog and the
 * first-run offer.
 * Behaviour: core/hooks.ts states the contract; the import service's store holds the state.
 * Must handle: a state not looked at yet (found is undefined), a dry run or an import running, and
 * a failure with its message.
 * Test first: the dialog shows the dry run's counts and imports when the user goes ahead.
 */
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";

export const useConductorImport: Queries["useConductorImport"] = () =>
	useStore(useServices().services.conductorImport.store, (state) => state);
