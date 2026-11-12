/**
 * @feature catalogue States of a Codex chat's goal bar
 * Owns: a Codex chat in arbor whose thread goal Codex reports as pursued (with a token budget),
 * paused, blocked, stopped by the usage limit and stopped by its budget; the goal bar's edit field;
 * and the two failures the bar reports: an empty goal and a change that could not be sent.
 * Behaviour: ui-map.md 3.3 (Codex goal bar above the composer); features/composer/GoalBar.tsx
 * names each status. A completed goal hides the bar, so it has no state.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { CodexGoal, SessionConfig } from "@conducted/protocol";
import { chatRoute, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, has, shows, typeInto } from "../dom.ts";
import { addChat, addEvents, CLAUDE_CONFIG, must } from "../seeds.ts";
import type { AfterContext, CatalogueState } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
import type { World } from "../world.ts";

const CODEX_CONFIG: SessionConfig = { ...CLAUDE_CONFIG, agent: "codex", model: "gpt-5.5" };

const OBJECTIVE = "Every page of the dashboard loads in under one second on the largest account.";

const goalState = (
	status: CodexGoal["status"],
	label: string,
	title: string,
	budget: Pick<CodexGoal, "tokenBudget" | "tokensUsed"> = {},
): CatalogueState => ({
	id: `composer-goal-${status.replace("_", "-")}`,
	group: "Composer",
	title,
	seed: async (world) => {
		const cast = await seedCast(world);
		const chat = await addChat(world, cast.arbor, {
			title: "Speed up the dashboard",
			config: CODEX_CONFIG,
		});
		const talk = conversation(`goal-${status}`, CATALOGUE_NOW - 30 * MINUTE);
		const turn = talk.user("Keep working until every dashboard page loads in under a second.", {
			config: CODEX_CONFIG,
		});
		talk.text(turn, "I set that as the goal and started with the slowest page, Invoices.");
		talk.end(turn);
		await addEvents(world, chat.id, talk.events);
		// The finished turn started a Codex thread; the goal belongs to it.
		must(await world.repositories.sessions.setAgentSessionId(chat.id, `thr-goal-${status}`));
		world.answerSidecar({ getGoal: () => ({ goal: { objective: OBJECTIVE, status, ...budget } }) });
		return {
			route: chatRoute(cast.arbor, chat),
			after: ({ app }) => refreshGit(app, cast.arbor),
			ready: (document) => shows(document, label),
		};
	},
});

/** A state over the pursued goal with a token budget, then `then`. */
const editingGoal = (
	id: string,
	title: string,
	then: (context: AfterContext) => Promise<void>,
	ready: (document: Document) => boolean,
	prepare?: (world: World) => void,
): CatalogueState => ({
	id,
	group: "Composer",
	title,
	seed: async (world) => {
		prepare?.(world);
		const cast = await seedCast(world);
		const chat = await addChat(world, cast.arbor, {
			title: "Speed up the dashboard",
			config: CODEX_CONFIG,
		});
		const talk = conversation("goal-edit", CATALOGUE_NOW - 30 * MINUTE);
		const turn = talk.user("Keep working until every dashboard page loads in under a second.", {
			config: CODEX_CONFIG,
		});
		talk.text(turn, "I set that as the goal and started with the slowest page, Invoices.");
		talk.end(turn);
		await addEvents(world, chat.id, talk.events);
		must(await world.repositories.sessions.setAgentSessionId(chat.id, "thr-goal-edit"));
		world.answerSidecar({
			getGoal: () => ({
				goal: {
					objective: OBJECTIVE,
					status: "active",
					tokenBudget: 500_000,
					tokensUsed: 184_000,
				},
			}),
		});
		return {
			route: chatRoute(cast.arbor, chat),
			after: async (context) => {
				await refreshGit(context.app, cast.arbor);
				await then(context);
			},
			ready,
		};
	},
});

export const GOAL_STATES: CatalogueState[] = [
	goalState("active", "Pursuing goal", "Codex goal being pursued, with a token budget", {
		tokenBudget: 500_000,
		tokensUsed: 184_000,
	}),
	goalState("paused", "Paused goal", "Codex goal paused"),
	goalState("blocked", "Blocked goal", "Codex goal blocked"),
	goalState("usage_limited", "Usage-limited goal", "Codex goal stopped by the usage limit"),
	goalState("budget_limited", "Budget-limited goal", "Codex goal stopped by its token budget", {
		tokenBudget: 500_000,
		tokensUsed: 500_000,
	}),
	editingGoal(
		"composer-goal-editing",
		"Codex goal bar with its edit field open",
		async ({ document }) => {
			await click(document, "button", "Edit goal");
		},
		(document) => has(document, "button", "Save goal"),
	),
	editingGoal(
		"composer-goal-empty",
		"Codex goal bar after saving an empty goal",
		async ({ document }) => {
			await click(document, "button", "Edit goal");
			await typeInto(document, "textarea", "Goal", "");
			await click(document, "button", "Save goal");
		},
		(document) => shows(document, "Enter a goal first."),
	),
	editingGoal(
		"composer-goal-update-error",
		"Codex goal bar after a change that could not be sent",
		async ({ document }) => {
			await click(document, "button", "Pause goal");
		},
		(document) => shows(document, "Failed to update goal."),
		(world) => world.failSidecar("sendMessage"),
	),
];
