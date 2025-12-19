import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { INPUT_CHAT_MODEL } from '../BrowserAgent.node';
import type { IndexedElement } from './elementIndexer';
import { formatElementsForPrompt } from './elementIndexer';
import type { ActionRecord } from './planner';

/**
 * Navigator's internal state tracking
 */
export interface NavigatorState {
	evaluation: string; // Did previous actions work?
	memory: string; // What's been done so far
	next_goal: string; // Immediate objective
}

/**
 * Single action item from Navigator
 * Each action has exactly one operation type
 */
export interface ActionItem {
	click_element?: { index: number; intent: string };
	input_text?: { index: number; text: string; intent: string };
	go_to_url?: { url: string; intent: string };
	send_keys?: { keys: string; intent: string };
	scroll_down?: { pixels?: number; intent: string };
	scroll_up?: { pixels?: number; intent: string };
	scroll_to_element?: { index: number; intent: string };
	wait?: { seconds: number; intent: string };
	hover?: { index: number; intent: string };
	select_option?: { index: number; value: string; intent: string };
	done?: { text: string; success: boolean };
}

/**
 * Output from the Navigator agent
 * Contains state assessment and batch of actions
 */
export interface NavigatorOutput {
	current_state: NavigatorState;
	action: ActionItem[];
}

/**
 * Result of executing a single action
 */
export interface ActionResult {
	success: boolean;
	error?: string;
	isDone?: boolean;
	result?: string;
	data?: unknown;
}

/**
 * System prompt for the Navigator agent
 * Focuses on tactical execution with multi-action batches
 */
const NAVIGATOR_SYSTEM_PROMPT = `You are a NAVIGATOR agent for browser automation.

Your role is to execute browser actions to accomplish web tasks. You receive strategic guidance from a Planner and translate it into concrete browser interactions.

RESPONSE FORMAT (JSON only):
{
  "current_state": {
    "evaluation": "Success|Failed|Unknown - assess if previous actions worked",
    "memory": "Brief summary of what has been done (e.g., '3 of 5 items processed')",
    "next_goal": "What needs to be done next"
  },
  "action": [
    {"click_element": {"index": 5, "intent": "Click search button"}},
    {"input_text": {"index": 3, "text": "search query", "intent": "Enter search term"}},
    {"send_keys": {"keys": "Enter", "intent": "Submit search"}}
  ]
}

AVAILABLE ACTIONS:
- click_element: Click element by index
  {"click_element": {"index": 5, "intent": "..."}}

- input_text: Type text into input field (clears first)
  {"input_text": {"index": 3, "text": "hello", "intent": "..."}}

- go_to_url: Navigate to URL
  {"go_to_url": {"url": "https://example.com", "intent": "..."}}

- send_keys: Press keyboard key (Enter, Tab, Escape, ArrowDown, ArrowUp)
  {"send_keys": {"keys": "Enter", "intent": "..."}}

- scroll_down: Scroll page down
  {"scroll_down": {"pixels": 500, "intent": "..."}}

- scroll_up: Scroll page up
  {"scroll_up": {"pixels": 500, "intent": "..."}}

- scroll_to_element: Scroll element into view
  {"scroll_to_element": {"index": 10, "intent": "..."}}

- wait: Wait for specified seconds
  {"wait": {"seconds": 2, "intent": "..."}}

- hover: Hover over element
  {"hover": {"index": 7, "intent": "..."}}

- select_option: Select dropdown option
  {"select_option": {"index": 4, "value": "option text", "intent": "..."}}

- done: Task is complete
  {"done": {"text": "Successfully completed X", "success": true}}

RULES:
1. Return up to 10 actions per response
2. Reference elements by [index] number from the elements list
3. Common patterns:
   - Form: click input, input_text, send_keys Enter (or click submit)
   - Search: go_to_url, click search, input_text, send_keys Enter
   - Navigation: click link/button
4. Use "done" action when the goal is fully achieved
5. If previous action failed, try alternative approach
6. Include "intent" for every action (brief description)`;

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
 * Format recent action results for context
 */
function formatRecentResults(history: ActionRecord[]): string {
	if (history.length === 0) {
		return 'No previous actions.';
	}

	const recent = history.slice(-5); // Last 5 actions
	return recent
		.map((h) => {
			const status = h.success ? '✓' : '✗';
			let desc = `${status} ${h.operation}`;
			if (h.index !== undefined) desc += ` [${h.index}]`;
			if (h.value) desc += `: "${h.value.substring(0, 30)}"`;
			if (h.error) desc += ` ERROR: ${h.error.substring(0, 50)}`;
			return desc;
		})
		.join('\n');
}

/**
 * Parse navigator response into structured output
 */
function parseNavigatorResponse(response: string): NavigatorOutput {
	// Extract JSON from response
	let jsonStr = response.trim();

	// Handle markdown code blocks
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1].trim();
	}

	try {
		const parsed = JSON.parse(jsonStr) as Partial<NavigatorOutput>;

		// Validate and normalize
		const currentState: NavigatorState = {
			evaluation: parsed.current_state?.evaluation || 'Unknown',
			memory: parsed.current_state?.memory || '',
			next_goal: parsed.current_state?.next_goal || 'Continue with task',
		};

		// Ensure action is an array
		let actions: ActionItem[] = [];
		if (Array.isArray(parsed.action)) {
			actions = parsed.action.filter((a) => a !== null && typeof a === 'object');
		} else if (parsed.action && typeof parsed.action === 'object') {
			actions = [parsed.action as ActionItem];
		}

		// Limit to 10 actions
		if (actions.length > 10) {
			actions = actions.slice(0, 10);
		}

		return {
			current_state: currentState,
			action: actions,
		};
	} catch {
		console.error('[Navigator] Failed to parse response:', response);

		// Default: wait action
		return {
			current_state: {
				evaluation: 'Unknown',
				memory: 'Parse error',
				next_goal: 'Retry after wait',
			},
			action: [{ wait: { seconds: 1, intent: 'Wait due to parse error' } }],
		};
	}
}

/**
 * Run the Navigator agent
 * Returns batch of actions to execute
 */
export async function runNavigator(
	context: IExecuteFunctions,
	goal: string,
	plannerGuidance: string,
	url: string,
	title: string,
	elements: IndexedElement[],
	history: ActionRecord[],
	screenshot?: Buffer,
	maxActionsPerStep: number = 10,
): Promise<NavigatorOutput> {
	const llm = await getConnectedLLM(context);

	// Format elements for prompt
	const elementsText = formatElementsForPrompt(elements);

	// Build user message
	let userMessage = `GOAL: ${goal}

PLANNER GUIDANCE: ${plannerGuidance || 'No guidance yet - start working on the goal'}

CURRENT PAGE:
- URL: ${url}
- Title: ${title}

PREVIOUS ACTIONS:
${formatRecentResults(history)}

INTERACTIVE ELEMENTS (reference by [index]):
${elementsText || 'No interactive elements found'}

Decide the next actions (up to ${maxActionsPerStep} actions).`;

	// Build messages array
	const messages: Array<SystemMessage | HumanMessage> = [
		new SystemMessage(NAVIGATOR_SYSTEM_PROMPT),
	];

	// Add image if available
	if (screenshot) {
		messages.push(
			new HumanMessage({
				content: [
					{ type: 'text', text: userMessage },
					{
						type: 'image_url',
						image_url: {
							url: `data:image/png;base64,${screenshot.toString('base64')}`,
						},
					},
				],
			}),
		);
	} else {
		messages.push(new HumanMessage(userMessage));
	}

	console.log('[Navigator] Deciding next actions...');

	// Call LLM
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

	const result = parseNavigatorResponse(responseText);

	console.log(
		`[Navigator] Returning ${result.action.length} actions. Next goal: ${result.current_state.next_goal.substring(0, 50)}...`,
	);

	return result;
}

/**
 * Get the action type name from an ActionItem
 */
export function getActionType(action: ActionItem): string {
	const keys = Object.keys(action);
	return keys[0] || 'unknown';
}

/**
 * Get action arguments from an ActionItem
 */
export function getActionArgs(action: ActionItem): Record<string, unknown> {
	const keys = Object.keys(action);
	if (keys.length === 0) return {};
	return (action as Record<string, unknown>)[keys[0]] as Record<string, unknown>;
}
