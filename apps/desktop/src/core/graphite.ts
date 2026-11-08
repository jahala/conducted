/**
 * @feature PR-08 Graphite stack view
 * Owns: the branch shape the Changes tab reads and the rule that finds the stack a checked-out
 * branch belongs to. These are the pure parts of the Graphite service; reading `gt state` stays
 * with the service.
 * Behaviour: services-map.md 3.8.1 (the Changes tab lists the checked-out branch's stack).
 */
export interface GraphiteBranch {
	name: string;
	trunk: boolean;
	needsRestack: boolean;
	parentBranch: string | null;
}

/** The Graphite stack a checked-out branch belongs to, as the Changes tab lists it. */
export interface GraphiteStack {
	/** True for a branch Graphite tracks that is not a trunk and has at least one other branch in its stack. */
	isInStack: boolean;
	/** The stack's branches, its top first and the trunk last. Empty when `isInStack` is false. */
	branches: readonly GraphiteBranch[];
}

const NO_STACK: GraphiteStack = { isInStack: false, branches: [] };

/**
 * Orders branches so each one comes before its parent: a walk down from each trunk, children in
 * the order Graphite printed them, read backwards. Branches whose parents name each other have no
 * root, so each such loop is walked from its highest branch not yet listed.
 */
function topFirst(branches: readonly GraphiteBranch[]): GraphiteBranch[] {
	const byName = new Map(branches.map((entry) => [entry.name, entry]));
	const children = new Map<string, GraphiteBranch[]>();
	const roots: GraphiteBranch[] = [];
	for (const entry of branches) {
		const parent =
			entry.parentBranch !== null && entry.parentBranch !== entry.name
				? byName.get(entry.parentBranch)
				: undefined;
		if (parent === undefined) roots.push(entry);
		else children.set(parent.name, [...(children.get(parent.name) ?? []), entry]);
	}
	const listed = new Set<string>();
	const order: GraphiteBranch[] = [];
	const walk = (start: GraphiteBranch): void => {
		const pending = [start];
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			if (listed.has(next.name)) continue;
			listed.add(next.name);
			order.push(next);
			const below = children.get(next.name) ?? [];
			for (let index = below.length - 1; index >= 0; index -= 1) {
				const child = below[index];
				if (child !== undefined) pending.push(child);
			}
		}
	};
	for (const root of roots.filter((entry) => entry.trunk)) walk(root);
	for (const root of roots.filter((entry) => !entry.trunk)) walk(root);
	for (const entry of branches) {
		if (listed.has(entry.name)) continue;
		let start = entry;
		const seen = new Set([start.name]);
		for (;;) {
			const parent = start.parentBranch === null ? undefined : byName.get(start.parentBranch);
			if (parent === undefined || listed.has(parent.name) || seen.has(parent.name)) break;
			seen.add(parent.name);
			start = parent;
		}
		walk(start);
	}
	return order.reverse();
}

/**
 * The stack of `currentBranch`: its parents down to the trunk and every branch built on it, top
 * first. Other stacks on the same trunk, and siblings of its parents, are left out
 * (services-map.md 3.8.1; Conductor's Changes tab lists the same set).
 */
export function graphiteStackOf(
	branches: readonly GraphiteBranch[],
	currentBranch: string,
): GraphiteStack {
	const byName = new Map(branches.map((entry) => [entry.name, entry]));
	const current = byName.get(currentBranch);
	if (current === undefined || current.trunk) return NO_STACK;

	const lineage = new Set<string>();
	for (
		let at: GraphiteBranch | undefined = current;
		at !== undefined && !lineage.has(at.name);
		at = at.parentBranch === null ? undefined : byName.get(at.parentBranch)
	) {
		lineage.add(at.name);
	}
	const above = new Set([currentBranch]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const entry of branches) {
			if (above.has(entry.name) || entry.parentBranch === null) continue;
			if (!above.has(entry.parentBranch)) continue;
			above.add(entry.name);
			grew = true;
		}
	}
	const members = topFirst(branches).filter(
		(entry) => lineage.has(entry.name) || above.has(entry.name),
	);
	return members.length > 1 ? { isInStack: true, branches: members } : NO_STACK;
}
