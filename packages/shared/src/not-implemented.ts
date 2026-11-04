/**
 * The one placeholder used across the scaffold.
 *
 * Every unbuilt body calls `notImplemented("<feature id>")`. The id must exist in
 * docs/plans/backlog.md. `pnpm stubs` lists all remaining calls and fails when an id
 * is unknown, so no placeholder can hide.
 */
export class NotImplemented extends Error {
	override readonly name = "NotImplemented";

	constructor(readonly featureId: string) {
		super(`Not implemented: ${featureId}`);
	}
}

export function notImplemented(featureId: string): never {
	throw new NotImplemented(featureId);
}
