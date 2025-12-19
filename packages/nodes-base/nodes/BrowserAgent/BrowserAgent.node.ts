import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	INodeInputConfiguration,
} from 'n8n-workflow';

import {
	executeGoal,
	type PlaywrightAction,
	type HumanCorrection,
	type DataContext,
} from './utils/executionLoop';

// Input index constants - simplified to just Chat Model
export const INPUT_CHAT_MODEL = 0;

// Helper function to define inputs - simplified to 2 only
function getInputs(): Array<INodeInputConfiguration> {
	return [
		// 1. Main input (goal from trigger)
		{ type: NodeConnectionTypes.Main },

		// 2. Chat Model - for action decisions AND vision (REQUIRED)
		{
			type: NodeConnectionTypes.AiLanguageModel,
			displayName: 'Chat Model',
			required: true,
			maxConnections: 1,
		},
	];
}

export class BrowserAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Browser Agent',
		name: 'browserAgent',
		icon: 'file:BrowserAgent.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Autonomous Browser Control',
		description:
			'AI-powered browser automation. Give it a natural language goal and it will autonomously navigate, click, fill forms, and complete tasks using Playwright. Outputs clean PlaywrightAction[] for pipeline generation.',
		usableAsTool: true,
		defaults: {
			name: 'Browser Agent',
		},
		inputs: `={{ ((parameters) => { return ${JSON.stringify(getInputs())}; })($parameter) }}`,
		outputs: [NodeConnectionTypes.Main],
		properties: [
			// === GOAL ===
			{
				displayName: 'Goal',
				name: 'goal',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g., Go to google.com and search for "n8n automation"',
				description: 'What do you want the browser to do? Describe your goal in natural language',
				typeOptions: {
					rows: 3,
				},
			},

			// === BROWSER OPTIONS ===
			{
				displayName: 'Browser Options',
				name: 'browserOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {
					headless: false,
					maxSteps: 20,
					timeout: 10000,
					maxRetries: 3,
					saveCookies: false,
					humanDelay: true,
					humanDelayMin: 100,
					humanDelayMax: 500,
					planningInterval: 3,
					maxActionsPerStep: 10,
				},
				options: [
					{
						displayName: 'Headless',
						name: 'headless',
						type: 'boolean',
						default: false,
						description:
							'Whether to run the browser without a visible window (false = visible for debugging)',
					},
					{
						displayName: 'Max Steps',
						name: 'maxSteps',
						type: 'number',
						default: 20,
						description: 'Maximum number of actions before giving up',
						typeOptions: {
							minValue: 1,
							maxValue: 100,
						},
					},
					{
						displayName: 'Step Timeout (ms)',
						name: 'timeout',
						type: 'number',
						default: 10000,
						description: 'Maximum time (in ms) to wait for each action',
						typeOptions: {
							minValue: 1000,
							maxValue: 120000,
						},
					},
					{
						displayName: 'Max Retries',
						name: 'maxRetries',
						type: 'number',
						default: 3,
						description: 'How many times to retry failed actions before giving up',
						typeOptions: {
							minValue: 0,
							maxValue: 10,
						},
					},
					{
						displayName: 'Proxy URL',
						name: 'proxyUrl',
						type: 'string',
						default: '',
						placeholder: 'e.g., http://proxy.example.com:8080',
						description: 'HTTP proxy URL for browser traffic (useful for geo-restricted sites)',
					},
					{
						displayName: 'Save Cookies',
						name: 'saveCookies',
						type: 'boolean',
						default: false,
						description:
							'Whether to persist login cookies between runs (saves to ~/.n8n/browser-agent-cookies/)',
					},
					{
						displayName: 'Human Delay',
						name: 'humanDelay',
						type: 'boolean',
						default: true,
						description: 'Whether to add random human-like delays between actions (100-500ms)',
					},
					{
						displayName: 'Min Delay (ms)',
						name: 'humanDelayMin',
						type: 'number',
						default: 100,
						description: 'Minimum delay between actions in milliseconds',
						displayOptions: {
							show: {
								humanDelay: [true],
							},
						},
						typeOptions: {
							minValue: 0,
							maxValue: 5000,
						},
					},
					{
						displayName: 'Max Delay (ms)',
						name: 'humanDelayMax',
						type: 'number',
						default: 500,
						description: 'Maximum delay between actions in milliseconds',
						displayOptions: {
							show: {
								humanDelay: [true],
							},
						},
						typeOptions: {
							minValue: 0,
							maxValue: 10000,
						},
					},
					{
						displayName: 'Planning Interval',
						name: 'planningInterval',
						type: 'number',
						default: 3,
						description:
							'Run strategic Planner every N steps (lower = more AI calls, better accuracy)',
						typeOptions: {
							minValue: 1,
							maxValue: 10,
						},
					},
					{
						displayName: 'Max Actions Per Step',
						name: 'maxActionsPerStep',
						type: 'number',
						default: 10,
						description: 'Maximum actions Navigator can return per step (higher = fewer AI calls)',
						typeOptions: {
							minValue: 1,
							maxValue: 20,
						},
					},
				],
			},

			// === VISION OPTIONS (uses same Chat Model) ===
			{
				displayName: 'Vision Options',
				name: 'visionOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {
					enabled: true,
				},
				description:
					'Uses the connected Chat Model for vision (requires vision-capable model like GPT-4o)',
				options: [
					{
						displayName: 'Enable Vision',
						name: 'enabled',
						type: 'boolean',
						default: true,
						description: 'Whether to analyze screenshots with AI (combined with HTML scraping)',
					},
				],
			},

			// === OUTPUT OPTIONS ===
			{
				displayName: 'Output Options',
				name: 'outputOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {
					includeScreenshots: false,
				},
				options: [
					{
						displayName: 'Include Screenshots',
						name: 'includeScreenshots',
						type: 'boolean',
						default: false,
						description: 'Whether to capture screenshots after each action (useful for debugging)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const goal = this.getNodeParameter('goal', i) as string;
				console.log('[BrowserAgent] Goal from parameter:', JSON.stringify(goal));

				// Get all option collections
				const browserOptions = this.getNodeParameter('browserOptions', i, {}) as {
					headless?: boolean;
					maxSteps?: number;
					timeout?: number;
					maxRetries?: number;
					proxyUrl?: string;
					saveCookies?: boolean;
					humanDelay?: boolean;
					humanDelayMin?: number;
					humanDelayMax?: number;
					planningInterval?: number;
					maxActionsPerStep?: number;
				};
				const visionOptions = this.getNodeParameter('visionOptions', i, {}) as {
					enabled?: boolean;
				};
				const outputOptions = this.getNodeParameter('outputOptions', i, {}) as {
					includeScreenshots?: boolean;
				};

				if (!goal) {
					throw new NodeOperationError(this.getNode(), 'Goal is required');
				}

				// Check for resume from human intervention (from input data)
				const inputItem = items[i].json;
				let resumeOptions:
					| {
							previousActions: PlaywrightAction[];
							humanCorrection?: HumanCorrection;
							resumeUrl?: string;
					  }
					| undefined;

				// If input contains previousActions, we're resuming from human intervention
				if (inputItem.playwrightActions && Array.isArray(inputItem.playwrightActions)) {
					console.log('[BrowserAgent] Resuming from human intervention');
					resumeOptions = {
						previousActions: inputItem.playwrightActions as PlaywrightAction[],
						resumeUrl: (inputItem.humanHelpContext as { currentUrl?: string })?.currentUrl,
					};

					// Check for human correction in input
					if (inputItem.humanCorrection) {
						resumeOptions.humanCorrection = inputItem.humanCorrection as HumanCorrection;
					}
				}

				// Extract data context from input (resume data, custom data)
				let dataContext: DataContext | undefined;
				if (inputItem.resume || inputItem.customData) {
					console.log('[BrowserAgent] Data context detected in input');
					dataContext = {
						resume: inputItem.resume as DataContext['resume'],
						customData: inputItem.customData as Record<string, string>,
					};
				}

				// Execute the browser agent (always learn mode - no cache)
				const result = await executeGoal(this, goal, {
					browserOptions: {
						headless: browserOptions.headless ?? false,
						maxSteps: browserOptions.maxSteps ?? 20,
						timeout: browserOptions.timeout ?? 10000,
						maxRetries: browserOptions.maxRetries ?? 3,
						proxyUrl: browserOptions.proxyUrl || undefined,
						saveCookies: browserOptions.saveCookies ?? false,
						humanDelay: browserOptions.humanDelay ?? true,
						humanDelayMin: browserOptions.humanDelayMin ?? 100,
						humanDelayMax: browserOptions.humanDelayMax ?? 500,
						planningInterval: browserOptions.planningInterval ?? 3,
						maxActionsPerStep: browserOptions.maxActionsPerStep ?? 10,
					},
					visionOptions: {
						enabled: visionOptions.enabled ?? true,
						screenshotType: 'viewport',
					},
					outputOptions: {
						includeScreenshots: outputOptions.includeScreenshots ?? false,
					},
					dataContext,
					resumeOptions,
				});

				// Extract domain from first navigate action
				const firstNavigate = result.playwrightActions.find((a) => a.operation === 'navigate');
				const domain = firstNavigate?.url
					? new URL(firstNavigate.url).hostname.replace('www.', '')
					: 'unknown';

				// Detect parameters from fill actions (fields that likely need user input)
				const detectedParams: string[] = [];
				for (const action of result.playwrightActions) {
					if (action.operation === 'fill' && action.valueSource?.type === 'expression') {
						// Extract param name from expression like {{ $json.resume.email }}
						const match = action.valueSource.expression?.match(/\$json\.(?:resume\.)?(\w+)/);
						if (match && !detectedParams.includes(match[1])) {
							detectedParams.push(match[1]);
						}
					} else if (action.operation === 'fill' && action.valueSource?.fieldType) {
						// Use fieldType as param hint (email, password, etc.)
						if (!detectedParams.includes(action.valueSource.fieldType)) {
							detectedParams.push(action.valueSource.fieldType);
						}
					}
				}

				// Prepare output with pipeline structure for Pipeline Generator
				const outputItem: INodeExecutionData = {
					json: {
						success: result.success,
						result: result.result,
						error: result.error,
						executionTime: result.executionTime,
						aiCallsCount: result.aiCallsCount,
						actionCount: result.actions.length,

						// Pipeline structure for Pipeline Generator node
						pipeline: {
							domain,
							originalGoal: goal,
							goalPattern: goal, // Could be enhanced to replace values with placeholders
							params: detectedParams,
							steps: result.playwrightActions,
						},

						// Also keep raw playwrightActions for backward compatibility
						playwrightActions: result.playwrightActions,

						// Raw action log for debugging
						actions: result.actions.map((action) => ({
							operation: action.operation,
							index: action.index,
							selector: action.selector,
							value: action.value,
							success: action.success,
							reasoning: action.reasoning,
						})),

						// Human-in-the-loop context when AI is stuck
						...(result.needsHumanHelp
							? {
									needsHumanHelp: true,
									humanHelpContext: {
										currentUrl: result.humanHelpContext?.currentUrl,
										currentTitle: result.humanHelpContext?.currentTitle,
										elementCount: result.humanHelpContext?.elements?.length,
										lastError: result.humanHelpContext?.lastError,
										suggestedAction: result.humanHelpContext?.suggestedAction,
									},
								}
							: {}),
					},
				};

				// Add final screenshot as binary if available
				if (result.finalScreenshot) {
					outputItem.binary = {
						screenshot: {
							data: result.finalScreenshot,
							mimeType: 'image/png',
							fileName: 'final_screenshot.png',
						},
					};
				}

				// Add human help screenshot if needs assistance
				if (result.needsHumanHelp && result.humanHelpContext?.screenshot) {
					outputItem.binary = {
						...outputItem.binary,
						helpScreenshot: {
							data: result.humanHelpContext.screenshot,
							mimeType: 'image/png',
							fileName: 'needs_help_screenshot.png',
						},
					};
				}

				// Add playwrightActions as downloadable JSON
				if (result.playwrightActions.length > 0) {
					const actionsJson = JSON.stringify(result.playwrightActions, null, 2);
					outputItem.binary = {
						...outputItem.binary,
						playwrightActions: {
							data: Buffer.from(actionsJson).toString('base64'),
							mimeType: 'application/json',
							fileName: 'playwright-actions.json',
						},
					};
				}

				returnData.push(outputItem);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
							error: error instanceof Error ? error.message : String(error),
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
