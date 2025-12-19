import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Represents a single action step in a recorded workflow
 */
export interface ActionStep {
	/** Operation type: click, fill, navigate, etc. */
	operation: string;
	/** Resource type: page, interaction, extraction, etc. */
	resource: string;
	/** Primary CSS selector used */
	selector?: string;
	/** Alternative selectors if primary fails */
	selectorFallbacks?: string[];
	/** Value for fill operations - may contain {{variable}} placeholders */
	value?: string;
	/** URL for navigate operations */
	url?: string;
	/** Delay after action in ms */
	waitAfter?: number;
	/** Hash of screenshot taken after action (for validation) */
	screenshotHash?: string;
	/** Expected page URL pattern after action */
	expectedUrlPattern?: string;
	/** Timestamp when action was recorded */
	recordedAt: number;
}

/**
 * Represents a complete recorded workflow for a domain + goal combination
 */
export interface ActionMemory {
	/** Unique ID for this workflow */
	id: string;
	/** Domain this workflow is for (e.g., "linkedin.com") */
	domain: string;
	/** Goal pattern (e.g., "apply to * jobs") */
	goalPattern: string;
	/** Original goal that created this workflow */
	originalGoal: string;
	/** Recorded action sequence */
	actions: ActionStep[];
	/** Number of successful replays */
	successCount: number;
	/** Number of failed replays */
	failCount: number;
	/** When this workflow was created */
	createdAt: number;
	/** When this workflow was last used */
	lastUsed: number;
	/** When this workflow was last updated */
	lastUpdated: number;
	/** Variables extracted from goal (for substitution) */
	variables?: Record<string, string>;
}

/**
 * Memory store for browser action workflows
 * Stores learned workflows to JSON files for persistence
 */
export class ActionMemoryStore {
	private static instance: ActionMemoryStore;
	private memoryDir: string;
	private cache: Map<string, ActionMemory[]> = new Map();

	private constructor() {
		// Store in n8n data directory or fallback to home directory
		const n8nDir = process.env.N8N_USER_FOLDER || path.join(os.homedir(), '.n8n');
		this.memoryDir = path.join(n8nDir, 'browser-agent-memory');
		this.ensureDir();
	}

	static getInstance(): ActionMemoryStore {
		if (!ActionMemoryStore.instance) {
			ActionMemoryStore.instance = new ActionMemoryStore();
		}
		return ActionMemoryStore.instance;
	}

	private ensureDir(): void {
		if (!fs.existsSync(this.memoryDir)) {
			fs.mkdirSync(this.memoryDir, { recursive: true });
		}
	}

	private getDomainFile(domain: string): string {
		// Sanitize domain for filename
		const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
		return path.join(this.memoryDir, `${safeDomain}.json`);
	}

	private loadDomainMemories(domain: string): ActionMemory[] {
		// Check cache first
		if (this.cache.has(domain)) {
			return this.cache.get(domain)!;
		}

		const file = this.getDomainFile(domain);
		if (fs.existsSync(file)) {
			try {
				const data = fs.readFileSync(file, 'utf-8');
				const memories = JSON.parse(data) as ActionMemory[];
				this.cache.set(domain, memories);
				return memories;
			} catch {
				return [];
			}
		}
		return [];
	}

	private saveDomainMemories(domain: string, memories: ActionMemory[]): void {
		const file = this.getDomainFile(domain);
		fs.writeFileSync(file, JSON.stringify(memories, null, 2));
		this.cache.set(domain, memories);
	}

	/**
	 * Extract domain from URL
	 */
	static extractDomain(url: string): string {
		try {
			const urlObj = new URL(url);
			return urlObj.hostname;
		} catch {
			return url;
		}
	}

	/**
	 * Create a goal pattern from an original goal by replacing specific values with wildcards
	 */
	static createGoalPattern(goal: string): { pattern: string; variables: Record<string, string> } {
		const variables: Record<string, string> = {};
		let pattern = goal.toLowerCase();

		// Common substitutions for job-related goals
		const jobTitles = [
			'software engineer',
			'data scientist',
			'product manager',
			'frontend developer',
			'backend developer',
			'full stack developer',
			'devops engineer',
			'ux designer',
			'ui designer',
		];

		for (const title of jobTitles) {
			if (pattern.includes(title)) {
				variables['job_title'] = title;
				pattern = pattern.replace(title, '{{job_title}}');
				break;
			}
		}

		// Replace numbers (like "10" influencers, "5" jobs, etc.)
		const numberMatch = pattern.match(/\b(\d+)\b/);
		if (numberMatch) {
			variables['count'] = numberMatch[1];
			pattern = pattern.replace(/\b\d+\b/, '{{count}}');
		}

		return { pattern, variables };
	}

	/**
	 * Check if a goal matches a pattern
	 */
	static matchesPattern(
		goal: string,
		pattern: string,
	): { matches: boolean; variables: Record<string, string> } {
		const variables: Record<string, string> = {};
		let regex = pattern.replace(/\{\{(\w+)\}\}/g, '(?<$1>.+?)');
		regex = `^${regex}$`;

		try {
			const match = goal.toLowerCase().match(new RegExp(regex, 'i'));
			if (match?.groups) {
				Object.assign(variables, match.groups);
				return { matches: true, variables };
			}
		} catch {
			// Invalid regex, do exact match
		}

		return { matches: goal.toLowerCase() === pattern.toLowerCase(), variables };
	}

	/**
	 * Find a matching workflow for the given domain and goal
	 */
	findWorkflow(
		domain: string,
		goal: string,
	): { workflow: ActionMemory; variables: Record<string, string> } | null {
		const memories = this.loadDomainMemories(domain);

		for (const memory of memories) {
			const { matches, variables } = ActionMemoryStore.matchesPattern(goal, memory.goalPattern);
			if (matches) {
				return { workflow: memory, variables };
			}
		}

		return null;
	}

	/**
	 * Save a new workflow or update existing one
	 */
	saveWorkflow(memory: ActionMemory): void {
		const memories = this.loadDomainMemories(memory.domain);

		// Check if workflow with same pattern exists
		const existingIndex = memories.findIndex((m) => m.goalPattern === memory.goalPattern);

		if (existingIndex >= 0) {
			// Update existing
			memories[existingIndex] = {
				...memory,
				lastUpdated: Date.now(),
			};
		} else {
			// Add new
			memories.push(memory);
		}

		this.saveDomainMemories(memory.domain, memories);
	}

	/**
	 * Update workflow after successful replay
	 */
	recordSuccess(domain: string, goalPattern: string): void {
		const memories = this.loadDomainMemories(domain);
		const memory = memories.find((m) => m.goalPattern === goalPattern);

		if (memory) {
			memory.successCount++;
			memory.lastUsed = Date.now();
			this.saveDomainMemories(domain, memories);
		}
	}

	/**
	 * Update workflow after failed replay
	 */
	recordFailure(domain: string, goalPattern: string): void {
		const memories = this.loadDomainMemories(domain);
		const memory = memories.find((m) => m.goalPattern === goalPattern);

		if (memory) {
			memory.failCount++;
			memory.lastUsed = Date.now();
			this.saveDomainMemories(domain, memories);
		}
	}

	/**
	 * Update a specific action in a workflow (after AI fixes it)
	 */
	updateAction(
		domain: string,
		goalPattern: string,
		actionIndex: number,
		updatedAction: ActionStep,
	): void {
		const memories = this.loadDomainMemories(domain);
		const memory = memories.find((m) => m.goalPattern === goalPattern);

		if (memory && memory.actions[actionIndex]) {
			// Keep old selector as fallback
			const oldSelector = memory.actions[actionIndex].selector;
			if (oldSelector && updatedAction.selector !== oldSelector) {
				updatedAction.selectorFallbacks = updatedAction.selectorFallbacks || [];
				if (!updatedAction.selectorFallbacks.includes(oldSelector)) {
					updatedAction.selectorFallbacks.push(oldSelector);
				}
			}

			memory.actions[actionIndex] = {
				...memory.actions[actionIndex],
				...updatedAction,
				recordedAt: Date.now(),
			};
			memory.lastUpdated = Date.now();

			this.saveDomainMemories(domain, memories);
		}
	}

	/**
	 * Delete a workflow
	 */
	deleteWorkflow(domain: string, goalPattern: string): boolean {
		const memories = this.loadDomainMemories(domain);
		const index = memories.findIndex((m) => m.goalPattern === goalPattern);

		if (index >= 0) {
			memories.splice(index, 1);
			this.saveDomainMemories(domain, memories);
			return true;
		}

		return false;
	}

	/**
	 * List all workflows for a domain
	 */
	listWorkflows(domain: string): ActionMemory[] {
		return this.loadDomainMemories(domain);
	}

	/**
	 * Generate a unique workflow ID
	 */
	static generateId(): string {
		return `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}
}

// Export singleton instance
export const actionMemoryStore = ActionMemoryStore.getInstance();
