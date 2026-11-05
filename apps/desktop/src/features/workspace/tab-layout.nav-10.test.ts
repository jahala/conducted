/**
 * @feature NAV-10 Tab layout model
 * Owns: the tests for the pure tab tree: closing, moving, splitting and reopening.
 * Test first: closeTab on the middle of three tabs makes the third tab active.
 */
import { describe, expect, it } from "vitest";
import {
	allTabs,
	applyTabAction,
	emptyLayout,
	findTabGroup,
	listGroups,
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

	it("keeps one tab in one group when it is opened again", () => {
		const layout = applyTabAction({
			layout: withTabs(["one"]),
			action: { type: "open", tab: tab("one", "Renamed"), groupId: "group-main" },
		});
		expect(allTabs(layout).filter(({ tab: item }) => item.ref === "one")).toHaveLength(1);
		expect(findTabGroup(layout, "one")?.tabs[0]?.title).toBe("Renamed");
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

	it("refuses to split a group that holds one tab", () => {
		const layout = withTabs(["one"]);
		expect(
			applyTabAction({
				layout,
				action: { type: "split", ref: "one", groupId: "group-main", edge: "right" },
			}),
		).toBe(layout);
	});

	it("moves a tab into another group, leaving one home for it", () => {
		const split = applyTabAction({
			layout: withTabs(["one", "two"]),
			action: { type: "split", ref: "two", groupId: "group-main", edge: "right" },
		});
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
		const split = applyTabAction({
			layout: withTabs(["one", "two"]),
			action: { type: "split", ref: "two", groupId: "group-main", edge: "right" },
		});
		const closed = applyTabAction({ layout: split, action: { type: "close", ref: "two" } });
		expect(closed.kind).toBe("group");
		expect(allTabs(closed).map(({ tab: item }) => item.ref)).toEqual(["one"]);
	});

	it("reopens a closed tab in its group", () => {
		const layout = applyTabAction({
			layout: emptyLayout(),
			action: { type: "open", tab: tab("one"), groupId: "group-main" },
		});
		expect(listGroups(layout)[0]?.activeRef).toBe("one");
	});

	it("changing nothing returns the same tree", () => {
		const layout = withTabs(["one"]);
		expect(applyTabAction({ layout, action: { type: "close", ref: "missing" } })).toBe(layout);
		expect(
			applyTabAction({ layout, action: { type: "activate", groupId: "other", ref: "one" } }),
		).toBe(layout);
	});
});
