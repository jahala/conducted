/**
 * @feature DATA-01 Actions: the services behind every mutation screens may call
 * Owns: the one table that connects each entry of the `Actions` contract (api.ts) to the service
 * method that does the work. If a method is missing or has the wrong shape, this file does not
 * compile.
 * Behaviour: services-map.md 1.3 (services behind a facade), api.ts (the contract).
 * Must handle: every action returns a `Result` and never throws for expected failures (the
 * link opener and the folder picker reject when the system refuses; both become an Err); actions
 * that change data go through the services, never through repositories; `saveDraft` returns at
 * once (the composer service debounces the write).
 * Our design choice: plain wrapper functions, no proxies or magic, so a stack trace names the
 * service method.
 * Test first: createActions returns an object with every group named in the Actions interface.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Platform } from "../platform/platform.ts";
import type { Actions } from "./api.ts";
import type { Services } from "./container.ts";

/** Runs a platform call that reports failure by rejecting, and returns the failure as a Result. */
async function settle<T>(code: string, message: string, run: () => Promise<T>): Promise<Result<T>> {
	try {
		return ok(await run());
	} catch (cause) {
		return err(appError(code, message, cause));
	}
}

export function createActions(
	services: Services,
	platform: Pick<Platform, "app" | "opener" | "dialogs">,
): Actions {
	return {
		projects: {
			addLocal: (path) => services.repo.addLocal(path),
			clone: (url, parentDir) => services.repo.clone(url, parentDir),
			createFromTemplate: (name, parentDir, template) =>
				services.repo.createFromTemplate(name, parentDir, template),
			createGitHubRepo: (repoId, input) => services.repo.createGitHubRepo(repoId, input),
			remove: (repoId) => services.repo.remove(repoId),
			setDefaultBranch: (repoId, branch) => services.repo.setDefaultBranch(repoId, branch),
			reorder: (orderedIds) => services.repo.reorder(orderedIds),
			updateConfig: (repoId, config) => services.repo.updateConfig(repoId, config),
			setIcon: (repoId, icon) => services.repo.setIcon(repoId, icon),
			resetRunAction: (repoId, actionId) => services.repo.resetRunAction(repoId, actionId),
			setRunActionHidden: (repoId, actionId, hidden) =>
				services.repo.setRunActionHidden(repoId, actionId, hidden),
		},
		workspaces: {
			create: (input) => services.workspace.create(input),
			archive: (id, options) => services.workspace.archive(id, options),
			unarchive: (id, options) => services.workspace.unarchive(id, options),
			remove: (id) => services.workspace.remove(id),
			restart: (id) => services.workspace.restart(id),
			rename: (id, name) => services.workspace.rename(id, name),
			setPinned: (id, pinned) => services.workspace.setPinned(id, pinned),
			setKanbanStatus: (id, status) => services.workspace.setKanbanStatus(id, status),
			setTargetBranch: (id, branch) => services.git.setTargetBranch(id, branch),
			setLinkedPaths: (id, paths) => services.workspace.setLinkedPaths(id, paths),
			openIn: (id, appName) => services.workspace.openIn(id, appName),
			markRead: (id) => services.sessions.markAllRead(id),
			markUnread: (id) => services.sessions.markWorkspaceUnread(id),
			setActiveSession: (id, sessionId) => services.workspace.setActiveSession(id, sessionId),
			retrySetup: (id) => services.workspace.retrySetup(id),
			recoverPrompt: (id) => services.workspace.recoverPrompt(id),
			addToBacklog: (input) => services.workspace.addToBacklog(input),
			startFromBacklog: (id) => services.workspace.startFromBacklog(id),
			removeFromBacklog: (id) => services.workspace.removeFromBacklog(id),
			setBacklogRepo: (id, repoId) => services.workspace.setBacklogRepo(id, repoId),
		},
		sections: {
			create: (name, emoji) => services.sections.create(name, emoji),
			rename: (id, name, emoji) => services.sections.rename(id, name, emoji),
			remove: (id) => services.sections.remove(id),
			place: (workspaceId, sectionId, position) =>
				services.sections.place(workspaceId, sectionId, position),
			reorder: (orderedIds) => services.sections.reorder(orderedIds),
			setCollapsed: (id, collapsed) => services.sections.setCollapsed(id, collapsed),
		},
		sessions: {
			create: (workspaceId, config) => services.sessions.create(workspaceId, config),
			close: (id) => services.sessions.close(id),
			reopen: (id) => services.sessions.reopen(id),
			rename: (id, title) => services.sessions.rename(id, title),
			send: (id, text, attachmentPaths, delivery) =>
				services.sessions.send(id, text, attachmentPaths, delivery),
			cancel: (id) => services.sessions.cancel(id),
			answer: (id, interactionId, answer) => services.sessions.answer(id, interactionId, answer),
			updateConfig: (id, config) => services.sessions.updateConfig(id, config),
			revertTo: (id, turnId) => services.checkpoint.revertTo(id, turnId),
			forkFrom: (id, turnId) => services.sessions.forkFrom(id, turnId),
			saveDraft: (id, draft) => services.composer.saveDraft(id, draft),
			copyTranscript: (id, detail) => services.sessions.copyTranscript(id, detail),
			startFromPlan: (id, planText, target) =>
				services.sessions.startFromPlan(id, planText, target),
			markRead: (id) => services.sessions.markRead(id),
			markUnread: (id) => services.sessions.markUnread(id),
			retryFailedSend: (id, messageId) => services.sessions.retryFailedSend(id, messageId),
			discardFailedSend: (id, messageId) => services.sessions.discardFailedSend(id, messageId),
			retryInNewChat: (id, turnId) => services.sessions.retryInNewChat(id, turnId),
			restartAgent: (id) => services.sessions.restartAgent(id),
			compact: (id) => services.sessions.compact(id),
			setAutoApproveEdits: (id, enabled) => services.sessions.setAutoApproveEdits(id, enabled),
			setAcpOption: (id, optionId, value) => services.sessions.setAcpOption(id, optionId, value),
			forkToWorkspace: (id, turnId) => services.checkpoint.forkToWorkspace(id, turnId),
			goal: {
				set: (id, objective) => services.sessions.setGoal(id, objective),
				change: (id, action) => services.sessions.changeGoal(id, action),
			},
			queue: {
				edit: (messageId, text) => services.followUpQueue.edit(messageId, text),
				remove: (messageId) => services.followUpQueue.remove(messageId),
				reorder: (sessionId, orderedIds) => services.followUpQueue.reorder(sessionId, orderedIds),
				setPaused: (sessionId, paused) => services.followUpQueue.setPaused(sessionId, paused),
				sendNowAsSteer: (messageId) => services.followUpQueue.sendNowAsSteer(messageId),
				retry: (messageId) => services.followUpQueue.retry(messageId),
			},
		},
		git: {
			commitAndPush: (workspaceId) => services.git.commitAndPush(workspaceId),
			pull: async (workspaceId) => {
				// The Actions contract reports only success; the panel reads the outcome from the
				// service to show its toast.
				const result = await services.git.pull(workspaceId);
				return result.ok ? ok(undefined) : result;
			},
			push: (workspaceId) => services.git.push(workspaceId),
			resolveConflicts: (workspaceId) => services.git.resolveConflicts(workspaceId),
			renameBranch: (workspaceId, name) => services.git.renameBranch(workspaceId, name),
			discardFile: (workspaceId, path) => services.git.discardFile(workspaceId, path),
			setViewed: (workspaceId, path, viewed) => services.git.setViewed(workspaceId, path, viewed),
			switchBranch: (workspaceId, branch) => services.git.switchBranch(workspaceId, branch),
			continueOnNewBranch: (workspaceId, name) =>
				services.git.continueOnNewBranch(workspaceId, name),
			openInDiffTool: (workspaceId, path) => services.git.openInDiffTool(workspaceId, path),
			sparseCheckoutSettings: (workspaceId) => services.git.sparseCheckoutSettings(workspaceId),
			setSparseCheckoutDirectories: (workspaceId, directories) =>
				services.git.setSparseCheckoutDirectories(workspaceId, directories),
		},
		pullRequests: {
			create: (workspaceId, options) => services.github.create(workspaceId, options),
			markReady: (workspaceId) => services.github.markReady(workspaceId),
			merge: (workspaceId) => services.github.merge(workspaceId),
			setAutoMerge: (workspaceId, enabled) => services.github.setAutoMerge(workspaceId, enabled),
			approve: (workspaceId) => services.github.approve(workspaceId),
			fixErrors: (workspaceId) => services.github.fixErrors(workspaceId),
			rerunFailedChecks: (workspaceId) => services.github.rerunFailedChecks(workspaceId),
			updateTitleAndBody: (workspaceId, title, body) =>
				services.github.updateTitleAndBody(workspaceId, title, body),
			requestAiReview: (workspaceId, extra) => services.review.requestAiReview(workspaceId, extra),
			requestReview: (workspaceId, logins) => services.github.requestReview(workspaceId, logins),
			removeReviewRequest: (workspaceId, login) =>
				services.github.removeReviewRequest(workspaceId, login),
			link: (workspaceId, urlOrNumber) => services.github.linkPullRequest(workspaceId, urlOrNumber),
			openOnGithub: (workspaceId) => services.github.openOnGithub(workspaceId),
			syncStack: (workspaceId) => services.github.syncStack(workspaceId),
			mergeStack: (workspaceId) => services.github.mergeStack(workspaceId),
		},
		issues: {
			attachToWorkspace: (workspaceId, issue) =>
				issue.provider === "linear"
					? services.linear.attachToWorkspace(workspaceId, issue.id)
					: services.github.attachIssueToWorkspace(workspaceId, issue),
		},
		comments: {
			add: (workspaceId, file, line, endLine, body, details) =>
				services.review.add(workspaceId, file, line, endLine, body, details),
			edit: (id, body, details) => services.review.edit(id, body, details),
			remove: (id) => services.review.remove(id),
			setResolved: (id, resolved) => services.review.setResolved(id, resolved),
			setHidden: (id, hidden) => services.review.setHidden(id, hidden),
			markAllReady: (workspaceId) => services.review.markAllReady(workspaceId),
			sendToChat: (workspaceId, ids) => services.review.sendToChat(workspaceId, ids),
		},
		run: {
			start: (workspaceId, actionId) => services.runScripts.start(workspaceId, actionId),
			stop: (workspaceId, actionId) => services.runScripts.stop(workspaceId, actionId),
			startSpotlight: (workspaceId) => services.spotlight.start(workspaceId),
			stopSpotlight: (workspaceId) => services.spotlight.stop(workspaceId),
			activateApp: (workspaceId, port) => services.runScripts.activateApp(workspaceId, port),
		},
		terminals: {
			create: (workspaceId, options) => services.terminals.create(workspaceId, options),
			openForRepo: (repoId) => services.terminals.openForRepo(repoId),
			restart: (id) => services.terminals.restart(id),
			runCommand: (workspaceId, command) => services.terminals.runCommand(workspaceId, command),
			close: (id) => services.terminals.close(id),
		},
		files: {
			write: (workspaceId, path, text, expectedModifiedAt) =>
				services.workspaceFiles.saveFile(workspaceId, path, text, expectedModifiedAt),
			attachToChat: (workspaceId, paths) =>
				services.composer.attachFilesToActiveChat(workspaceId, paths),
			open: (workspaceId, path, mode, scope) =>
				services.workspaceFiles.open(workspaceId, path, mode, scope),
			resolveConflicts: (workspaceId, path, choices, seenText) =>
				services.workspaceFiles.resolveConflicts(workspaceId, path, choices, seenText),
			reveal: (workspaceId, path) => services.workspaceFiles.reveal(workspaceId, path),
			revealPath: (path) =>
				settle("reveal_failed", "Finder could not show the file.", () =>
					platform.opener.revealInFinder(path),
				),
			openInApp: (workspaceId, path, appName) =>
				services.workspaceFiles.openInApp(workspaceId, path, appName),
		},
		artifacts: {
			loadMore: (workspaceId) => services.workspaceFiles.loadMoreArtifacts(workspaceId),
			upload: (workspaceId, paths) => services.workspaceFiles.uploadArtifacts(workspaceId, paths),
		},
		mcp: {
			refresh: (sessionId) => services.mcp.refreshSession(sessionId),
		},
		attachments: {
			add: (sessionId, paths) => services.composer.addAttachments(sessionId, paths),
			addChatTranscript: (sessionId, fromSessionId) =>
				services.composer.addChatTranscript(sessionId, fromSessionId),
			addPlan: (sessionId, plan) => services.composer.addPlan(sessionId, plan),
			addTerminalOutput: (sessionId) => services.composer.addTerminalOutput(sessionId),
			addText: (sessionId, fileName, text) => services.composer.addText(sessionId, fileName, text),
			copyImage: (path) => services.system.copyImage(path),
			saveAs: (path) => services.system.saveAs(path),
			openExternally: (path) => services.system.openExternally(path),
		},
		snippets: {
			create: (input) => services.composer.createSnippet(input),
			update: (id, input) => services.composer.updateSnippet(id, input),
			remove: (id) => services.composer.removeSnippet(id),
		},
		settings: {
			set: (key, value) => services.settings.set(key, value),
			setEnvVar: (name, value, scope) => services.settings.setEnvVar(name, value, scope),
			removeEnvVar: (name, scope) => services.settings.removeEnvVar(name, scope),
			resetForRepo: (repoId, key) => services.settings.resetForRepo(repoId, key),
			filePath: (file) => services.settings.filePath(file),
			openFile: (file, appName) => services.settings.openFile(file, appName),
		},
		agents: {
			login: (agent, acpAgent) => services.agentCatalog.login(agent, acpAgent),
			finishLogin: (loginId, code) => services.agentCatalog.finishLogin(loginId, code),
			cancelLogin: (loginId) => services.agentCatalog.cancelLogin(loginId),
			refresh: () => services.agentCatalog.refresh(),
			setProviderKey: (key, value) => services.agentCatalog.setProviderKey(key, value),
			removeProviderKey: (key) => services.agentCatalog.removeProviderKey(key),
			saveConfigFile: (agent, text, expectedModifiedAt) =>
				services.agentCatalog.saveConfigFile(agent, text, expectedModifiedAt),
			syncConfigs: (from, categories) => services.agentCatalog.syncConfigs(from, categories),
		},
		programs: {
			install: (program) => services.system.installProgram(program),
			redownload: (program) => services.system.redownloadProgram(program),
			remove: (program) => services.system.removeProgram(program),
		},
		accounts: {
			setGitHubToken: (token) => services.github.setToken(token),
			setLinearKey: (key) => services.linear.setApiKey(key),
			recheckLinear: () => services.linear.recheckAccess(),
		},
		cloud: {
			pair: (input) => services.cloudPairing.pair(input),
			unpair: () => services.cloudPairing.unpair(),
			deploy: () => services.cloudDeploy.deploy(),
			uninstall: () => services.cloudDeploy.uninstall(),
			saveGitIdentity: (identity) => services.cloudSettings.saveGitIdentity(identity),
			setCloudEnvVar: (name, value) => services.cloudSettings.setEnvVar(name, value),
			removeCloudEnvVar: (name) => services.cloudSettings.removeEnvVar(name),
		},
		portForwards: {
			setForwarding: (workspaceId, enabled) =>
				services.portForwards.setForwarding(workspaceId, enabled),
			setAutoForward: (workspaceId, enabled) =>
				services.portForwards.setAutoForward(workspaceId, enabled),
			add: (workspaceId, remotePort) => services.portForwards.add(workspaceId, remotePort),
			remove: (forwardId) => services.portForwards.remove(forwardId),
			toggle: (forwardId, enabled) => services.portForwards.toggle(forwardId, enabled),
			pauseWorkspace: (workspaceId) => services.portForwards.pauseWorkspace(workspaceId),
			refreshDiscovery: (workspaceId) => services.portForwards.refreshDiscovery(workspaceId),
			previewUrl: (workspaceId, remotePort) =>
				services.portForwards.previewUrl(workspaceId, remotePort),
		},
		app: {
			runCommand: (commandId) => services.commands.run(commandId),
			checkForUpdates: () => services.updates.check(),
			installUpdate: () => services.updates.install(),
			exportLogs: () => platform.app.exportLogs(),
			openUrl: (url) =>
				settle("open_url_failed", "The link could not be opened.", () =>
					platform.opener.openUrl(url),
				),
			pickFolder: (title) =>
				settle("pick_folder_failed", "The folder picker could not be opened.", () =>
					platform.dialogs.pickFolder({ title }),
				),
			pickFile: (title) =>
				settle("pick_file_failed", "The file picker could not be opened.", async () => {
					const [picked] = await platform.dialogs.pickFiles({ title, multiple: false });
					return picked ?? null;
				}),
			recheckGitHubAccess: () => services.github.recheckAccess(),
			createDiagnosticsChat: (workspaceId) => services.sessions.createDiagnosticsChat(workspaceId),
			copyText: (text) => services.system.copyText(text),
			sendFeedback: (input) => services.system.sendFeedback(input),
			openSidecarLogs: () => services.system.openSidecarLogs(),
			openFullDiskAccessSettings: () => services.system.openFullDiskAccessSettings(),
			testCompletionSound: (soundId) => services.notifications.testSound(soundId),
			runXcodeLicenseFix: () => services.system.runXcodeLicenseFix(),
		},
	};
}
