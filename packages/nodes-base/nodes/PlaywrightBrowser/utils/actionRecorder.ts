import type { ActionMemory, ActionStep } from './actionMemory';
import { ActionMemoryStore, actionMemoryStore } from './actionMemory';
import { browserPool } from './browserPool';

/**
 * Active recording session
 */
interface RecordingSession {
	id: string;
	domain: string;
	goal: string;
	goalPattern: string;
	variables: Record<string, string>;
	actions: ActionStep[];
	startedAt: number;
	sessionId: string;
	pageId: string;
}

/**
 * Manages action recording during workflow execution
 */
class ActionRecorder {
	private static instance: ActionRecorder;
	private activeSessions: Map<string, RecordingSession> = new Map();

	private constructor() {}

	static getInstance(): ActionRecorder {
		if (!ActionRecorder.instance) {
			ActionRecorder.instance = new ActionRecorder();
		}
		return ActionRecorder.instance;
	}

	/**
	 * Start recording a new workflow
	 */
	startRecording(sessionId: string, pageId: string, goal: string, initialUrl?: string): string {
		const recordingId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
		const domain = initialUrl ? ActionMemoryStore.extractDomain(initialUrl) : 'unknown';
		const { pattern, variables } = ActionMemoryStore.createGoalPattern(goal);

		const session: RecordingSession = {
			id: recordingId,
			domain,
			goal,
			goalPattern: pattern,
			variables,
			actions: [],
			startedAt: Date.now(),
			sessionId,
			pageId,
		};

		this.activeSessions.set(recordingId, session);

		return recordingId;
	}

	/**
	 * Record an action step
	 */
	recordAction(recordingId: string, action: Omit<ActionStep, 'recordedAt'>): void {
		const session = this.activeSessions.get(recordingId);
		if (!session) {
			console.warn(`Recording session ${recordingId} not found`);
			return;
		}

		// Update domain if we have a navigate action
		if (action.operation === 'navigate' && action.url) {
			session.domain = ActionMemoryStore.extractDomain(action.url);
		}

		// Generate fallback selectors for the action
		const actionWithFallbacks: ActionStep = {
			...action,
			selectorFallbacks: action.selector ? this.generateFallbackSelectors(action) : undefined,
			recordedAt: Date.now(),
		};

		session.actions.push(actionWithFallbacks);
	}

	/**
	 * Generate alternative selectors for an action
	 */
	private generateFallbackSelectors(action: Omit<ActionStep, 'recordedAt'>): string[] {
		const fallbacks: string[] = [];

		if (!action.selector) return fallbacks;

		// If selector is ID-based, add class-based fallback
		if (action.selector.startsWith('#')) {
			// Can't generate fallback without more context
		}

		// If selector has :has-text, add aria-label fallback
		if (action.selector.includes(':has-text(')) {
			const textMatch = action.selector.match(/:has-text\("([^"]+)"\)/);
			if (textMatch) {
				const text = textMatch[1];
				const tagMatch = action.selector.match(/^(\w+)/);
				const tag = tagMatch ? tagMatch[1] : '*';
				fallbacks.push(`${tag}[aria-label="${text}"]`);
				fallbacks.push(`${tag}:text("${text}")`);
			}
		}

		return fallbacks;
	}

	/**
	 * Stop recording and save the workflow
	 */
	stopRecording(recordingId: string, success: boolean): ActionMemory | null {
		const session = this.activeSessions.get(recordingId);
		if (!session) {
			return null;
		}

		this.activeSessions.delete(recordingId);

		if (!success || session.actions.length === 0) {
			return null;
		}

		const workflow: ActionMemory = {
			id: ActionMemoryStore.generateId(),
			domain: session.domain,
			goalPattern: session.goalPattern,
			originalGoal: session.goal,
			actions: session.actions,
			successCount: 1,
			failCount: 0,
			createdAt: session.startedAt,
			lastUsed: Date.now(),
			lastUpdated: Date.now(),
			variables: session.variables,
		};

		// Save to memory store
		actionMemoryStore.saveWorkflow(workflow);

		return workflow;
	}

	/**
	 * Cancel recording without saving
	 */
	cancelRecording(recordingId: string): void {
		this.activeSessions.delete(recordingId);
	}

	/**
	 * Get current recording session
	 */
	getSession(recordingId: string): RecordingSession | undefined {
		return this.activeSessions.get(recordingId);
	}

	/**
	 * Check if recording is active
	 */
	isRecording(recordingId: string): boolean {
		return this.activeSessions.has(recordingId);
	}

	/**
	 * Get the number of actions recorded
	 */
	getActionCount(recordingId: string): number {
		const session = this.activeSessions.get(recordingId);
		return session ? session.actions.length : 0;
	}
}

/**
 * Helper to record browser actions from node execution
 */
export async function recordBrowserAction(
	recordingId: string | undefined,
	resource: string,
	operation: string,
	params: {
		selector?: string;
		value?: string;
		url?: string;
		sessionId: string;
		pageId?: string;
	},
): Promise<void> {
	if (!recordingId) return;

	const recorder = ActionRecorder.getInstance();
	if (!recorder.isRecording(recordingId)) return;

	// Skip extraction operations - they don't need to be replayed
	if (resource === 'extraction') return;

	// Skip browser launch/close - handled separately
	if (resource === 'browser') return;

	const action: Omit<ActionStep, 'recordedAt'> = {
		resource,
		operation,
		selector: params.selector,
		value: params.value,
		url: params.url,
	};

	// Add default wait after interaction
	if (resource === 'interaction') {
		action.waitAfter = 500;
	}

	recorder.recordAction(recordingId, action);

	// Capture expected URL after navigation
	if (operation === 'navigate' || resource === 'interaction') {
		try {
			const page = await browserPool.getPage(params.sessionId, params.pageId || 'default');
			// Wait a bit for any navigation to complete
			await page.waitForTimeout(100);
			const session = recorder.getSession(recordingId);
			if (session && session.actions.length > 0) {
				const lastAction = session.actions[session.actions.length - 1];
				lastAction.expectedUrlPattern = page.url();
			}
		} catch {
			// Ignore errors capturing URL
		}
	}
}

// Export singleton and types
export const actionRecorder = ActionRecorder.getInstance();
export { ActionRecorder };
