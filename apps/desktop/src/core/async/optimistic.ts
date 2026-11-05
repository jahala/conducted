/**
 * @feature APP-11 Optimistic overlay with rollback
 * Owns: showing the result of an action at once, then replacing it with the real result, or dropping it when
 * the action fails. One small helper that every service store can use.
 * Behaviour: services-map.md 1.3 and 2.5.3 (a base class holds a canonical store and a derived store;
 * `run({optimisticUpdate, action, scheduler})` registers the update, recomputes the derived state by
 * folding the updates over the canonical state, runs the action, then replaces the canonical state with the
 * action's result and drops the update; a cancelled action throws AbortError; used by the workspace and
 * repository services).
 * Our design choice: failure is a value. The action returns a `Result`; on `ok: false` the overlay is
 * dropped and the error is returned, and nothing throws. Several overlays can be pending at once; each
 * is dropped by its own id, so one failing action does not undo another's update. Ids come from an
 * `IdSource` and time is not needed.
 * Must handle: two overlays pending, the first failing (the second stays); an action that succeeds after a
 * newer canonical state arrived from a push (the newer state is kept and the overlay is dropped);
 * an update that throws (a programmer error: the run stops before the action starts and nothing is
 * applied); an action that never ends (the overlay stays until the caller's timeout drops it); the
 * derived state being computed again from canonical state plus overlays, never patched in place.
 * Test first: with an overlay that renames a workspace and an action that fails, the derived state shows
 * the new name while the action runs and the old name after it fails; the Result carries the error.
 */
import { type IdSource, notImplemented, type Result } from "@conducted/shared";

export interface OptimisticRun<S, R> {
	/** Applied on top of the canonical state while the action runs. Must be pure. */
	update: (state: S) => S;
	/** Does the real work and returns the new canonical state, or the failure. */
	action: () => Promise<Result<S, R>>;
}

export interface OptimisticStore<S> {
	/** The canonical state with every pending overlay applied. */
	read(): S;
	/** The state as the source of truth knows it. */
	canonical(): S;
	/** Replaces the canonical state, for example from a push. Pending overlays stay on top. */
	setCanonical(next: S): void;
	run<R>(input: OptimisticRun<S, R>): Promise<Result<S, R>>;
	subscribe(listener: () => void): () => void;
}

export function createOptimisticStore<S>(_initial: S, _ids: IdSource): OptimisticStore<S> {
	return notImplemented("APP-11");
}
