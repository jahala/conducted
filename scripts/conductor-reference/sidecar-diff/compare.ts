/**
 * The in-order comparison of two normalised traces (normalise.ts) for the sidecar differential run.
 *
 * `alignTraces` lines the two lists up by their longest common subsequence, so an item one sidecar
 * sends and the other does not shows as one difference, and the items both send stay matched even
 * when the extra item sits between them. Each row of the alignment is "both", "conductor" (only
 * Conductor's sidecar sent it) or "ours". `differences` counts the rows that are not "both".
 */

export interface AlignedRow {
	in: "both" | "conductor" | "ours";
	item: string;
}

export interface Alignment {
	rows: AlignedRow[];
	differences: number;
}

export function alignTraces(conductor: readonly string[], ours: readonly string[]): Alignment {
	const n = conductor.length;
	const m = ours.length;
	const width = m + 1;
	// common[i * width + j]: the length of the longest common subsequence of conductor[i..] and ours[j..].
	const common = new Int32Array((n + 1) * width);
	const at = (i: number, j: number) => common[i * width + j] ?? 0;
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			common[i * width + j] =
				conductor[i] === ours[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
	const rows: AlignedRow[] = [];
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		const left = conductor[i];
		const right = ours[j];
		if (left !== undefined && left === right) {
			rows.push({ in: "both", item: left });
			i++;
			j++;
		} else if (left !== undefined && (right === undefined || at(i + 1, j) >= at(i, j + 1))) {
			rows.push({ in: "conductor", item: left });
			i++;
		} else if (right !== undefined) {
			rows.push({ in: "ours", item: right });
			j++;
		}
	}
	return { rows, differences: rows.filter((row) => row.in !== "both").length };
}
