import type { IExecuteFunctions, IConnections } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { INPUT_CHAT_MODEL } from '../PipelineGenerator.node';

interface ValueSource {
	type: 'static' | 'expression' | 'resume' | 'vectorStorage';
	expression?: string;
	fieldType?: string;
	fieldLabel?: string;
}

interface PipelineStep {
	type?: string;
	operation: string;
	selector?: string;
	value?: string;
	valueSource?: ValueSource;
	url?: string;
	key?: string;
	scrollY?: number;
	ms?: number;
	script?: string;
	description?: string;
	param?: string;
	// Additional fields for all PlaywrightBrowser operations
	browserType?: string;
	attributeName?: string;
	filePath?: string;
	filterUrl?: string;
	cookies?: string;
	savePath?: string;
	loadPath?: string;
	waitUntil?: string;
	function?: string;
}

interface Pipeline {
	domain: string;
	goalPattern: string;
	originalGoal: string;
	params: string[];
	steps: PipelineStep[];
}

interface GenerationOptions {
	scriptName: string;
	outputFormat: string;
	includeErrorHandling: boolean;
	parameterizeInputs: boolean;
	addHumanDelays: boolean;
	generateLoopSupport: boolean;
}

// n8n workflow node structure
interface WorkflowNode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
}

export interface SubWorkflowOutput {
	name: string;
	nodes: WorkflowNode[];
	connections: IConnections;
}

const CODE_GENERATION_PROMPT = `You are an expert Playwright code generator. Given a pipeline of browser automation steps, generate clean, production-ready code.

IMPORTANT RULES:
1. Generate COMPLETE, RUNNABLE code - no placeholders or TODOs
2. Use exact selectors from the pipeline - do not modify them
3. Add proper TypeScript types if format is TypeScript
4. Include imports at the top
5. Export the main function
6. Use async/await properly
7. Add comments explaining each step

OUTPUT FORMAT:
- TypeScript: Use strict types, export async function
- JavaScript: CommonJS module.exports
- JSON: Return the pipeline as structured JSON with metadata

STEP MAPPING:
- navigate → page.goto(url)
- click → page.click(selector)
- fill → page.fill(selector, value)
- type → page.type(selector, value)
- press → page.keyboard.press(key)
- hover → page.hover(selector)
- scroll → page.evaluate(() => window.scrollBy(0, scrollY))
- check → page.check(selector) or page.uncheck(selector)
- selectOption → page.selectOption(selector, value)
- waitForSelector → page.waitForSelector(selector)
- waitForTimeout → page.waitForTimeout(ms)
- waitForNavigation → page.waitForNavigation()
- screenshot → page.screenshot()
- getText → page.textContent(selector)
- getContent → page.content()
- evaluate → page.evaluate(script)

Generate ONLY the code, no explanations before or after.`;

/**
 * Generate Playwright script from pipeline using AI
 */
export async function generatePlaywrightScript(
	context: IExecuteFunctions,
	pipeline: Pipeline,
	options: GenerationOptions,
): Promise<string> {
	// Get connected LLM
	const llm = (await context.getInputConnectionData(
		NodeConnectionTypes.AiLanguageModel,
		INPUT_CHAT_MODEL,
	)) as BaseChatModel;

	if (!llm) {
		throw new Error('Chat Model is required for code generation');
	}

	// Build the prompt
	const userPrompt = buildGenerationPrompt(pipeline, options);

	// Call LLM
	const messages = [new SystemMessage(CODE_GENERATION_PROMPT), new HumanMessage(userPrompt)];

	const response = await llm.invoke(messages);

	// Extract code from response
	let code =
		typeof response.content === 'string'
			? response.content
			: Array.isArray(response.content)
				? response.content
						.map((block) => {
							if (typeof block === 'string') return block;
							if ('text' in block) return block.text;
							return '';
						})
						.join('')
				: String(response.content);

	// Clean up code blocks if present
	const codeBlockMatch = code.match(/```(?:typescript|javascript|json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		code = codeBlockMatch[1].trim();
	}

	return code;
}

/**
 * Generate n8n sub-workflow with PlaywrightBrowser nodes from pipeline
 * This creates actual n8n nodes that can be rendered on the canvas
 */
export function generateSubWorkflow(pipeline: Pipeline, workflowName: string): SubWorkflowOutput {
	const nodes: WorkflowNode[] = [];
	const connections: IConnections = {};

	// Starting position for nodes
	const startX = 250;
	const startY = 300;
	const nodeSpacingX = 200;

	// Generate unique node ID
	const generateId = () => Math.random().toString(36).substring(2, 10);

	// First node: Session Start (creates browser session)
	const sessionStartId = generateId();
	const sessionStartNode: WorkflowNode = {
		id: sessionStartId,
		name: 'Start Browser Session',
		type: 'n8n-nodes-base.playwrightBrowser',
		typeVersion: 1,
		position: [startX, startY],
		parameters: {
			resource: 'session',
			operation: 'start',
			browserType: 'chromium',
			headless: false,
		},
	};
	nodes.push(sessionStartNode);

	let previousNodeName = sessionStartNode.name;
	let currentX = startX + nodeSpacingX;

	// Map each pipeline step to a PlaywrightBrowser node
	for (let i = 0; i < pipeline.steps.length; i++) {
		const step = pipeline.steps[i];
		const nodeId = generateId();
		const { resource, operation, parameters } = mapStepToNodeParams(step, i);

		const nodeName = generateNodeName(step, i);
		const node: WorkflowNode = {
			id: nodeId,
			name: nodeName,
			type: 'n8n-nodes-base.playwrightBrowser',
			typeVersion: 1,
			position: [currentX, startY],
			parameters: {
				resource,
				operation,
				sessionId: '={{ $json.sessionId }}',
				pageId: '={{ $json.pageId }}',
				...parameters,
			},
		};

		nodes.push(node);

		// Create connection from previous node to this one
		if (!connections[previousNodeName]) {
			connections[previousNodeName] = { main: [[]] };
		}
		const prevConn = connections[previousNodeName];
		if (prevConn?.main?.[0]) {
			prevConn.main[0].push({
				node: nodeName,
				type: NodeConnectionTypes.Main,
				index: 0,
			});
		}

		previousNodeName = nodeName;
		currentX += nodeSpacingX;
	}

	// Final node: Session End (closes browser)
	const sessionEndId = generateId();
	const sessionEndNode: WorkflowNode = {
		id: sessionEndId,
		name: 'End Browser Session',
		type: 'n8n-nodes-base.playwrightBrowser',
		typeVersion: 1,
		position: [currentX, startY],
		parameters: {
			resource: 'session',
			operation: 'close',
			sessionId: '={{ $json.sessionId }}',
		},
	};
	nodes.push(sessionEndNode);

	// Connect last action node to session end
	if (!connections[previousNodeName]) {
		connections[previousNodeName] = { main: [[]] };
	}
	const lastConn = connections[previousNodeName];
	if (lastConn?.main?.[0]) {
		lastConn.main[0].push({
			node: sessionEndNode.name,
			type: NodeConnectionTypes.Main,
			index: 0,
		});
	}

	return {
		name: workflowName || `${pipeline.domain}_automation`,
		nodes,
		connections,
	};
}

/**
 * Map a pipeline step to PlaywrightBrowser node resource/operation/parameters
 */
function mapStepToNodeParams(
	step: PipelineStep,
	_index: number,
): {
	resource: string;
	operation: string;
	parameters: Record<string, unknown>;
} {
	const op = step.operation.toLowerCase();

	switch (op) {
		case 'navigate':
		case 'goto':
			return {
				resource: 'page',
				operation: 'goto',
				parameters: {
					url: step.url || '',
				},
			};

		case 'click':
			return {
				resource: 'interaction',
				operation: 'click',
				parameters: {
					selector: step.selector || '',
				},
			};

		case 'fill':
			return {
				resource: 'interaction',
				operation: 'fill',
				parameters: {
					selector: step.selector || '',
					value: getValueExpression(step),
				},
			};

		case 'type':
			return {
				resource: 'interaction',
				operation: 'type',
				parameters: {
					selector: step.selector || '',
					text: getValueExpression(step),
				},
			};

		case 'press':
			return {
				resource: 'interaction',
				operation: 'press',
				parameters: {
					key: step.key || 'Enter',
				},
			};

		case 'hover':
			return {
				resource: 'interaction',
				operation: 'hover',
				parameters: {
					selector: step.selector || '',
				},
			};

		case 'scroll':
			return {
				resource: 'interaction',
				operation: 'scroll',
				parameters: {
					scrollY: step.scrollY || 500,
				},
			};

		case 'check':
			return {
				resource: 'interaction',
				operation: 'check',
				parameters: {
					selector: step.selector || '',
					checked: true,
				},
			};

		case 'selectoption':
		case 'select':
			return {
				resource: 'interaction',
				operation: 'selectOption',
				parameters: {
					selector: step.selector || '',
					value: getValueExpression(step),
				},
			};

		case 'waitforselector':
		case 'wait':
			return {
				resource: 'wait',
				operation: 'waitForSelector',
				parameters: {
					selector: step.selector || '',
				},
			};

		case 'waitfortimeout':
		case 'delay':
			return {
				resource: 'wait',
				operation: 'waitForTimeout',
				parameters: {
					timeout: step.ms || 1000,
				},
			};

		case 'screenshot':
			return {
				resource: 'page',
				operation: 'screenshot',
				parameters: {
					screenshotType: 'viewport',
				},
			};

		case 'gettext':
		case 'extract':
			return {
				resource: 'extraction',
				operation: 'getText',
				parameters: {
					selector: step.selector || '',
				},
			};

		case 'getcontent':
		case 'gethtml':
			return {
				resource: 'extraction',
				operation: 'getContent',
				parameters: {},
			};

		case 'evaluate':
			return {
				resource: 'page',
				operation: 'evaluate',
				parameters: {
					script: step.script || '',
				},
			};

		// Browser resource
		case 'launch':
			return {
				resource: 'browser',
				operation: 'launch',
				parameters: {
					browserType: step.browserType || 'chromium',
				},
			};

		case 'closebrowser':
			return {
				resource: 'browser',
				operation: 'close',
				parameters: {},
			};

		// Page resource - navigation
		case 'goback':
		case 'back':
			return {
				resource: 'page',
				operation: 'goBack',
				parameters: {},
			};

		case 'goforward':
		case 'forward':
			return {
				resource: 'page',
				operation: 'goForward',
				parameters: {},
			};

		case 'reload':
		case 'refresh':
			return {
				resource: 'page',
				operation: 'reload',
				parameters: {},
			};

		// Extraction resource
		case 'getattribute':
			return {
				resource: 'extraction',
				operation: 'getAttribute',
				parameters: {
					selector: step.selector || '',
					attributeName: step.attributeName || 'href',
				},
			};

		case 'getpageinfo':
			return {
				resource: 'extraction',
				operation: 'getPageInfo',
				parameters: {},
			};

		case 'geturl':
			return {
				resource: 'extraction',
				operation: 'getUrl',
				parameters: {},
			};

		// Interaction resource
		case 'uploadfile':
		case 'upload':
			return {
				resource: 'interaction',
				operation: 'uploadFile',
				parameters: {
					selector: step.selector || '',
					fileSource: 'path',
					filePath: step.filePath || '',
				},
			};

		// Session resource
		case 'getcookies':
			return {
				resource: 'session',
				operation: 'getCookies',
				parameters: {
					filterUrl: step.filterUrl || '',
				},
			};

		case 'setcookies':
			return {
				resource: 'session',
				operation: 'setCookies',
				parameters: {
					cookies: step.cookies || '[]',
				},
			};

		case 'savesession':
			return {
				resource: 'session',
				operation: 'save',
				parameters: {
					savePath: step.savePath || '',
				},
			};

		case 'loadsession':
			return {
				resource: 'session',
				operation: 'load',
				parameters: {
					loadPath: step.loadPath || '',
				},
			};

		// Wait resource
		case 'waitfornavigation':
			return {
				resource: 'wait',
				operation: 'waitForNavigation',
				parameters: {
					waitUntil: step.waitUntil || 'load',
				},
			};

		case 'waitforfunction':
			return {
				resource: 'wait',
				operation: 'waitForFunction',
				parameters: {
					function: step.function || step.script || '',
				},
			};

		default:
			// Default to click for unknown operations
			return {
				resource: 'interaction',
				operation: 'click',
				parameters: {
					selector: step.selector || '',
				},
			};
	}
}

/**
 * Get the value expression for fill/type operations
 * Handles static values and dynamic expressions
 */
function getValueExpression(step: PipelineStep): string {
	if (step.valueSource) {
		if (step.valueSource.type === 'expression' && step.valueSource.expression) {
			// Convert to n8n expression format
			return `={{ ${step.valueSource.expression} }}`;
		}
		if (step.valueSource.type === 'resume' && step.valueSource.fieldType) {
			return `={{ $json.resume.${step.valueSource.fieldType} }}`;
		}
	}
	return step.value || '';
}

/**
 * Generate a descriptive node name based on the step
 */
function generateNodeName(step: PipelineStep, index: number): string {
	const op = step.operation.toLowerCase();
	const prefix = `${index + 1}. `;

	if (step.description) {
		return prefix + step.description.substring(0, 30);
	}

	switch (op) {
		case 'navigate':
		case 'goto':
			const domain = step.url ? new URL(step.url).hostname : 'page';
			return prefix + `Go to ${domain}`;
		case 'click':
			return prefix + 'Click';
		case 'fill':
			return prefix + `Fill ${step.valueSource?.fieldLabel || 'input'}`;
		case 'type':
			return prefix + 'Type text';
		case 'press':
			return prefix + `Press ${step.key || 'key'}`;
		case 'hover':
			return prefix + 'Hover';
		case 'scroll':
			return prefix + 'Scroll';
		case 'check':
			return prefix + 'Check';
		case 'selectoption':
		case 'select':
			return prefix + 'Select option';
		case 'waitforselector':
		case 'wait':
			return prefix + 'Wait for element';
		case 'waitfortimeout':
		case 'delay':
			return prefix + `Wait ${step.ms || 1000}ms`;
		case 'screenshot':
			return prefix + 'Screenshot';
		case 'gettext':
		case 'extract':
			return prefix + 'Get text';
		case 'getcontent':
			return prefix + 'Get HTML';
		case 'evaluate':
			return prefix + 'Run script';
		// Browser resource
		case 'launch':
			return prefix + 'Launch browser';
		case 'closebrowser':
			return prefix + 'Close browser';
		// Page resource - navigation
		case 'goback':
		case 'back':
			return prefix + 'Go back';
		case 'goforward':
		case 'forward':
			return prefix + 'Go forward';
		case 'reload':
		case 'refresh':
			return prefix + 'Reload page';
		// Extraction resource
		case 'getattribute':
			return prefix + `Get ${step.attributeName || 'attribute'}`;
		case 'getpageinfo':
			return prefix + 'Get page info';
		case 'geturl':
			return prefix + 'Get URL';
		// Interaction resource
		case 'uploadfile':
		case 'upload':
			return prefix + 'Upload file';
		// Session resource
		case 'getcookies':
			return prefix + 'Get cookies';
		case 'setcookies':
			return prefix + 'Set cookies';
		case 'savesession':
			return prefix + 'Save session';
		case 'loadsession':
			return prefix + 'Load session';
		// Wait resource
		case 'waitfornavigation':
			return prefix + 'Wait for navigation';
		case 'waitforfunction':
			return prefix + 'Wait for condition';
		default:
			return prefix + step.operation;
	}
}

/**
 * Build the generation prompt with pipeline details
 */
function buildGenerationPrompt(pipeline: Pipeline, options: GenerationOptions): string {
	const lines: string[] = [];

	lines.push(`Generate a ${options.outputFormat.toUpperCase()} Playwright automation script.`);
	lines.push('');
	lines.push(`Script Name: ${options.scriptName}`);
	lines.push(`Domain: ${pipeline.domain}`);
	lines.push(`Original Goal: ${pipeline.originalGoal}`);
	lines.push('');

	// Options
	lines.push('OPTIONS:');
	lines.push(
		`- Error Handling: ${options.includeErrorHandling ? 'Yes (add try-catch, retries)' : 'No'}`,
	);
	lines.push(
		`- Parameterize Inputs: ${options.parameterizeInputs ? 'Yes (extract as function parameters)' : 'No'}`,
	);
	lines.push(
		`- Human Delays: ${options.addHumanDelays ? 'Yes (add random delays 100-500ms)' : 'No'}`,
	);
	lines.push(`- Loop Support: ${options.generateLoopSupport ? 'Yes (add iteration logic)' : 'No'}`);
	lines.push('');

	// Parameters to extract
	if (options.parameterizeInputs && pipeline.params.length > 0) {
		lines.push('PARAMETERS TO EXTRACT:');
		for (const param of pipeline.params) {
			lines.push(`- ${param}`);
		}
		lines.push('');
	}

	// Steps
	lines.push('PIPELINE STEPS:');
	for (let i = 0; i < pipeline.steps.length; i++) {
		const step = pipeline.steps[i];
		let stepDesc = `${i + 1}. [${step.type}] ${step.operation}`;

		if (step.selector) stepDesc += ` | selector: "${step.selector}"`;
		if (step.value) stepDesc += ` | value: "${step.value}"`;
		if (step.url) stepDesc += ` | url: "${step.url}"`;
		if (step.key) stepDesc += ` | key: "${step.key}"`;
		if (step.scrollY) stepDesc += ` | scrollY: ${step.scrollY}`;
		if (step.ms) stepDesc += ` | ms: ${step.ms}`;
		if (step.param) stepDesc += ` | param: {{${step.param}}}`;
		if (step.description) stepDesc += ` | note: "${step.description}"`;

		lines.push(stepDesc);
	}

	lines.push('');
	lines.push('Generate the complete code now:');

	return lines.join('\n');
}
