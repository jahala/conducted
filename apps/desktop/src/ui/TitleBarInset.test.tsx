import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TitleBarInset } from "./TitleBarInset.tsx";

afterEach(cleanup);

describe("NAV-01 title bar inset", () => {
	it("renders an aria-hidden element whose width reads var(--shell-left-inset, 0px)", () => {
		const { container } = render(<TitleBarInset />);
		const inset = container.firstElementChild;

		expect(inset).not.toBeNull();
		expect(inset?.getAttribute("aria-hidden")).toBe("true");
		expect(inset?.className).toContain("w-[var(--shell-left-inset,0px)]");
		expect(inset?.className).toContain("shrink-0");
	});
});
