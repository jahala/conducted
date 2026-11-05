/**
 * @feature NAV-04 Workspace drag and drop
 * Owns: tests for the drag state, the drop to an action mapping, Escape, and the two lists' drop
 * behaviour.
 * Test first: Dropping row A after row B in manual order calls the order action with A after B
 * and not before.
 */
import {
	appError,
	err,
	ok,
	type Result,
	type SectionId,
	type WorkspaceId,
} from "@conducted/shared";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceDrag } from "./use-workspace-drag.ts";

afterEach(cleanup);

const id = (value: string) => value as WorkspaceId;

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe("NAV-04 useWorkspaceDrag", () => {
	it("calls the order action with the dragged row after the row it was dropped on", async () => {
		const reorder = vi.fn(async () => ok(undefined));
		const { result } = renderHook(() =>
			useWorkspaceDrag({
				order: [id("a"), id("b"), id("c")],
				manualOrder: true,
				reorder,
			}),
		);
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("row:b", 1));
		await vi.waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
		expect(reorder).toHaveBeenCalledWith([id("b"), id("a"), id("c")]);
	});

	it("puts the row before the target when the drop position says so", async () => {
		const reorder = vi.fn(async () => ok(undefined));
		const { result } = renderHook(() =>
			useWorkspaceDrag({
				order: [id("a"), id("b"), id("c")],
				manualOrder: true,
				reorder,
			}),
		);
		act(() => result.current.startDrag(id("c")));
		act(() => result.current.dropOn("row:a", 0));
		await vi.waitFor(() => expect(reorder).toHaveBeenCalledWith([id("c"), id("a"), id("b")]));
	});

	it("does not reorder when manual order is off", () => {
		const reorder = vi.fn(async () => ok(undefined));
		const { result } = renderHook(() => useWorkspaceDrag({ order: [id("a"), id("b")], reorder }));
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("row:b", 1));
		expect(reorder).not.toHaveBeenCalled();
	});

	it("pins a workspace dropped on Pinned", async () => {
		const pin = vi.fn(async () => ok(undefined));
		const { result } = renderHook(() => useWorkspaceDrag({ pin }));
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("pinned", 0));
		await vi.waitFor(() => expect(pin).toHaveBeenCalledWith(id("a")));
	});

	it("places a workspace into a section or back in the main list", async () => {
		const place = vi.fn(async () => ok(undefined));
		const { result } = renderHook(() => useWorkspaceDrag({ place }));
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("section:s1", 2));
		await vi.waitFor(() => expect(place).toHaveBeenCalledWith(id("a"), "s1" as SectionId, 2));
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("main", 0));
		await vi.waitFor(() => expect(place).toHaveBeenCalledWith(id("a"), null, 0));
	});

	it("changes nothing when a drop lands outside a target", () => {
		const pin = vi.fn(async () => ok(undefined));
		const place = vi.fn(async () => ok(undefined));
		const { result } = renderHook(() => useWorkspaceDrag({ pin, place }));
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("somewhere-else", 0));
		expect(pin).not.toHaveBeenCalled();
		expect(place).not.toHaveBeenCalled();
	});

	it("reports only the newest drop's failure", async () => {
		const older = deferred<Result<unknown>>();
		const newer = deferred<Result<unknown>>();
		const place = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
		const onError = vi.fn();
		const { result } = renderHook(() => useWorkspaceDrag({ place, onError }));
		act(() => result.current.startDrag(id("a")));
		act(() => result.current.dropOn("section:s1", 0));
		act(() => result.current.startDrag(id("b")));
		act(() => result.current.dropOn("section:s1", 0));
		act(() => newer.resolve(err(appError("db", "The newer failure."))));
		await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
		act(() => older.resolve(err(appError("db", "The older failure."))));
		await Promise.resolve();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(
			"Couldn't move workspace",
			expect.objectContaining({ message: "The newer failure." }),
		);
	});

	it("cancels with Escape and removes the grabbing style", () => {
		const { result } = renderHook(() => useWorkspaceDrag());
		act(() => result.current.startDrag(id("a")));
		expect(document.querySelector("style[data-workspace-drag]")).not.toBeNull();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(result.current.state.draggingId).toBeNull();
		expect(document.querySelector("style[data-workspace-drag]")).toBeNull();
	});
});
