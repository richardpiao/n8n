import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { INPUT_CHAT_MODEL } from '../BrowserAgent.node';
import type { ActionStep } from '../../PlaywrightBrowser/utils/actionMemory';

/**
 * Playwright resource types
 */
export type PlaywrightResource = 'interaction' | 'page' | 'extraction' | 'wait';

/**
 * All 24 Playwright operations
 */
export type PlaywrightOperation =
	// Interaction (9)
	| 'click'
	| 'fill'
	| 'type'
	| 'press'
	| 'hover'
	| 'scroll'
	| 'check'
	| 'selectOption'
	| 'uploadFile'
	// Page (4)
	| 'navigate'
	| 'reload'
	| 'goBack'
	| 'goForward'
	// Extraction (7)
	| 'screenshot'
	| 'getText'
	| 'getContent'
	| 'getAttribute'
	| 'getUrl'
	| 'getPageInfo'
	| 'evaluate'
	// Wait (4)
	| 'waitForSelector'
	| 'waitForTimeout'
	| 'waitForNavigation'
	| 'waitForFunction'
	// Done
	| 'done';

/**
 * Result from AI planner - what action to take next
 */
export interface PlannerResult {
	operation: PlaywrightOperation;
	resource: PlaywrightResource | 'done';
	selector?: string;
	value?: string;
	url?: string;
	key?: string;
	scrollY?: number;
	ms?: number;
	script?: string;
	attribute?: string;
	filePath?: string;
	reasoning: string;
	isDone: boolean;
	result?: string;
}

/**
 * Page info structure for AI context
 */
export interface PageContext {
	url: string;
	title: string;
	elements: Array<{
		index: number;
		selector: string;
		type: string;
		text: string;
		placeholder?: string;
		href?: string;
	}>;
	forms?: Array<{
		fields: Array<{
			type: string;
			name: string;
			placeholder?: string;
		}>;
	}>;
	scrapedContext?: string;
}

/**
 * Action history for context
 */
export interface ActionHistory {
	operation: string;
	selector?: string;
	value?: string;
	success: boolean;
	error?: string;
}

/**
 * Map operation to resource type
 */
export function getResourceForOperation(
	operation: PlaywrightOperation,
): PlaywrightResource | 'done' {
	const interactionOps = [
		'click',
		'fill',
		'type',
		'press',
		'hover',
		'scroll',
		'check',
		'selectOption',
		'uploadFile',
	];
	const pageOps = ['navigate', 'reload', 'goBack', 'goForward'];
	const extractionOps = [
		'screenshot',
		'getText',
		'getContent',
		'getAttribute',
		'getUrl',
		'getPageInfo',
		'evaluate',
	];
	const waitOps = ['waitForSelector', 'waitForTimeout', 'waitForNavigation', 'waitForFunction'];

	if (interactionOps.includes(operation)) return 'interaction';
	if (pageOps.includes(operation)) return 'page';
	if (extractionOps.includes(operation)) return 'extraction';
	if (waitOps.includes(operation)) return 'wait';
	return 'done';
}

const SYSTEM_PROMPT = `You are a browser automation agent. Given the current page state and user's goal, decide the next action.

AVAILABLE OPERATIONS (24 total):

INTERACTION:
- click: Click element (selector)
- fill: Fill input field, clears existing text first (selector, value)
- type: Type character by character (selector, value)
- press: Press keyboard key (key: "Enter", "Tab", "Escape", "ArrowDown", etc.)
- hover: Hover over element (selector)
- scroll: Scroll page (scrollY: pixels, positive=down, negative=up)
- check: Check/uncheck checkbox (selector)
- selectOption: Select dropdown option (selector, value)
- uploadFile: Upload file (selector, filePath)

PAGE:
- navigate: Go to URL (url)
- reload: Reload current page
- goBack: Browser back button
- goForward: Browser forward button

EXTRACTION:
- screenshot: Take screenshot
- getText: Get element text content (selector)
- getContent: Get full page HTML
- getAttribute: Get element attribute (selector, attribute)
- getUrl: Get current URL and title
- getPageInfo: Get all interactive elements
- evaluate: Run JavaScript code (script)

WAIT:
- waitForSelector: Wait for element to appear (selector, optional: ms timeout)
- waitForTimeout: Wait for time (ms)
- waitForNavigation: Wait for page navigation to complete
- waitForFunction: Wait for JavaScript condition (script)

DONE:
- done: Goal achieved (result: description of what was accomplished)

RULES:
1. Start with 'navigate' if not on the target website
2. Use exact selectors from the provided elements list
3. For search/input fields, use 'fill' then 'press' with "Enter" or 'click' on submit button
4. If action fails, try alternative selectors or approaches
5. Use 'waitForSelector' or 'waitForTimeout' when page needs to load
6. When goal is achieved, respond with 'done' and describe the result

Respond ONLY with valid JSON:
{
  "operation": "click|fill|navigate|press|...|done",
  "selector": "CSS selector for element operations",
  "value": "text for fill/type, option value for selectOption",
  "url": "URL for navigate",
  "key": "key name for press (Enter, Tab, Escape, etc.)",
  "scrollY": 500,
  "ms": 1000,
  "script": "JavaScript code for evaluate/waitForFunction",
  "attribute": "attribute name for getAttribute",
  "filePath": "file path for uploadFile",
  "reasoning": "brief explanation of why this action",
  "isDone": false,
  "result": "only when isDone=true, describe what was accomplished"
}`;

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
 * Call the connected LLM with messages
 */
async function callLLM(
	llm: BaseChatModel,
	systemPrompt: string,
	userMessage: string,
): Promise<string> {
	const messages = [new SystemMessage(systemPrompt), new HumanMessage(userMessage)];

	const response = await llm.invoke(messages);

	// Handle different response formats
	if (typeof response.content === 'string') {
		return response.content;
	}

	// Handle array of content blocks (e.g., from Claude)
	if (Array.isArray(response.content)) {
		return response.content
			.map((block) => {
				if (typeof block === 'string') return block;
				if ('text' in block) return block.text;
				return '';
			})
			.join('');
	}

	return String(response.content);
}

/**
 * Ask AI what action to take next
 */
export async function planNextAction(
	context: IExecuteFunctions,
	goal: string,
	pageContext: PageContext,
	history: ActionHistory[],
): Promise<PlannerResult> {
	const llm = await getConnectedLLM(context);

	// Build the user message with current context
	const userMessage = buildUserMessage(goal, pageContext, history);
	console.log('[planNextAction] Goal:', JSON.stringify(goal));
	console.log('[planNextAction] UserMessage first 300 chars:', userMessage.substring(0, 300));

	// Call connected LLM
	const response = await callLLM(llm, SYSTEM_PROMPT, userMessage);

	// Parse and validate the response
	return parseAIResponse(response);
}

/**
 * Ask LLM what value to fill in a form field
 */
export async function getFormFieldValue(
	context: IExecuteFunctions,
	fieldInfo: { name: string; type: string; placeholder?: string; options?: string[] },
	pageContext: { url: string; title: string },
	userContext?: string,
): Promise<string> {
	const llm = await getConnectedLLM(context);

	const prompt = `You are helping fill out a form on ${pageContext.url} (${pageContext.title}).

The form field is:
- Label/Name: "${fieldInfo.name}"
- Input Type: ${fieldInfo.type}
${fieldInfo.placeholder ? `- Placeholder: "${fieldInfo.placeholder}"` : ''}
${fieldInfo.options ? `- Available Options: ${fieldInfo.options.join(', ')}` : ''}
${userContext ? `\nUser context/profile:\n${userContext}` : ''}

Based on common form-filling patterns and any user context provided, what value should be entered?

IMPORTANT:
- Respond with ONLY the value to enter, nothing else
- No quotes, no explanation, just the raw value
- If it's a checkbox/radio, respond with "true" or "false"
- If it's a dropdown, respond with the exact option text`;

	const response = await callLLM(llm, 'You are a helpful assistant.', prompt);

	return response.trim();
}

/**
 * Fix a single broken step in a pipeline
 */
export async function fixBrokenStep(
	context: IExecuteFunctions,
	failedAction: ActionStep,
	pageContext: PageContext,
	error: string,
): Promise<PlannerResult> {
	const llm = await getConnectedLLM(context);

	const elementsPreview = pageContext.elements.slice(0, 30).map((el) => ({
		selector: el.selector,
		type: el.type,
		text: el.text?.substring(0, 50),
	}));

	const prompt = `A browser automation step failed and needs to be fixed.

FAILED ACTION:
${JSON.stringify(failedAction, null, 2)}

ERROR MESSAGE:
${error}

CURRENT PAGE STATE:
- URL: ${pageContext.url}
- Title: ${pageContext.title}

AVAILABLE ELEMENTS ON PAGE:
${JSON.stringify(elementsPreview, null, 2)}

Please provide a FIXED action using one of the 24 available operations.
The action should accomplish the same goal but with updated selectors or approach.

Respond ONLY with valid JSON in this format:
{
  "operation": "click|fill|navigate|...",
  "selector": "updated CSS selector",
  "value": "value if needed",
  "url": "url if navigate",
  "reasoning": "why this fix should work",
  "isDone": false
}`;

	const response = await callLLM(llm, SYSTEM_PROMPT, prompt);

	return parseAIResponse(response);
}

/**
 * Build the user message with page context
 */
function buildUserMessage(
	goal: string,
	pageContext: PageContext,
	history: ActionHistory[],
): string {
	let message = `GOAL: ${goal}\n\n`;

	message += 'CURRENT PAGE:\n';
	message += `- URL: ${pageContext.url}\n`;
	message += `- Title: ${pageContext.title}\n\n`;

	// Add scraped context if available
	if (pageContext.scrapedContext) {
		message += 'SCRAPED PAGE CONTEXT:\n';
		message += pageContext.scrapedContext.substring(0, 2000);
		message += '\n\n';
	}

	if (pageContext.elements.length > 0) {
		message += 'INTERACTIVE ELEMENTS (use these selectors):\n';
		for (const el of pageContext.elements.slice(0, 50)) {
			// Limit to 50 elements
			let desc = `[${el.index}] ${el.type}: "${el.text || el.placeholder || ''}"`;
			if (el.href) desc += ` → ${el.href}`;
			desc += ` | selector: ${el.selector}`;
			message += `${desc}\n`;
		}
		message += '\n';
	} else {
		message += 'NO INTERACTIVE ELEMENTS FOUND ON PAGE\n\n';
	}

	// Add form info if available
	if (pageContext.forms && pageContext.forms.length > 0) {
		message += 'FORMS ON PAGE:\n';
		for (const form of pageContext.forms) {
			const fieldNames = form.fields.map((f) => `${f.name} (${f.type})`).join(', ');
			message += `- Fields: ${fieldNames}\n`;
		}
		message += '\n';
	}

	if (history.length > 0) {
		message += 'PREVIOUS ACTIONS:\n';
		for (const action of history.slice(-5)) {
			// Last 5 actions
			const status = action.success ? '✓' : '✗';
			let desc = `${status} ${action.operation}`;
			if (action.selector) desc += ` on "${action.selector}"`;
			if (action.value) desc += ` with "${action.value}"`;
			if (action.error) desc += ` (error: ${action.error})`;
			message += `${desc}\n`;
		}
		message += '\n';
	}

	message += 'What is the next action to achieve the goal?';

	return message;
}

/**
 * Parse AI response into structured result
 */
function parseAIResponse(response: string): PlannerResult {
	// Try to extract JSON from the response
	let jsonStr = response.trim();

	// Handle markdown code blocks
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1].trim();
	}

	try {
		const parsed = JSON.parse(jsonStr) as Partial<PlannerResult>;

		// Validate required fields
		if (!parsed.operation) {
			throw new Error('Missing operation field');
		}

		// Determine resource type
		const resource = getResourceForOperation(parsed.operation as PlaywrightOperation);

		// Normalize the result
		return {
			operation: parsed.operation as PlaywrightOperation,
			resource,
			selector: parsed.selector,
			value: parsed.value || parsed.url,
			url: parsed.url,
			key: parsed.key,
			scrollY: parsed.scrollY,
			ms: parsed.ms,
			script: parsed.script,
			attribute: parsed.attribute,
			filePath: parsed.filePath,
			reasoning: parsed.reasoning || 'No reasoning provided',
			isDone: parsed.isDone || parsed.operation === 'done',
			result: parsed.result,
		};
	} catch {
		// If parsing fails, try to extract intent from text
		console.error('Failed to parse AI response:', response);

		// Default to a safe action
		return {
			operation: 'waitForTimeout',
			resource: 'wait',
			ms: 1000,
			reasoning: 'Failed to parse AI response, waiting before retry',
			isDone: false,
		};
	}
}

/**
 * Extract domain from goal for memory lookup
 */
export function extractDomainFromGoal(goal: string): string {
	// Try to find URLs in the goal
	const urlMatch = goal.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/);
	if (urlMatch) {
		return urlMatch[1];
	}

	// Try to find common website names
	const siteNames = [
		'google',
		'linkedin',
		'indeed',
		'instagram',
		'facebook',
		'twitter',
		'github',
		'youtube',
		'amazon',
		'ebay',
	];
	const lowerGoal = goal.toLowerCase();
	for (const site of siteNames) {
		if (lowerGoal.includes(site)) {
			return `${site}.com`;
		}
	}

	return 'unknown';
}

/**
 * Convert PlannerResult to ActionStep format for pipeline storage
 */
export function plannerResultToActionStep(result: PlannerResult): ActionStep {
	return {
		resource: result.resource === 'done' ? 'interaction' : result.resource,
		operation: result.operation,
		selector: result.selector,
		value: result.value,
		url: result.url,
		waitAfter: result.ms,
		recordedAt: Date.now(),
	};
}
