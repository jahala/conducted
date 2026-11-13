/**
 * @feature PRJ-05 Repository icon
 * Owns: the browser check that an uploaded repository icon is drawn at icon size in a real
 * canvas: PNG, JPEG, WebP and SVG at most 128 pixels square and centred, a small image never
 * enlarged, an image over the pixel limit refused, and bytes that are no image refused.
 * Behaviour: Conductor's upload (renderApp `UWa` @11289680, "Conductor resizes it to icon size").
 * jsdom has no canvas, so the unit tests cover only where the image sits (icon-image.test.ts) and
 * script the drawing; this check runs the drawing the app runs.
 * Our design choice: the check loads `apps/desktop/src/platform/icon-image.ts` from the catalogue's
 * own Vite server into Chromium and makes each input image in the page's own canvas.
 * Test first: a 300 x 150 PNG comes back as a 128 x 128 PNG whose middle row is filled and whose
 * top row is clear.
 *
 * Usage: bun scripts/catalogue/icon-resize.browser.ts
 * It uses the Chromium already in Playwright's cache, downloads nothing, and exits 1 when a case
 * fails.
 */
import { type Browser, chromium } from "playwright-core";
import { startServer, stopServer } from "./shots.ts";

/** Catches a page that never settles. It is not a way to wait. */
const HANG_MS = 60_000;

/** What one case found, as the page reports it. */
interface Drawn {
	ok: boolean;
	code?: string;
	width?: number;
	height?: number;
	/** Alpha of the pixel in the middle of the square, and of the one at the middle of its top row. */
	middleAlpha?: number;
	topAlpha?: number;
}

/**
 * Runs in the page: makes the input, draws it with the app's module, and reads the output back.
 * A string, so the runner's own transpiler never rewrites the dynamic import.
 */
const RUN_CASE = `async ({ kind, width, height }) => {
	const { drawIconPng } = await import("/src/platform/icon-image.ts");
	const make = async () => {
		if (kind === "garbage") return { bytes: new TextEncoder().encode("not an image"), type: "image/png" };
		if (kind === "svg") {
			const text = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="#c00"/></svg>';
			return { bytes: new TextEncoder().encode(text), type: "image/svg+xml" };
		}
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		context.fillStyle = "#c00";
		context.fillRect(0, 0, width, height);
		const type = kind === "jpeg" ? "image/jpeg" : kind === "webp" ? "image/webp" : "image/png";
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, type));
		return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
	};
	const input = await make();
	const drawn = await drawIconPng(input.bytes, input.type);
	if (!drawn.ok) return { ok: false, code: drawn.error.code };
	const bitmap = await createImageBitmap(new Blob([drawn.value], { type: "image/png" }));
	const canvas = document.createElement("canvas");
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext("2d");
	context.drawImage(bitmap, 0, 0);
	const alpha = (x, y) => context.getImageData(x, y, 1, 1).data[3];
	const middle = Math.floor(bitmap.width / 2);
	return {
		ok: true,
		width: bitmap.width,
		height: bitmap.height,
		middleAlpha: alpha(middle, Math.floor(bitmap.height / 2)),
		topAlpha: alpha(middle, 0),
	};
}`;

interface Case {
	name: string;
	input: { kind: "png" | "jpeg" | "webp" | "svg" | "garbage"; width: number; height: number };
	pass: (drawn: Drawn) => boolean;
}

const square = (side: number) => (drawn: Drawn) =>
	drawn.ok && drawn.width === side && drawn.height === side;

const CASES: readonly Case[] = [
	{
		name: "draws a 300 x 150 PNG on a 128 square, centred, the bands above and below it clear",
		input: { kind: "png", width: 300, height: 150 },
		pass: (drawn) => square(128)(drawn) && drawn.middleAlpha === 255 && drawn.topAlpha === 0,
	},
	{
		name: "draws a tall JPEG on a 128 square",
		input: { kind: "jpeg", width: 400, height: 1000 },
		pass: (drawn) => square(128)(drawn) && drawn.middleAlpha === 255,
	},
	{
		name: "draws a WebP on a 128 square",
		input: { kind: "webp", width: 512, height: 512 },
		pass: (drawn) => square(128)(drawn) && drawn.topAlpha === 255,
	},
	{
		name: "draws an SVG on a 128 square",
		input: { kind: "svg", width: 200, height: 100 },
		pass: (drawn) => square(128)(drawn) && drawn.middleAlpha === 255 && drawn.topAlpha === 0,
	},
	{
		name: "keeps a 64 x 32 PNG at its own size on a 64 square, never enlarged",
		input: { kind: "png", width: 64, height: 32 },
		pass: (drawn) => square(64)(drawn) && drawn.middleAlpha === 255 && drawn.topAlpha === 0,
	},
	{
		name: "refuses an image over 10,000 pixels on a side",
		input: { kind: "png", width: 10_001, height: 2 },
		pass: (drawn) => !drawn.ok && drawn.code === "icon_image_too_large",
	},
	{
		name: "refuses bytes that are not an image",
		input: { kind: "garbage", width: 0, height: 0 },
		pass: (drawn) => !drawn.ok && drawn.code === "icon_image_failed",
	},
];

async function main(): Promise<number> {
	const server = startServer();
	let browser: Browser | null = null;
	let failed = 0;
	try {
		const url = await server.url;
		browser = await chromium.launch();
		const page = await browser.newPage();
		// Any page of the server: the module is loaded from its origin.
		await page.goto(url, { timeout: HANG_MS });
		for (const testCase of CASES) {
			const drawn = (await page.evaluate(
				`(${RUN_CASE})(${JSON.stringify(testCase.input)})`,
			)) as Drawn;
			const pass = testCase.pass(drawn);
			if (!pass) failed += 1;
			console.log(
				`${pass ? "ok  " : "FAIL"} ${testCase.name}${pass ? "" : `: ${JSON.stringify(drawn)}`}`,
			);
		}
		await page.close();
	} finally {
		if (browser !== null) await browser.close();
		await stopServer(server.child);
	}
	return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
	main().then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error);
			process.exit(1);
		},
	);
}
