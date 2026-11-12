/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: reading and changing one form control in the real window the way a person does: a switch,
 * a drop-down, a radio group, a slider, a text or number field and a text area, found inside a
 * scope (a setting's row, or the control itself).
 * Behaviour: the app's controls (ui/Switch.tsx, ui/Select.tsx, ui/Input.tsx) and the setting row's
 * save rules (features/settings/SettingRow.tsx: a field saves when it loses focus).
 * Must handle: a control that is disabled (reported with the row's reason, never changed); a
 * drop-down whose options open in a portal; a value the app refuses (its row shows an alert, which
 * fails the change); a number field with a minimum and a maximum.
 * Our design choice: a change picks the next value the control offers (the switch's other side,
 * the first option not chosen, the first radio not checked, the slider one step along with the
 * arrow keys), so a new control needs no new code.
 * Text needs a value; it is `e2e-<name>` unless the caller passes one the app accepts.
 * Test first: moves a number one up, or one down at its maximum.
 */
import { type Browser, HANG_MS, until } from "./harness.ts";

/** Every element that holds a value a person sets. */
export const CONTROL =
	'[role="switch"], [role="combobox"], [role="slider"], input:not([type="hidden"]), textarea, [role="radiogroup"]';

export type ControlKind = "switch" | "select" | "radio" | "slider" | "number" | "text" | "textarea";

export interface ControlReading {
	kind: ControlKind | "other";
	/** What the control shows: on or off, the chosen label, the checked radio, or the text. */
	value: string;
	disabled: boolean;
	/** The row's save error or refusal, when it shows one. */
	alert: string | null;
	/** The text that explains a disabled control, when the row has one. */
	note: string;
	min: string | null;
	max: string | null;
}

/** Reads the first control inside `scope` (or `scope` itself), in the page. Null when absent. */
export async function readControl(browser: Browser, scope: string): Promise<ControlReading | null> {
	return await browser.execute(
		(scopeSelector: string, controlSelector: string) => {
			const root = document.querySelector(scopeSelector);
			if (root === null) return null;
			const control = root.matches(controlSelector) ? root : root.querySelector(controlSelector);
			if (control === null) return null;
			const disabled =
				(control as HTMLInputElement).disabled === true ||
				control.getAttribute("aria-disabled") === "true" ||
				control.closest("fieldset[disabled]") !== null;
			const alert = root.querySelector('[role="alert"]')?.textContent?.trim() ?? null;
			const note = root.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "";
			const role = control.getAttribute("role");
			const base = { disabled, alert, note, min: null, max: null };
			if (role === "switch") {
				return { ...base, kind: "switch", value: control.getAttribute("aria-checked") ?? "" };
			}
			if (role === "slider") {
				return {
					...base,
					kind: "slider",
					value: control.getAttribute("aria-valuenow") ?? "",
					min: control.getAttribute("aria-valuemin"),
					max: control.getAttribute("aria-valuemax"),
				};
			}
			if (role === "combobox" && control.tagName !== "INPUT") {
				return { ...base, kind: "select", value: control.textContent?.trim() ?? "" };
			}
			const radios = [
				...(role === "radiogroup" ? control : root).querySelectorAll('input[type="radio"]'),
			] as HTMLInputElement[];
			if (role === "radiogroup" || (control as HTMLInputElement).type === "radio") {
				const checked = radios.find((radio) => radio.checked);
				return { ...base, kind: "radio", value: checked?.value ?? "" };
			}
			if (control instanceof HTMLTextAreaElement) {
				return { ...base, kind: "textarea", value: control.value };
			}
			if (control instanceof HTMLInputElement) {
				return {
					...base,
					kind: control.type === "number" ? "number" : "text",
					value: control.value,
					min: control.getAttribute("min"),
					max: control.getAttribute("max"),
				};
			}
			return { ...base, kind: "other", value: control.textContent?.trim() ?? "" };
		},
		scope,
		CONTROL,
	);
}

/** The value a number field moves to: one up, or one down at its maximum. */
export function nextNumber(current: string, min: string | null, max: string | null): string {
	const value = Number(current === "" ? (min ?? "0") : current);
	const upper = max === null ? Number.POSITIVE_INFINITY : Number(max);
	const lower = min === null ? Number.NEGATIVE_INFINITY : Number(min);
	const up = value + 1;
	if (up <= upper) return String(up);
	const down = value - 1;
	return String(down >= lower ? down : value);
}

async function first(browser: Browser, selector: string): Promise<WebdriverIO.Element> {
	return await until(`${selector} on the page`, async () => {
		const found = await browser.$$(selector);
		return found.length > 0 ? found[0] : undefined;
	});
}

/** Moves focus out of a field the way Tab does, so the field saves (it saves on blur). */
async function leaveField(browser: Browser): Promise<void> {
	await browser.keys("Tab");
}

/**
 * Changes the control inside `scope` to its next value. `text` is the value a text field gets.
 * Returns the reading after the change, once the control shows the new value.
 */
export async function changeControl(
	browser: Browser,
	scope: string,
	text: string,
): Promise<ControlReading> {
	const before = await readControl(browser, scope);
	if (before === null) throw new Error(`no control in ${scope}`);
	if (before.disabled) throw new Error(`the control is disabled: ${before.note}`);
	// The scope is the control itself, or the row that holds it.
	const isControl = await browser.execute(
		(scopeSelector: string, controlSelector: string) =>
			document.querySelector(scopeSelector)?.matches(controlSelector) === true,
		scope,
		CONTROL,
	);
	const element = await first(browser, isControl ? scope : `${scope} :is(${CONTROL})`);
	let wanted: string | null = null;
	switch (before.kind) {
		case "switch":
			await element.click();
			wanted = before.value === "true" ? "false" : "true";
			break;
		case "select": {
			await element.click();
			// The option is picked and marked in one step in the page: the open list can draw its
			// options again between two driver calls, which leaves an element handle stale.
			const picked = await until("a drop-down option not chosen", async () => {
				const label = await browser.execute(() => {
					const options = [
						...document.querySelectorAll(
							'[role="listbox"] [role="option"]:not([aria-selected="true"]):not([data-disabled])',
						),
					];
					// An option whose label ends in an ellipsis asks for more input before it holds a
					// value ("Custom..."), so a plain value is chosen when there is one.
					const option =
						options.find((item) => !/(\.\.\.|…)$/.test(item.textContent?.trim() ?? "")) ??
						options[0];
					if (option === undefined) return null;
					option.setAttribute("data-e2e-pick", "");
					return option.textContent?.trim() ?? "";
				});
				return label ?? undefined;
			});
			wanted = picked;
			await (await first(browser, "[data-e2e-pick]")).click();
			break;
		}
		case "radio": {
			const radios = await browser.$$(`${scope} input[type="radio"]`);
			for (const radio of radios) {
				if (!(await radio.isSelected())) {
					wanted = await radio.getAttribute("value");
					await radio.click();
					break;
				}
			}
			if (wanted === null) throw new Error("every radio is already checked");
			break;
		}
		case "slider": {
			wanted = nextNumber(before.value, before.min, before.max);
			await element.click();
			await browser.keys(Number(wanted) > Number(before.value) ? "ArrowRight" : "ArrowLeft");
			break;
		}
		case "number":
			wanted = nextNumber(before.value, before.min, before.max);
			await element.click();
			await element.clearValue();
			await element.addValue(wanted);
			await leaveField(browser);
			break;
		case "text":
		case "textarea":
			wanted = before.value === text ? `${text}-2` : text;
			await element.click();
			await element.clearValue();
			await element.addValue(wanted);
			await leaveField(browser);
			break;
		default:
			throw new Error(`no way to change a control that shows "${before.value}"`);
	}
	const target = wanted;
	return await until(
		`the control to show "${target}"`,
		async () => {
			const after = await readControl(browser, scope);
			if (after?.alert) throw new Error(`the app refused the value: ${after.alert}`);
			return after !== null && after.value === target ? after : undefined;
		},
		HANG_MS / 4,
	);
}
