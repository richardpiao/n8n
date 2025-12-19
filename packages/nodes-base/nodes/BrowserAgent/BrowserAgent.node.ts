import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	INodeInputConfiguration,
} from 'n8n-workflow';

import { executeGoal } from './utils/executionLoop';

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
			'AI-powered browser automation. Give it a natural language goal and it will autonomously navigate, click, fill forms, and complete tasks using Playwright.',
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
				default: {},
				options: [
					{
						displayName: 'Headless',
						name: 'headless',
						type: 'boolean',
						default: true,
						description: 'Whether to run the browser without a visible window',
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
						default: 30000,
						description: 'Maximum time (in ms) to wait for each action',
						typeOptions: {
							minValue: 1000,
							maxValue: 120000,
						},
					},
					{
						displayName: 'Human-Like Delays',
						name: 'humanDelays',
						type: 'boolean',
						default: true,
						description: 'Whether to add random delays between actions to appear more human',
					},
				],
			},

			// === VISION OPTIONS (uses same Chat Model) ===
			{
				displayName: 'Vision Options',
				name: 'visionOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				description:
					'Uses the connected Chat Model for vision (requires vision-capable model like GPT-4o)',
				options: [
					{
						displayName: 'Enable Vision',
						name: 'enabled',
						type: 'boolean',
						default: true,
						description: 'Whether to use screenshot analysis when scraping is insufficient',
					},
					{
						displayName: 'Screenshot Type',
						name: 'screenshotType',
						type: 'options',
						options: [
							{
								name: 'Full Page',
								value: 'fullPage',
							},
							{
								name: 'Viewport Only',
								value: 'viewport',
							},
						],
						default: 'viewport',
						description: 'Type of screenshot to take for vision analysis',
					},
				],
			},

			// === CACHE OPTIONS (local file storage) ===
			{
				displayName: 'Cache Options',
				name: 'cacheOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				description: 'Pipeline caching saves successful action sequences for faster replay',
				options: [
					{
						displayName: 'Enable Cache',
						name: 'enabled',
						type: 'boolean',
						default: true,
						description: 'Whether to cache and replay successful pipelines',
					},
					{
						displayName: 'Auto-Save',
						name: 'autoSave',
						type: 'boolean',
						default: true,
						description: 'Whether to automatically save successful pipelines to cache',
					},
				],
			},

			// === OUTPUT OPTIONS ===
			{
				displayName: 'Output Options',
				name: 'outputOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Export Pipeline JSON',
						name: 'exportPipeline',
						type: 'boolean',
						default: true,
						description: 'Whether to include the learned pipeline JSON in the output',
					},
					{
						displayName: 'Include Screenshots',
						name: 'includeScreenshots',
						type: 'boolean',
						default: true,
						description: 'Whether to capture screenshots after each action',
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
					humanDelays?: boolean;
				};
				const visionOptions = this.getNodeParameter('visionOptions', i, {}) as {
					enabled?: boolean;
					screenshotType?: 'fullPage' | 'viewport';
				};
				const cacheOptions = this.getNodeParameter('cacheOptions', i, {}) as {
					enabled?: boolean;
					autoSave?: boolean;
				};
				const outputOptions = this.getNodeParameter('outputOptions', i, {}) as {
					exportPipeline?: boolean;
					includeScreenshots?: boolean;
				};

				if (!goal) {
					throw new NodeOperationError(this.getNode(), 'Goal is required');
				}

				// Execute the browser agent
				const result = await executeGoal(this, goal, {
					browserOptions: {
						headless: browserOptions.headless ?? true,
						maxSteps: browserOptions.maxSteps ?? 20,
						timeout: browserOptions.timeout ?? 30000,
						humanDelays: browserOptions.humanDelays ?? true,
					},
					visionOptions: {
						enabled: visionOptions.enabled ?? true,
						screenshotType: visionOptions.screenshotType ?? 'viewport',
					},
					cacheOptions: {
						enabled: cacheOptions.enabled ?? true,
						autoSave: cacheOptions.autoSave ?? true,
					},
					outputOptions: {
						exportPipeline: outputOptions.exportPipeline ?? true,
						includeScreenshots: outputOptions.includeScreenshots ?? true,
					},
				});

				// Prepare output
				const outputItem: INodeExecutionData = {
					json: {
						success: result.success,
						result: result.result,
						error: result.error,
						executionTime: result.executionTime,
						mode: result.mode,
						aiCallsCount: result.aiCallsCount,
						actionCount: result.actions.length,
						actions: result.actions.map((action) => ({
							operation: action.operation,
							selector: action.selector,
							value: action.value,
							success: action.success,
							reasoning: action.reasoning,
							usedAI: action.usedAI,
						})),
						// Include pipeline if export is enabled
						...(outputOptions.exportPipeline && result.pipeline
							? { pipeline: result.pipeline }
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

				// Add pipeline as downloadable JSON if export is enabled
				if (outputOptions.exportPipeline && result.pipeline) {
					const pipelineJson = JSON.stringify(result.pipeline, null, 2);
					outputItem.binary = {
						...outputItem.binary,
						pipeline: {
							data: Buffer.from(pipelineJson).toString('base64'),
							mimeType: 'application/json',
							fileName: `${result.pipeline.domain}-pipeline.json`,
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
