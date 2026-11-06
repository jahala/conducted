/**
 * @feature RUN-05 Annotation overlay
 * Owns: tests for pointing at a page element in the preview, writing a note, the numbered list,
 * Escape, the unavailable page, removing and clearing, the disabled chat action, the one message
 * "Add to chat" sends, rebinding after a navigation, the outdated marker in that message, the id
 * a remounted overlay gives a new annotation, and the one element-text cap.
 * Test first: two annotations produce one chat message listing both in order.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationOverlay } from "./AnnotationOverlay.tsx";
import { MAX_ELEMENT_TEXT, type PageAnnotation } from "./annotation-format.ts";

afterEach(cleanup);

const annotation = (partial: Partial<PageAnnotation> = {}): PageAnnotation => ({
	id: partial.id ?? "annotation-1",
	url: partial.url ?? "http://localhost:5173/pricing",
	selector: partial.selector ?? "#buy-button",
	elementText: partial.elementText ?? "Buy now",
	note: partial.note ?? "The button is too small.",
	stillMatches: partial.stillMatches ?? true,
});

function withFrame(children: ReactNode) {
	return (
		<>
			<iframe title="Preview" />
			{children}
		</>
	);
}

/** The preview starts blank in jsdom; give it a button the way a loaded page does. */
async function frameWithButton(): Promise<HTMLIFrameElement> {
	const frame = screen.getByTitle("Preview") as HTMLIFrameElement;
	await waitFor(() => expect(frame.contentDocument?.body).toBeTruthy());
	const page = frame.contentDocument;
	if (page === null) throw new Error("the preview is not scriptable");
	page.body.innerHTML = '<button id="buy">Buy now</button>';
	return frame;
}

/** A real owner of the annotations list, so saving, removing and clearing are seen in the UI. */
function Harness({
	onAdd,
	onSend,
	initial = [],
}: {
	onAdd?: (annotation: PageAnnotation) => void;
	onSend?: (message: string) => void;
	initial?: PageAnnotation[];
}) {
	const [annotations, setAnnotations] = useState<PageAnnotation[]>(initial);
	return (
		<AnnotationOverlay
			annotations={annotations}
			canSendToChat
			onAdd={(item) => {
				onAdd?.(item);
				setAnnotations((current) => [...current, item]);
			}}
			onRemove={(id) => setAnnotations((current) => current.filter((item) => item.id !== id))}
			onSendToChat={(message) => onSend?.(message)}
			onClear={() => setAnnotations([])}
		/>
	);
}

describe("RUN-05 annotation overlay", () => {
	it("two annotations produce one chat message listing both in order", () => {
		const onSendToChat = vi.fn();
		const first = annotation({ id: "a", note: "First note", selector: "#first" });
		const second = annotation({ id: "b", note: "Second note", selector: "#second" });
		render(
			<AnnotationOverlay
				annotations={[first, second]}
				canSendToChat
				onAdd={() => {}}
				onRemove={() => {}}
				onSendToChat={onSendToChat}
				onClear={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

		expect(onSendToChat).toHaveBeenCalledOnce();
		const message = onSendToChat.mock.calls[0]?.[0] as string;
		expect(message.indexOf("First note")).toBeLessThan(message.indexOf("Second note"));
		expect(message.split("http://localhost:5173/pricing")).toHaveLength(2);
	});

	it("picks an element, takes a note, and lists it", async () => {
		const onAdd = vi.fn();
		render(withFrame(<Harness onAdd={onAdd} />));

		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const frame = await frameWithButton();
		const button = frame.contentDocument?.querySelector("#buy");
		if (button === null || button === undefined) throw new Error("the preview has no button");
		fireEvent.click(button);
		fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Make it bigger" } });
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));

		await screen.findByText("Make it bigger");
		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				selector: "#buy",
				elementText: "Buy now",
				note: "Make it bigger",
				stillMatches: true,
			}),
		);
	});

	it("leaves the page alone while annotating is off", async () => {
		render(withFrame(<Harness />));

		const frame = await frameWithButton();
		const button = frame.contentDocument?.querySelector("#buy");
		if (button === null || button === undefined) throw new Error("the preview has no button");
		fireEvent.click(button);

		expect(screen.queryByLabelText("Note")).toBeNull();
	});

	it("Escape cancels the note being written", async () => {
		render(withFrame(<Harness />));

		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const frame = await frameWithButton();
		const button = frame.contentDocument?.querySelector("#buy");
		if (button === null || button === undefined) throw new Error("the preview has no button");
		fireEvent.click(button);
		expect(screen.getByLabelText("Note")).toBeTruthy();

		fireEvent.keyDown(window, { key: "Escape" });

		expect(screen.queryByLabelText("Note")).toBeNull();
		expect(screen.queryByText("#buy")).toBeNull();
	});

	it("says annotations are unavailable when the page cannot be scripted", async () => {
		render(withFrame(<Harness />));
		const frame = await frameWithButton();
		Object.defineProperty(frame, "contentDocument", { value: null, configurable: true });

		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));

		expect(await screen.findByText("Annotations aren't available for this page.")).toBeTruthy();
	});

	it("keeps an annotation and marks it outdated once its element is gone", async () => {
		render(withFrame(<Harness />));

		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const frame = await frameWithButton();
		const button = frame.contentDocument?.querySelector("#buy");
		if (button === null || button === undefined) throw new Error("the preview has no button");
		fireEvent.click(button);
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
		await screen.findByText("#buy");

		const page = frame.contentDocument;
		if (page === null) throw new Error("the preview is not scriptable");
		page.body.innerHTML = "<p>The page changed.</p>";
		fireEvent.load(frame);

		expect(await screen.findByText("Outdated")).toBeTruthy();
		expect(screen.getByText("#buy")).toBeTruthy();
	});

	it("removes one annotation and clears the rest", () => {
		const items = [annotation({ id: "a", note: "First" }), annotation({ id: "b", note: "Second" })];
		render(<Harness initial={items} />);

		fireEvent.click(screen.getByRole("button", { name: "Remove annotation 1" }));
		expect(screen.queryByText("First")).toBeNull();
		expect(screen.getByText("Second")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		expect(screen.queryByText("Second")).toBeNull();
	});

	it("numbers every annotation when the list is long", () => {
		const items = Array.from({ length: 30 }, (_, index) =>
			annotation({ id: `a${index}`, note: `Note ${index + 1}` }),
		);
		render(
			<AnnotationOverlay
				annotations={items}
				canSendToChat
				onAdd={() => {}}
				onRemove={() => {}}
				onSendToChat={() => {}}
				onClear={() => {}}
			/>,
		);

		expect(screen.getAllByRole("listitem")).toHaveLength(30);
		expect(screen.getAllByText("30")).toHaveLength(2);
	});

	it("disables Add to chat and says why when no chat can take it", () => {
		render(
			<AnnotationOverlay
				annotations={[annotation()]}
				canSendToChat={false}
				onAdd={() => {}}
				onRemove={() => {}}
				onSendToChat={() => {}}
				onClear={() => {}}
			/>,
		);

		expect(screen.getByRole("button", { name: "Add to chat" })).toHaveProperty("disabled", true);
		expect(screen.getByText("Open a chat to add annotations.")).toBeTruthy();
	});

	it("shows an annotation the overlay already knows is outdated", () => {
		render(
			<AnnotationOverlay
				annotations={[annotation({ stillMatches: false })]}
				canSendToChat
				onAdd={() => {}}
				onRemove={() => {}}
				onSendToChat={() => {}}
				onClear={() => {}}
			/>,
		);

		expect(screen.getByText("Outdated")).toBeTruthy();
	});

	it("rebinds the picker and the outdated check to a new document after navigation", async () => {
		const onAdd = vi.fn();
		const replacement = document.createElement("iframe");
		document.body.appendChild(replacement);
		try {
			render(
				withFrame(
					<Harness
						onAdd={onAdd}
						initial={[annotation({ id: "old", selector: "#buy", url: "", note: "Old" })]}
					/>,
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
			const frame = await frameWithButton();

			await waitFor(() => expect(replacement.contentDocument?.body).toBeTruthy());
			const next = replacement.contentDocument;
			if (next === null) throw new Error("the new page is not scriptable");
			next.body.innerHTML = '<button id="next">Next</button>';
			Object.defineProperty(frame, "contentDocument", { value: next, configurable: true });
			Object.defineProperty(frame, "contentWindow", {
				value: replacement.contentWindow,
				configurable: true,
			});
			fireEvent.load(frame);

			// The old annotation's element is gone from the new document.
			expect(await screen.findByText("Outdated")).toBeTruthy();

			const button = next.querySelector("#next");
			if (button === null) throw new Error("the new page has no button");
			fireEvent.click(button);
			fireEvent.change(screen.getByLabelText("Note"), { target: { value: "After navigation" } });
			fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));

			await screen.findByText("After navigation");
			expect(onAdd).toHaveBeenCalledWith(
				expect.objectContaining({ selector: "#next", elementText: "Next" }),
			);
		} finally {
			replacement.remove();
		}
	});

	it("tells the agent when an annotation's element is gone", async () => {
		const onSend = vi.fn();
		render(withFrame(<Harness onSend={onSend} />));
		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const frame = await frameWithButton();
		const button = frame.contentDocument?.querySelector("#buy");
		if (button === null || button === undefined) throw new Error("the preview has no button");
		fireEvent.click(button);
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
		await screen.findByText("#buy");

		const page = frame.contentDocument;
		if (page === null) throw new Error("the preview is not scriptable");
		page.body.innerHTML = "<p>The page changed.</p>";
		fireEvent.load(frame);
		await screen.findByText("Outdated");

		fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

		expect(onSend).toHaveBeenCalledOnce();
		const message = onSend.mock.calls[0]?.[0] as string;
		expect(message).toContain("The element was not found again after the page changed.");
	});

	it("gives a new annotation a fresh id after the overlay remounts", async () => {
		const first = vi.fn();
		const mounted = render(withFrame(<Harness onAdd={first} />));
		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const frame = await frameWithButton();
		const button = frame.contentDocument?.querySelector("#buy");
		if (button === null || button === undefined) throw new Error("the preview has no button");
		fireEvent.click(button);
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
		await screen.findByText("#buy");
		const firstId = (first.mock.calls[0]?.[0] as PageAnnotation).id;
		mounted.unmount();

		const second = vi.fn();
		render(
			withFrame(
				<Harness
					onAdd={second}
					initial={[
						annotation({ id: firstId, selector: "#buy", url: "", note: "First" }),
					]}
				/>,
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const reloadedFrame = await frameWithButton();
		const reloadedButton = reloadedFrame.contentDocument?.querySelector("#buy");
		if (reloadedButton === null || reloadedButton === undefined) {
			throw new Error("the reloaded preview has no button");
		}
		fireEvent.click(reloadedButton);
		fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Second" } });
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
		await screen.findByText("Second");

		const secondId = (second.mock.calls[0]?.[0] as PageAnnotation).id;
		expect(secondId).not.toBe(firstId);
	});

	it("cuts the element text to the one shared cap", async () => {
		const onAdd = vi.fn();
		render(withFrame(<Harness onAdd={onAdd} />));
		fireEvent.click(screen.getByRole("button", { name: "Annotate" }));
		const frame = await frameWithButton();
		const page = frame.contentDocument;
		if (page === null) throw new Error("the preview is not scriptable");
		page.body.innerHTML = `<p id="long">${"x".repeat(MAX_ELEMENT_TEXT + 50)}</p>`;
		fireEvent.load(frame);
		const long = page.querySelector("#long");
		if (long === null) throw new Error("the preview has no long element");
		fireEvent.click(long);
		fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));

		await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
		const saved = onAdd.mock.calls[0]?.[0] as PageAnnotation;
		expect(saved.elementText).toHaveLength(MAX_ELEMENT_TEXT);
	});
});
