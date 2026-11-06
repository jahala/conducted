/**
 * @feature catalogue The index page of the states catalogue
 * Owns: listing every state by group, with its id and a link to open it in light and in dark.
 * Behaviour: docs/plans/parallel-build.md section 2, "a browsable catalogue, so contributors can see
 * every screen without running agents".
 * Must handle: an address that names an unknown state (a notice above the list). Each row carries its
 * state's id, group and title as data attributes, which the screenshot run reads as its list.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { CatalogueState, Theme } from "./state.ts";

const THEMES: readonly Theme[] = ["light", "dark"];

const stateUrl = (id: string, theme: Theme): string =>
	`?${new URLSearchParams({ state: id, theme }).toString()}`;

export function CatalogueIndex({
	states,
	unknownId,
}: {
	states: readonly CatalogueState[];
	unknownId: string | null;
}) {
	const groups = new Map<string, CatalogueState[]>();
	for (const state of states) {
		const list = groups.get(state.group) ?? [];
		list.push(state);
		groups.set(state.group, list);
	}
	return (
		<main className="min-h-screen bg-canvas text-fg">
			<div className="mx-auto max-w-[896px] px-10 py-12">
				<header className="mb-10">
					<p className="font-medium text-fg-muted text-xs uppercase tracking-wide">Conducted</p>
					<h1 className="mt-1 font-semibold text-2xl">States catalogue</h1>
					<p className="mt-2 max-w-[576px] text-fg-muted text-sm">
						{states.length} screen states, drawn by the real app on the in-memory Platform with a
						fixed clock. Nothing here touches a repository, an agent or the network.
					</p>
				</header>
				{unknownId !== null ? (
					<p
						role="alert"
						className="mb-8 rounded-md border border-border-strong bg-surface px-4 py-3 text-sm"
					>
						There is no state called <code className="font-mono">{unknownId}</code>.
					</p>
				) : null}
				{[...groups].map(([group, list]) => (
					<section key={group} className="mb-8">
						<h2 className="mb-2 font-medium text-fg-muted text-xs uppercase tracking-wide">
							{group}
						</h2>
						<ul className="divide-y divide-separator rounded-lg border border-border bg-surface">
							{list.map((state) => (
								<li
									key={state.id}
									data-state-id={state.id}
									data-state-group={state.group}
									data-state-title={state.title}
									className="flex h-11 items-center gap-4 px-4"
								>
									<span className="min-w-0 flex-1 truncate text-sm">{state.title}</span>
									<code className="shrink-0 font-mono text-fg-muted text-xs">{state.id}</code>
									<span className="flex shrink-0 gap-1">
										{THEMES.map((theme) => (
											<a
												key={theme}
												href={stateUrl(state.id, theme)}
												className="rounded-md px-2 py-1 font-medium text-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
											>
												{theme === "light" ? "Light" : "Dark"}
											</a>
										))}
									</span>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</main>
	);
}
