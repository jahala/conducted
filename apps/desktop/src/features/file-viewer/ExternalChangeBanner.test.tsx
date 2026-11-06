/**
 * @feature REV-08 External change banner
 * Tests the two answers to a file that changed on disk.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalChangeBanner } from "./ExternalChangeBanner.tsx";

afterEach(cleanup);

function Harness({ onAnswer }: { onAnswer: (choice: "discard" | "keep") => void }) {
	const [visible, setVisible] = useState(true);
	if (!visible) return null;
	return (
		<ExternalChangeBanner
			kind="changed"
			onDiscardMine={() => {
				onAnswer("discard");
				setVisible(false);
			}}
			onKeepMine={() => {
				onAnswer("keep");
				setVisible(false);
			}}
		/>
	);
}

describe("REV-08 ExternalChangeBanner", () => {
	it("calls Keep mine once and hides until the next change", () => {
		const onAnswer = vi.fn();
		render(<Harness onAnswer={onAnswer} />);
		expect(screen.getByText("File changed on disk")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
		expect(onAnswer).toHaveBeenCalledTimes(1);
		expect(onAnswer).toHaveBeenCalledWith("keep");
		expect(screen.queryByText("File changed on disk")).toBeNull();
	});

	it("calls Discard my edits once", () => {
		const onAnswer = vi.fn();
		render(<Harness onAnswer={onAnswer} />);
		fireEvent.click(screen.getByRole("button", { name: "Discard my edits" }));
		expect(onAnswer).toHaveBeenCalledTimes(1);
		expect(onAnswer).toHaveBeenCalledWith("discard");
	});

	it("uses different words when the file was deleted", () => {
		render(<ExternalChangeBanner kind="deleted" onDiscardMine={() => {}} onKeepMine={() => {}} />);
		expect(screen.getByText("File was deleted on disk")).toBeTruthy();
	});
});
