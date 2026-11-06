import { describe, expect, it } from "bun:test";
import { encodeRings } from "./land-outline.ts";

describe("land outline", () => {
	it("rounds each point to a tenth of a degree and drops repeats", () => {
		const square = [
			[0.04, 0.04],
			[10.01, 0],
			[10.02, 0.01],
			[10, 10],
			[0, 10],
			[0, 0],
		];
		const rings = encodeRings({
			features: [{ geometry: { type: "Polygon", coordinates: [square] } }],
		});
		expect(rings).toEqual(["0.0 0.0,10.0 0.0,10.0 10.0,0.0 10.0,0.0 0.0"]);
	});

	it("leaves out a ring with too few points to enclose anything", () => {
		const rings = encodeRings({
			features: [
				{
					geometry: {
						type: "MultiPolygon",
						coordinates: [
							[
								[
									[0, 0],
									[0.01, 0.01],
									[0, 0],
								],
							],
						],
					},
				},
			],
		});
		expect(rings).toEqual([]);
	});
});
