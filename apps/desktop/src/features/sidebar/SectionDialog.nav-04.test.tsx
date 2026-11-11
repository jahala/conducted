/**
 * @feature NAV-04 Section dialog
 * Owns: tests for creating and renaming a section from the dialog.
 * Test first: Submitting 'Review' with no emoji calls sections.create('Review', null).
 */
import { appError, err, ok, type SectionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Section } from "../../core/model.ts";
import { createTestContainer } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { SectionDialog } from "./SectionDialog.tsx";

afterEach(cleanup);

const section: Section = {
	id: "s1" as SectionId,
	name: "Review",
	emoji: null,
	position: 0,
	collapsed: false,
	workspaceIds: [],
};

function renderWith(
	container: ReturnType<typeof createTestContainer>["container"],
	node: ReactNode,
) {
	return render(<ServicesProvider container={container}>{node}</ServicesProvider>);
}

describe("NAV-04 SectionDialog", () => {
	it("submits 'Review' with no emoji as sections.create('Review', null)", async () => {
		const test = createTestContainer();
		try {
			const create = vi
				.spyOn(test.container.actions.sections, "create")
				.mockResolvedValue(ok(section));
			const onOpenChange = vi.fn();
			renderWith(test.container, <SectionDialog open onOpenChange={onOpenChange} section={null} />);
			fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
				target: { value: "Review" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Create" }));
			await waitFor(() => expect(create).toHaveBeenCalledWith("Review", null));
			expect(onOpenChange).toHaveBeenCalledWith(false);
		} finally {
			test.close();
		}
	});

	it("renames a section with its emoji", async () => {
		const test = createTestContainer();
		try {
			const rename = vi
				.spyOn(test.container.actions.sections, "rename")
				.mockResolvedValue(ok(undefined));
			renderWith(test.container, <SectionDialog open onOpenChange={vi.fn()} section={section} />);
			fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
				target: { value: "In review" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Use 📝" }));
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
			await waitFor(() => expect(rename).toHaveBeenCalledWith(section.id, "In review", "📝"));
		} finally {
			test.close();
		}
	});

	it("submits with Enter in the name field", async () => {
		const test = createTestContainer();
		try {
			const create = vi
				.spyOn(test.container.actions.sections, "create")
				.mockResolvedValue(ok(section));
			renderWith(test.container, <SectionDialog open onOpenChange={vi.fn()} section={null} />);
			const field = screen.getByRole("textbox", { name: "Name" });
			fireEvent.change(field, { target: { value: "Review" } });
			fireEvent.keyDown(field, { key: "Enter" });
			await waitFor(() => expect(create).toHaveBeenCalledWith("Review", null));
		} finally {
			test.close();
		}
	});

	it("disables the submit button while the name is empty", () => {
		const test = createTestContainer();
		try {
			renderWith(test.container, <SectionDialog open onOpenChange={vi.fn()} section={null} />);
			expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(
				true,
			);
		} finally {
			test.close();
		}
	});

	it("toasts Conductor's 'Couldn't create section' when a new section fails", async () => {
		const test = createTestContainer();
		try {
			const reported = vi.spyOn(toast, "error").mockImplementation(() => "");
			vi.spyOn(test.container.actions.sections, "create").mockResolvedValue(
				err(appError("db", "The database is locked.")),
			);
			renderWith(test.container, <SectionDialog open onOpenChange={vi.fn()} section={null} />);
			fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
				target: { value: "Review" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Create" }));
			await waitFor(() => expect(reported).toHaveBeenCalledWith("Couldn't create section"));
			reported.mockRestore();
		} finally {
			test.close();
		}
	});

	it("toasts 'Section no longer exists' when the renamed section vanished", async () => {
		const test = createTestContainer();
		try {
			const reported = vi.spyOn(toast, "error").mockImplementation(() => "");
			vi.spyOn(test.container.actions.sections, "rename").mockResolvedValue(
				err(appError("section_unknown", "That section no longer exists.")),
			);
			renderWith(test.container, <SectionDialog open onOpenChange={vi.fn()} section={section} />);
			fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
				target: { value: "In review" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
			await waitFor(() => expect(reported).toHaveBeenCalledWith("Section no longer exists"));
			reported.mockRestore();
		} finally {
			test.close();
		}
	});

	it("keeps the dialog open and shows the failure under the field", async () => {
		const test = createTestContainer();
		try {
			vi.spyOn(test.container.actions.sections, "create").mockResolvedValue(
				err(appError("db", "The database is locked.")),
			);
			const onOpenChange = vi.fn();
			renderWith(test.container, <SectionDialog open onOpenChange={onOpenChange} section={null} />);
			fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
				target: { value: "Review" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Create" }));
			expect(await screen.findByText("The database is locked.")).toBeTruthy();
			expect(onOpenChange).not.toHaveBeenCalledWith(false);
		} finally {
			test.close();
		}
	});
});
