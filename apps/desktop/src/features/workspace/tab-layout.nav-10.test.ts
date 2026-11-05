/**
 * @feature NAV-10 Tab layout model
 * Owns: the tests for the pure tab tree: closing, moving, splitting, pruning and removing a group.
 * Test first: closeTab on the middle of three tabs makes the third tab active.
 */
import { describe, expect, it } from "vitest";
import {
	activeTabOf,
	applyTabAction,
	closeGroup,
	emptyLayout,
	findTabGroup,
	listGroups,
	pruneLayout,
	type TabDescriptor,
	type TabGroup,
} from "./tab-layout.ts";

const tab = (ref: string, title = ref): TabDescriptor => ({
	kind: "session",
	ref,
	title,
	sessionId: ref as TabDescriptor["sessionId"],
});

const withTabs = (refs: string[]): TabGroup => ({
	kind: "group",
	id: "group-main",
	tabs: refs.map((ref) => tab(ref)),
	activeRef: refs[0] ?? null,
});

const splitOff = (ref: string) =>
	applyTabAction({
		layout: withTabs(["one", "two"]),
		action: { type: "split", ref, groupId: "group-main", edge: "right" },
	});

describe("NAV-10 tab layout", () => {
	it("makes the third tab active when the middle of three closes", () => {
		const layout = withTabs(["one", "two", "three"]);
		const active = { ...layout, activeRef: "two" };
		const closed = applyTabAction({ layout: active, action: { type: "close", ref: "two" } });
		expect(closed.kind).toBe("group");
		if (closed.kind !== "group") return;
		expect(closed.tabs.map((item) => item.ref)).toEqual(["one", "three"]);
		expect(closed.activeRef).toBe("three");
	});

	it("picks the left neighbour when the last tab closes", () => {
		const layout = { ...withTabs(["one", "two", "three"]), activeRef: "three" };
		const closed = applyTabAction({ layout, action: { type: "close", ref: "three" } });
		expect(closed.kind === "group" && closed.activeRef).toBe("two");
	});

	it("splits the dragged tab into its own group on the right edge", () => {
		const layout = applyTabAction({
			layout: withTabs(["one", "two"]),
			action: { type: "split", ref: "two", groupId: "group-main", edge: "right" },
		});
		expect(layout.kind).toBe("split");
		if (layout.kind !== "split") return;
		expect(layout.direction).toBe("row");
		expect(listGroups(layout)).toHaveLength(2);
		const dragged = listGroups(layout).find((group) => group.tabs.some((tab) => tab.ref === "two"));
		expect(dragged?.tabs.map((tab) => tab.ref)).toEqual(["two"]);
		expect(dragged?.activeRef).toBe("two");
	});

	it("splits above and to the left when the edge says so", () => {
		const above = applyTabAction({
			layout: withTabs(["one", "two"]),
			action: { type: "split", ref: "two", groupId: "group-main", edge: "top" },
		});
		expect(above.kind === "split" && above.direction).toBe("column");
		expect(listGroups(above)[0]?.tabs.map((tab) => tab.ref)).toEqual(["two"]);

		const left = applyTabAction({
			layout: withTabs(["one", "two"]),
			action: { type: "split", ref: "two", groupId: "group-main", edge: "left" },
		});
		expect(left.kind === "split" && left.direction).toBe("row");
		expect(listGroups(left)[0]?.tabs.map((tab) => tab.ref)).toEqual(["two"]);
	});

	it("refuses to split a group that holds one tab", () => {
		const layout = withTabs(["one"]);
		expect(
			applyTabAction({
				layout,
				action: { type: "split", ref: "one", groupId: "group-main", edge: "right" },
			}),
		).toBe(layout);
	});

	it("reorders a tab within its own group and makes it active", () => {
		const layout = { ...withTabs(["one", "two", "three"]), activeRef: "one" };
		const moved = applyTabAction({
			layout,
			action: { type: "move", ref: "one", toGroupId: "group-main", index: 2 },
		});
		expect(moved.kind).toBe("group");
		if (moved.kind !== "group") return;
		expect(moved.tabs.map((tab) => tab.ref)).toEqual(["two", "three", "one"]);
		expect(moved.activeRef).toBe("one");
	});

	it("moves a tab into another group, leaving one home for it", () => {
		const split = splitOff("two");
		const target = listGroups(split).find((group) => !group.tabs.some((tab) => tab.ref === "two"));
		expect(target).toBeDefined();
		if (target === undefined) return;
		const moved = applyTabAction({
			layout: split,
			action: { type: "move", ref: "two", toGroupId: target.id, index: 0 },
		});
		const holders = listGroups(moved).filter((group) =>
			group.tabs.some((tab) => tab.ref === "two"),
		);
		expect(holders).toHaveLength(1);
	});

	it("closing the last tab of a group removes the group and keeps the neighbour", () => {
		const split = splitOff("two");
		const closed = applyTabAction({ layout: split, action: { type: "close", ref: "two" } });
		expect(closed.kind).toBe("group");
		expect(listGroups(closed)).toHaveLength(1);
	});

	it("removes a split group without closing the tabs it shows", () => {
		const split = splitOff("two");
		const splitGroup = listGroups(split).find((group) => group.id !== "group-main");
		expect(splitGroup).toBeDefined();
		if (splitGroup === undefined) return;
		const closed = closeGroup(split, splitGroup.id);
		expect(listGroups(closed)).toHaveLength(1);
		expect(closed).not.toBe(split);
		expect(closeGroup(split, "group-main")).toBe(split);
	});

	it("prunes a tab that no longer exists from a split group", () => {
		const split = splitOff("two");
		const pruned = pruneLayout(split, new Set(["one"]));
		expect(listGroups(pruned)).toHaveLength(1);
		expect(listGroups(pruned)[0]?.tabs.map((tab) => tab.ref)).toEqual(["one"]);
	});

	it("keeps a tab whose ref is still live in its split group", () => {
		const file: TabDescriptor = { kind: "file", ref: "file:a.ts", title: "a.ts" };
		const layout = applyTabAction({
			layout: { kind: "group", id: "group-main", tabs: [tab("one"), file], activeRef: "one" },
			action: { type: "split", ref: file.ref, groupId: "group-main", edge: "right" },
		});
		const pruned = pruneLayout(layout, new Set(["one", "file:a.ts"]));
		const groups = listGroups(pruned);
		expect(groups).toHaveLength(2);
		expect(activeTabOf(groups[1] as TabGroup)?.ref).toBe("file:a.ts");
	});

	it("changing nothing returns the same tree", () => {
		const layout = withTabs(["one"]);
		expect(applyTabAction({ layout, action: { type: "close", ref: "missing" } })).toBe(layout);
	});

	it("builds an empty main group", () => {
		expect(emptyLayout()).toEqual({
			kind: "group",
			id: "group-main",
			tabs: [],
			activeRef: null,
		});
		expect(findTabGroup(emptyLayout(), "missing")).toBeNull();
	});
});
