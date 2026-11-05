import { describe, expect, it } from "vitest";
import { appShellGroupId, centreMinSize, sidebarSize } from "./layout-sizes.ts";

describe("NAV-01 panel sizes", () => {
	it("keeps Conductor's sidebar widths and its collapse to zero", () => {
		expect(sidebarSize.default).toBe("256px");
		expect(sidebarSize.min).toBe("192px");
		expect(sidebarSize.max).toBe("480px");
		expect(sidebarSize.collapsed).toBe("0px");
	});

	it("keeps the centre panel wide enough to use", () => {
		expect(centreMinSize).toBe("480px");
	});

	it("names the shell group for its saved layout", () => {
		expect(appShellGroupId).toBe("app-shell");
	});
});
