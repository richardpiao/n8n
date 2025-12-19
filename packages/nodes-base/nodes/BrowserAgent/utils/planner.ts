import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { INPUT_CHAT_MODEL } from '../BrowserAgent.node';
import type { IndexedElement } from './elementIndexer';

/**
 * Output from the Planner agent
 * Runs every N steps to provide strategic guidance
 */
export interface PlannerOutput {
	observation: string; // Current state analysis
	challenges: string; // Potential issues or roadblocks
	done: boolean; // Is the task complete?
	next_steps: string; // High-level guidance for Navigator (empty if done)
	final_answer?: string; // Result when done=true
	reasoning: string; // Why this assessment
}

/**
 * Action history record for planner context
 */
export interface ActionRecord {
	operation: string;
	index?: number;
	selector?: string;
	value?: string;
	success: boolean;
	error?: string;
}

/**
 * System prompt for the Planner agent
 * Focuses on strategic analysis, not tactical execution
 */
const PLANNER_SYSTEM_PROMPT = `You are a STRATEGIC PLANNER for browser automation.

Your role is to:
1. Analyze current progress toward the goal
2. Identify challenges or roadblocks
3. Determine if the task is complete
4. Suggest high-level next steps (NOT specific actions - Navigator handles those)

You run every few steps to provide guidance. Navigator executes the actual browser actions.

RESPONSE FORMAT (JSON only):
{
  "observation": "Brief analysis of current state and progress",
  "challenges": "Any obstacles or issues (empty string if none)",
  "done": false,
  "next_steps": "2-3 high-level steps to take next (empty if done)",
  "final_answer": "Result description (only when done=true)",
  "reasoning": "Why you made this assessment"
}

RULES:
1. When task is complete, set done=true AND provide final_answer
2. When not complete, provide next_steps (brief, strategic - NOT specific selectors)
3. Be concise - Navigator will figure out the details
4. Focus on WHAT needs to happen, not HOW to click/type

EXAMPLES of next_steps (good):
- "Search for 'software engineer' jobs in San Francisco"
- "Apply filters for remote work"
- "Click on the first relevant job listing"

EXAMPLES of next_steps (bad - too detailed):
- "Click on element [5] which is the search input"
- "Fill input with selector #search-box with value 'engineer'"`;

/**
 * Get the connected Chat Model
 */
async function getConnectedLLM(context: IExecuteFunctions): Promise<BaseChatModel> {
	const llm = (await context.getInputConnectionData(
		NodeConnectionTypes.AiLanguageModel,
		INPUT_CHAT_MODEL,
	)) as BaseChatModel;

	if (!llm) {
		throw new Error('No Chat Model connected. Please connect a Chat Model node.');
	}

	return llm;
}

/**
 * Format action history for planner context
 */
function formatHistory(history: ActionRecord[]): string {
	if (history.length === 0) {
		return 'No actions taken yet.';
	}

	const recent = history.slice(-10); // Last 10 actions
	return recent
		.map((h) => {
			const status = h.success ? '✓' : '✗';
			let desc = `${status} ${h.operation}`;
			if (h.index !== undefined) desc += ` [${h.index}]`;
			else if (h.selector) desc += ` "${h.selector}"`;
			if (h.value) desc += `: "${h.value.substring(0, 30)}"`;
			if (h.error) desc += ` (error: ${h.error.substring(0, 50)})`;
			return desc;
		})
		.join('\n');
}

/**
 * Format page state for planner (high-level summary)
 */
function formatPageState(url: string, title: string, elements: IndexedElement[]): string {
	const lines: string[] = [];

	lines.push(`URL: ${url}`);
	lines.push(`Title: ${title}`);
	lines.push(`Interactive elements: ${elements.length}`);

	// Summarize element types
	const typeCounts: Record<string, number> = {};
	for (const el of elements) {
		const baseType = el.type.split('[')[0];
		typeCounts[baseType] = (typeCounts[baseType] || 0) + 1;
	}
	lines.push(
		`Element types: ${Object.entries(typeCounts)
			.map(([t, c]) => `${t}(${c})`)
			.join(', ')}`,
	);

	// Key elements preview (first few)
	if (elements.length > 0) {
		lines.push('\nKey elements:');
		for (const el of elements.slice(0, 8)) {
			lines.push(
				`  [${el.index}] ${el.type}: ${el.text || el.placeholder || el.ariaLabel || '(no text)'}`,
			);
		}
		if (elements.length > 8) {
			lines.push(`  ... and ${elements.length - 8} more`);
		}
	}

	return lines.join('\n');
}

/**
 * Parse planner response into structured output
 */
function parsePlannerResponse(response: string): PlannerOutput {
	// Extract JSON from response
	let jsonStr = response.trim();

	// Handle markdown code blocks
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1].trim();
	}

	try {
		const parsed = JSON.parse(jsonStr) as Partial<PlannerOutput>;

		return {
			observation: parsed.observation || 'No observation provided',
			challenges: parsed.challenges || '',
			done: Boolean(parsed.done),
			next_steps: parsed.next_steps || '',
			final_answer: parsed.final_answer,
			reasoning: parsed.reasoning || 'No reasoning provided',
		};
	} catch {
		console.error('[Planner] Failed to parse response:', response);

		// Default: continue with generic next steps
		return {
			observation: 'Failed to parse planner response',
			challenges: 'Response parsing error',
			done: false,
			next_steps: 'Continue with the current approach',
			reasoning: 'Parse error fallback',
		};
	}
}

/**
 * Run the Planner agent
 * Provides strategic analysis and guidance for Navigator
 */
export async function runPlanner(
	context: IExecuteFunctions,
	goal: string,
	url: string,
	title: string,
	elements: IndexedElement[],
	history: ActionRecord[],
): Promise<PlannerOutput> {
	const llm = await getConnectedLLM(context);

	// Build user message
	const userMessage = `GOAL: ${goal}

CURRENT PAGE:
${formatPageState(url, title, elements)}

ACTION HISTORY:
${formatHistory(history)}

Analyze progress and provide strategic guidance.`;

	console.log('[Planner] Running strategic analysis...');

	// Call LLM
	const messages = [new SystemMessage(PLANNER_SYSTEM_PROMPT), new HumanMessage(userMessage)];

	const response = await llm.invoke(messages);

	// Extract text from response
	let responseText: string;
	if (typeof response.content === 'string') {
		responseText = response.content;
	} else if (Array.isArray(response.content)) {
		responseText = response.content
			.map((block) => {
				if (typeof block === 'string') return block;
				if ('text' in block) return block.text;
				return '';
			})
			.join('');
	} else {
		responseText = String(response.content);
	}

	const result = parsePlannerResponse(responseText);

	console.log(
		`[Planner] Done: ${result.done}, Next steps: ${result.next_steps.substring(0, 100)}...`,
	);

	return result;
}
