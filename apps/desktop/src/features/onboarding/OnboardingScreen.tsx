/**
 * @feature APP-02 First-run onboarding
 * Owns: The first-run screen: a short welcome, a check of which agents are installed, and adding
 * the first project.
 * Behaviour: ui-map.md 7.1 (first run at /first-run-onboarding: three selectable steps with title
 * and text, 'Exit onboarding' top right, 'Continue' (Enter), down arrow cycles; on finish it stores
 * the onboarding state and goes to '/'; error 'Couldn't finish setup. Please try again.').
 * Measured from Conductor 0.92.1 (renderApp @10584451 to 10588205): a centred two-column layout, the
 * steps (560px at most) beside a 600px 16:9 media panel with a 4px progress bar under it; each step is a
 * title, medium in the body colour when current and muted otherwise, with its text under it; Continue
 * under the steps. The titles and texts are Conductor's.
 * Our design choice: Conductor plays three videos, which are its assets (D002); we draw a static
 * illustration per step in our own SVG instead. Ours also keep the agent check (step 2) and adding a
 * project (step 3): each shows under the step list, above Continue, while its step is current, so it
 * reads as part of Conductor's left column (D098). There is no welcome line, step count or note under
 * Continue, as Conductor's screen has none (D098).
 * Must handle: Exit at any step (the state is stored so the guide is not shown again); no agent found
 * (the agents step explains how to install one and the user may continue); a project already exists
 * (the screen can be left from any step); finishing fails (a toast, and the step stays); Enter
 * continues, ArrowDown moves to the next step; the window title area stays draggable (from FullPage).
 * Test first: Exiting stores the onboarding state and navigates to '/'; Continue advances one step.
 */
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActions, useSetting } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { toast } from "../../ui/Toast.tsx";
import { AgentStep } from "./AgentStep.tsx";
import { ProjectStep } from "./ProjectStep.tsx";

interface OnboardingStep {
	title: string;
	body: string;
}

/** Conductor's three slides, in its words; "Conducted" where the app names itself. */
const STEPS: OnboardingStep[] = [
	{
		title: "Get coding agents working in parallel",
		body: "Each agent you spin up gets an isolated workspace.",
	},
	{
		title: "See at a glance what each agent is working on",
		body: "See who's working, what needs attention, and what's planned.",
	},
	{
		title: "Review changes and create PRs",
		body: "Review, comment, and merge from Conducted.",
	},
];

const FINISHED_STEP = STEPS.length;

/** The step to open at, clamped so a stored value can never point past the list. */
function startingStep(stored: number): number {
	const value = Number.isFinite(stored) ? Math.trunc(stored) : 0;
	return Math.min(Math.max(value, 0), STEPS.length - 1);
}

/** A keystroke inside a field belongs to the field, not to the guide. */
function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** Enter on a focused control activates that control instead of continuing the guide. */
function isControl(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return target.closest("button, a, [role='button'], input, textarea, select") !== null;
}

/** A static illustration per step. Our own drawing; Conductor plays videos (D002). */
function StepIllustration({ step }: { step: number }) {
	return (
		<div aria-hidden="true" className="flex h-full w-full items-center justify-center p-10">
			<svg
				viewBox="0 0 320 240"
				fill="none"
				data-step={step}
				className="w-full max-w-sm text-fg-muted"
			>
				<title>Onboarding illustration</title>
				{step === 0 ? (
					<>
						<rect
							x="24"
							y="44"
							width="84"
							height="152"
							rx="8"
							stroke="currentColor"
							strokeWidth="2"
						/>
						<rect
							x="118"
							y="24"
							width="84"
							height="192"
							rx="8"
							stroke="currentColor"
							strokeWidth="2"
						/>
						<rect
							x="212"
							y="66"
							width="84"
							height="108"
							rx="8"
							stroke="currentColor"
							strokeWidth="2"
						/>
						{[68, 92, 116].map((y) => (
							<g key={y}>
								<circle cx="42" cy={y} r="4" fill="currentColor" />
								<rect x="54" y={y - 2} width="38" height="4" rx="2" fill="currentColor" />
							</g>
						))}
						{[48, 72, 96, 120, 144].map((y) => (
							<g key={y}>
								<circle cx="136" cy={y} r="4" fill="currentColor" />
								<rect x="148" y={y - 2} width="38" height="4" rx="2" fill="currentColor" />
							</g>
						))}
						{[90, 114, 138].map((y) => (
							<g key={y}>
								<circle cx="230" cy={y} r="4" fill="currentColor" />
								<rect x="242" y={y - 2} width="38" height="4" rx="2" fill="currentColor" />
							</g>
						))}
					</>
				) : null}
				{step === 1 ? (
					<>
						<rect
							x="36"
							y="28"
							width="248"
							height="184"
							rx="10"
							stroke="currentColor"
							strokeWidth="2"
						/>
						{[56, 92, 128, 164].map((y, index) => (
							<g key={y}>
								<circle cx="64" cy={y} r="10" stroke="currentColor" strokeWidth="2" />
								{index < 3 ? (
									<path
										d={`M59 ${y}l4 4 7-8`}
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								) : null}
								<rect x="88" y={y - 8} width="118" height="6" rx="3" fill="currentColor" />
								<rect
									x="88"
									y={y + 2}
									width="72"
									height="5"
									rx="2.5"
									fill="currentColor"
									opacity="0.5"
								/>
							</g>
						))}
					</>
				) : null}
				{step === 2 ? (
					<>
						<path
							d="M40 68h72l20 24v104a10 10 0 0 1-10 10H50a10 10 0 0 1-10-10V78a10 10 0 0 1 10-10Z"
							stroke="currentColor"
							strokeWidth="2"
						/>
						<path d="M112 68v24h20" stroke="currentColor" strokeWidth="2" />
						<rect x="168" y="72" width="112" height="16" rx="8" fill="currentColor" opacity="0.3" />
						<rect
							x="168"
							y="104"
							width="112"
							height="16"
							rx="8"
							fill="currentColor"
							opacity="0.5"
						/>
						<rect x="168" y="136" width="76" height="16" rx="8" fill="currentColor" />
						<path
							d="M176 188l16 16 32-36"
							stroke="currentColor"
							strokeWidth="3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</>
				) : null}
			</svg>
		</div>
	);
}

export function OnboardingScreen() {
	const actions = useActions();
	const navigate = useNavigate();
	const stored = useSetting<number>("onboarding_step");
	const [step, setStep] = useState(() => startingStep(stored));
	const [finishing, setFinishing] = useState(false);
	const leaving = useRef(false);

	const finish = useCallback(async () => {
		if (leaving.current) return;
		leaving.current = true;
		setFinishing(true);
		const saved = await actions.settings.set("onboarding_step", FINISHED_STEP);
		if (!saved.ok) {
			leaving.current = false;
			setFinishing(false);
			toast.error("Couldn't finish setup. Please try again.", {
				description: saved.error.message,
			});
			return;
		}
		await navigate({ to: "/" });
	}, [actions, navigate]);

	const advance = useCallback(() => {
		if (step < STEPS.length - 1) {
			setStep(step + 1);
			return;
		}
		void finish();
	}, [finish, step]);

	// A stored finished state means the guide was left before; do not show it again. A finish in
	// progress navigates on its own, so the store update does not navigate a second time.
	useEffect(() => {
		if (!leaving.current && stored >= FINISHED_STEP) void navigate({ to: "/" });
	}, [navigate, stored]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || isEditable(event.target)) return;
			if (event.key === "Enter") {
				if (isControl(event.target)) return;
				event.preventDefault();
				advance();
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setStep((current) => (current + 1) % STEPS.length);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [advance]);

	return (
		<div
			data-testid="onboarding-setup-scene"
			className="relative flex h-full flex-col items-center overflow-y-auto bg-canvas px-8 pt-8 pb-24"
		>
			<div className="flex w-full max-w-7xl items-center justify-end gap-4">
				<Button variant="ghost" size="sm" onClick={() => void finish()}>
					Exit onboarding
				</Button>
			</div>
			<div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start justify-center gap-12 pt-16 lg:grid-cols-[minmax(0,560px)_600px]">
				<div className="flex w-full min-w-0 flex-col gap-12">
					<div className="flex flex-col gap-6">
						<ol className="flex flex-col gap-6">
							{STEPS.map((item, index) => (
								<li key={item.title}>
									<button
										type="button"
										aria-current={index === step ? "step" : undefined}
										onClick={() => setStep(index)}
										className="flex w-full flex-col items-start gap-1 rounded-md text-left"
									>
										<span
											className={
												index === step
													? "text-base font-medium text-fg"
													: "text-base text-fg-muted hover:text-fg"
											}
										>
											{item.title}
										</span>
										<span className="text-sm text-fg-muted">{item.body}</span>
									</button>
								</li>
							))}
						</ol>
					</div>

					{step === 1 ? <AgentStep /> : null}
					{step === 2 ? <ProjectStep onFinish={() => void finish()} /> : null}

					<div className="flex flex-col items-start gap-3">
						<Button loading={finishing} onClick={advance} className="w-min">
							Continue
						</Button>
					</div>
				</div>

				<div className="hidden w-[600px] flex-col gap-2 lg:flex">
					<div className="aspect-video overflow-hidden rounded-lg bg-muted">
						<StepIllustration step={step} />
					</div>
					<div className="h-1 w-full rounded-full bg-muted">
						<div
							className="h-1 rounded-full bg-fg transition-all duration-500 ease-linear"
							style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
