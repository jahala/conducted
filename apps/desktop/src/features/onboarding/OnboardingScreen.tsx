/**
 * @feature APP-02 First-run onboarding
 * Owns: The first-run screen: a short welcome, a check of which agents are installed, and adding
 * the first project.
 * Behaviour: ui-map.md 7.1 (first run at /first-run-onboarding: three selectable steps with title
 * and text, 'Exit onboarding' top right, 'Continue' (Enter), down arrow cycles; on finish it stores
 * the onboarding state and goes to '/'; error 'Couldn't finish setup. Please try again.').
 * Our design choice: Conductor plays three videos. We draw a static illustration per step in our own
 * SVG. The steps are what the app does, which agents were found, and adding a project. The accent is
 * on Continue only.
 * Must handle: Exit at any step (the state is stored so the guide is not shown again); no agent found
 * (the agents step explains how to install one and the user may continue); a project already exists
 * (the screen can be left from any step); finishing fails (a toast, and the step stays); Enter
 * continues, ArrowDown moves to the next step; the window title area stays draggable.
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

const STEPS: OnboardingStep[] = [
	{
		title: "Get coding agents working in parallel",
		body: "Give each task its own workspace, and let several agents work at once.",
	},
	{
		title: "See which agents are ready",
		body: "We checked the agent programs on this Mac. Sign in to one now, or later in Settings.",
	},
	{
		title: "Add your first project",
		body: "Pick a folder to add as a project, then start a workspace from it.",
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

	// A stored finished state means the guide was left before; do not show it again.
	useEffect(() => {
		if (stored >= FINISHED_STEP) void navigate({ to: "/" });
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

	const active = STEPS[step] ?? STEPS[0];

	return (
		<div className="flex h-full bg-canvas">
			<section className="flex min-w-0 flex-1 flex-col px-8 py-6 lg:px-12">
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-fg-muted">Welcome to Conducted</p>
					<Button variant="ghost" size="sm" onClick={() => void finish()}>
						Exit onboarding
					</Button>
				</div>

				<div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-7 py-8">
					<div>
						<p className="text-xs tracking-wider text-fg-muted uppercase">
							Step {step + 1} of {STEPS.length}
						</p>
						<h1 className="mt-1 text-2xl font-medium text-fg">{active?.title}</h1>
						<p className="mt-2 text-sm text-fg-muted">{active?.body}</p>
					</div>

					<ol aria-label="Onboarding steps" className="flex flex-col gap-2">
						{STEPS.map((item, index) => (
							<li key={item.title}>
								<button
									type="button"
									aria-current={index === step ? "step" : undefined}
									onClick={() => setStep(index)}
									className={
										index === step
											? "flex w-full items-start gap-3 rounded-md border border-border-strong bg-raised p-3 text-left"
											: "flex w-full items-start gap-3 rounded-md border border-transparent p-3 text-left hover:bg-hover"
									}
								>
									<span
										aria-hidden="true"
										className={
											index === step
												? "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-fill text-xs font-medium text-canvas"
												: "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-medium text-fg-muted"
										}
									>
										{index + 1}
									</span>
									<span className="min-w-0">
										<span className="block text-sm font-medium text-fg">{item.title}</span>
										<span className="mt-1 block text-xs text-fg-muted">{item.body}</span>
									</span>
								</button>
							</li>
						))}
					</ol>

					{step === 1 ? <AgentStep /> : null}
					{step === 2 ? <ProjectStep onFinish={() => void finish()} /> : null}
				</div>

				<div className="flex items-center justify-between gap-4">
					<p className="text-xs text-fg-subtle">You can change these later in Settings.</p>
					<Button loading={finishing} onClick={advance}>
						Continue
					</Button>
				</div>
			</section>

			<aside className="hidden w-[45%] border-l border-border bg-surface md:flex">
				<StepIllustration step={step} />
			</aside>
		</div>
	);
}
