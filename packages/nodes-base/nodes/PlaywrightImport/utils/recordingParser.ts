import { randomUUID } from 'crypto';

/**
 * Playwright CRX Recording Parser
 * Converts Playwright Chrome Extension recordings to n8n workflow JSON
 */

export interface CRXBrowserConfig {
	browserName?: string;
	launchOptions?: {
		headless?: boolean;
		slowMo?: number;
	};
	contextOptions?: Record<string, unknown>;
}

export interface CRXAction {
	name?: string;
	url?: string;
	selector?: string;
	signals?: unknown[];
	button?: string;
	modifiers?: number;
	clickCount?: number;
	pageAlias?: string;
	framePath?: string[];
	text?: string;
	key?: string;
	value?: string;
	files?: string[];
	locator?: {
		kind: string;
		body: string;
		options?: Record<string, unknown>;
	};
}

export interface WorkflowNode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
}

export interface WorkflowConnection {
	node: string;
	type: string;
	index: number;
}

export interface WorkflowConnections {
	[nodeName: string]: {
		main: WorkflowConnection[][];
	};
}

export interface GeneratedWorkflow {
	name: string;
	nodes: WorkflowNode[];
	connections: WorkflowConnections;
}

export interface ParserOptions {
	workflowName?: string;
	startX?: number;
	startY?: number;
	nodeSpacing?: number;
}

/**
 * Parse CRX recording input (newline-delimited JSON)
 */
export function parseRecording(input: string): Array<CRXBrowserConfig | CRXAction> {
	const lines = input
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const actions: Array<CRXBrowserConfig | CRXAction> = [];

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			actions.push(parsed);
		} catch {
			// Skip invalid JSON lines
			console.warn('Skipping invalid JSON line:', line);
		}
	}

	return actions;
}

/**
 * Check if an action is a browser config (first line)
 */
function isBrowserConfig(action: CRXBrowserConfig | CRXAction): action is CRXBrowserConfig {
	return 'browserName' in action || 'launchOptions' in action || 'contextOptions' in action;
}

/**
 * Generate unique node name with counter for duplicates
 */
function generateNodeName(baseName: string, existingNames: Set<string>): string {
	if (!existingNames.has(baseName)) {
		existingNames.add(baseName);
		return baseName;
	}

	let counter = 1;
	let newName = `${baseName} ${counter}`;
	while (existingNames.has(newName)) {
		counter++;
		newName = `${baseName} ${counter}`;
	}
	existingNames.add(newName);
	return newName;
}

/**
 * Convert CRX browser config to n8n Launch Browser node
 */
function createLaunchNode(
	config: CRXBrowserConfig,
	position: [number, number],
	existingNames: Set<string>,
): WorkflowNode {
	const browserType = config.browserName || 'chromium';
	const headless = config.launchOptions?.headless ?? false;

	return {
		id: randomUUID(),
		name: generateNodeName('Launch Browser', existingNames),
		type: 'n8n-nodes-base.playwrightBrowser',
		typeVersion: 1,
		position,
		parameters: {
			resource: 'browser',
			operation: 'launch',
			browserType,
			headless,
		},
	};
}

/**
 * Convert CRX action to n8n Playwright node
 */
function createActionNode(
	action: CRXAction,
	position: [number, number],
	existingNames: Set<string>,
): WorkflowNode | null {
	const baseNode = {
		id: randomUUID(),
		type: 'n8n-nodes-base.playwrightBrowser',
		typeVersion: 1,
		position,
	};

	switch (action.name) {
		case 'openPage':
		case 'navigate':
			return {
				...baseNode,
				name: generateNodeName('Navigate', existingNames),
				parameters: {
					resource: 'page',
					operation: 'navigate',
					url: action.url || '',
				},
			};

		case 'click':
			const clickType =
				action.clickCount === 2 ? 'double' : action.button === 'right' ? 'right' : 'single';
			return {
				...baseNode,
				name: generateNodeName('Click', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'click',
					selector: action.selector || '',
					clickType,
				},
			};

		case 'fill':
			return {
				...baseNode,
				name: generateNodeName('Fill', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'fill',
					selector: action.selector || '',
					text: action.text || '',
				},
			};

		case 'type':
			return {
				...baseNode,
				name: generateNodeName('Type', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'type',
					selector: action.selector || '',
					text: action.text || '',
				},
			};

		case 'press':
			return {
				...baseNode,
				name: generateNodeName('Press Key', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'press',
					key: action.key || '',
				},
			};

		case 'hover':
			return {
				...baseNode,
				name: generateNodeName('Hover', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'hover',
					selector: action.selector || '',
				},
			};

		case 'check':
			return {
				...baseNode,
				name: generateNodeName('Check', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'check',
					selector: action.selector || '',
				},
			};

		case 'uncheck':
			return {
				...baseNode,
				name: generateNodeName('Uncheck', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'check',
					selector: action.selector || '',
					checkAction: 'uncheck',
				},
			};

		case 'select':
		case 'selectOption':
			return {
				...baseNode,
				name: generateNodeName('Select Option', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'selectOption',
					selector: action.selector || '',
					value: action.value || '',
				},
			};

		case 'scroll':
			return {
				...baseNode,
				name: generateNodeName('Scroll', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'scroll',
				},
			};

		case 'upload':
		case 'setInputFiles':
			return {
				...baseNode,
				name: generateNodeName('Upload File', existingNames),
				parameters: {
					resource: 'interaction',
					operation: 'uploadFile',
					selector: action.selector || '',
				},
			};

		case 'waitForSelector':
			return {
				...baseNode,
				name: generateNodeName('Wait for Element', existingNames),
				parameters: {
					resource: 'wait',
					operation: 'waitForSelector',
					selector: action.selector || '',
				},
			};

		case 'waitForTimeout':
			return {
				...baseNode,
				name: generateNodeName('Wait', existingNames),
				parameters: {
					resource: 'wait',
					operation: 'waitForTimeout',
					timeout: 1000,
				},
			};

		case 'waitForNavigation':
			return {
				...baseNode,
				name: generateNodeName('Wait for Navigation', existingNames),
				parameters: {
					resource: 'wait',
					operation: 'waitForNavigation',
				},
			};

		case 'screenshot':
			return {
				...baseNode,
				name: generateNodeName('Screenshot', existingNames),
				parameters: {
					resource: 'extraction',
					operation: 'screenshot',
				},
			};

		case 'closePage':
		case 'close':
			return {
				...baseNode,
				name: generateNodeName('Close Browser', existingNames),
				parameters: {
					resource: 'browser',
					operation: 'close',
				},
			};

		default:
			// Skip unknown actions
			console.warn('Unknown action type:', action.name);
			return null;
	}
}

/**
 * Generate workflow JSON from CRX recording
 */
export function generateWorkflowJson(
	input: string,
	options: ParserOptions = {},
): GeneratedWorkflow {
	const {
		workflowName = 'Playwright Recording',
		startX = 250,
		startY = 300,
		nodeSpacing = 200,
	} = options;

	const actions = parseRecording(input);
	const nodes: WorkflowNode[] = [];
	const connections: WorkflowConnections = {};
	const existingNames = new Set<string>();

	let currentX = startX;
	const currentY = startY;

	for (const action of actions) {
		let node: WorkflowNode | null = null;

		if (isBrowserConfig(action)) {
			node = createLaunchNode(action, [currentX, currentY], existingNames);
		} else {
			node = createActionNode(action, [currentX, currentY], existingNames);
		}

		if (node) {
			// Connect to previous node
			if (nodes.length > 0) {
				const prevNode = nodes[nodes.length - 1];
				if (!connections[prevNode.name]) {
					connections[prevNode.name] = { main: [[]] };
				}
				connections[prevNode.name].main[0].push({
					node: node.name,
					type: 'main',
					index: 0,
				});
			}

			nodes.push(node);
			currentX += nodeSpacing;
		}
	}

	return {
		name: workflowName,
		nodes,
		connections,
	};
}

/**
 * Generate workflow JSON string for clipboard/import
 */
export function generateWorkflowJsonString(input: string, options: ParserOptions = {}): string {
	const workflow = generateWorkflowJson(input, options);
	return JSON.stringify(workflow, null, 2);
}
