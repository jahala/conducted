/**
 * @feature AGENT-11 ACP client and runner: string-set comparison
 * Owns: comparing two lists of strings ignoring order.
 * Behaviour: research/conductor/other-runners.md section 2.2: ACP adds additional folders to a
 * session; a change to that list needs a restart.
 * Must handle: different orders and a different length.
 * Test first: ["a", "b"] and ["b", "a"] compare equal.
 * Our design choice: one home for the ACP and Codex sessions, which both restart when that list
 * changes.
 */
export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const a = [...left].sort();
	const b = [...right].sort();
	return a.every((value, index) => value === b[index]);
}
