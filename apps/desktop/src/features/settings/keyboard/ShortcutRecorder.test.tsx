import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutRecorder } from "./ShortcutRecorder.tsx";

afterEach(cleanup);

describe("SET-02 ShortcutRecorder", () => {
	it("records Cmd+Shift+K", () => {
		const onRecord = vi.fn();
		render(<ShortcutRecorder onRecord={onRecord} onCancel={() => undefined} />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Recording shortcut" }), {
			key: "k",
			metaKey: true,
			shiftKey: true,
		});

		expect(onRecord).toHaveBeenCalledWith("Cmd+Shift+K");
	});

	it("waits for a key after a modifier and cancels on Escape", () => {
		const onRecord = vi.fn();
		const onCancel = vi.fn();
		render(<ShortcutRecorder onRecord={onRecord} onCancel={onCancel} />);
		const recorder = screen.getByRole("button", { name: "Recording shortcut" });

		fireEvent.keyDown(recorder, { key: "Shift", shiftKey: true });
		expect(onRecord).not.toHaveBeenCalled();

		fireEvent.keyDown(recorder, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("records a letter and a digit by the physical key when Option or Shift change the character", () => {
		const onRecord = vi.fn();
		render(<ShortcutRecorder onRecord={onRecord} onCancel={() => undefined} />);
		const recorder = screen.getByRole("button", { name: "Recording shortcut" });

		fireEvent.keyDown(recorder, { key: "†", code: "KeyT", metaKey: true, altKey: true });
		fireEvent.keyDown(recorder, { key: "!", code: "Digit1", metaKey: true, shiftKey: true });

		expect(onRecord.mock.calls).toEqual([["Cmd+Alt+T"], ["Cmd+Shift+1"]]);
	});
});
