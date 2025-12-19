import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	INodeInputConfiguration,
} from 'n8n-workflow';

import { generatePlaywrightScript, generateSubWorkflow } from './utils/codeGenerator';

// Input index for Chat Model
export const INPUT_CHAT_MODEL = 0;

function getInputs(): Array<INodeInputConfiguration> {
	return [
		// 1. Main input (pipeline JSON from Browser Agent)
		{ type: NodeConnectionTypes.Main },

		// 2. Chat Model for code generation (REQUIRED)
		{
			type: NodeConnectionTypes.AiLanguageModel,
			displayName: 'Chat Model',
			required: true,
			maxConnections: 1,
		},
	];
}

export class PipelineGenerator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Pipeline Generator',
		name: 'pipelineGenerator',
		icon: 'file:PipelineGenerator.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Generate Playwright Scripts',
		description:
			'Takes Browser Agent pipeline output and generates dedicated Playwright TypeScript scripts that run without AI (except for dynamic form fields).',
		defaults: {
			name: 'Pipeline Generator',
		},
		inputs: `={{ ((parameters) => { return ${JSON.stringify(getInputs())}; })($parameter) }}`,
		outputs: [NodeConnectionTypes.Main],
		properties: [
			// === GENERATION OPTIONS ===
			{
				displayName: 'Script Name',
				name: 'scriptName',
				type: 'string',
				default: '',
				placeholder: 'e.g., linkedin_job_apply',
				description: 'Name for the generated script (used in filename and function names)',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				default: 'typescript',
				options: [
					{
						name: 'TypeScript',
						value: 'typescript',
						description: 'Generate .ts file with full type safety',
					},
					{
						name: 'JavaScript',
						value: 'javascript',
						description: 'Generate .js file (CommonJS)',
					},
					{
						name: 'JSON Pipeline',
						value: 'json',
						description: 'Output structured JSON (for n8n reuse)',
					},
					{
						name: 'n8n Workflow',
						value: 'workflow',
						description: 'Generate n8n sub-workflow with PlaywrightBrowser nodes',
					},
				],
			},
			{
				displayName: 'Create Workflow in n8n',
				name: 'createInN8n',
				type: 'boolean',
				default: false,
				description:
					'Whether to automatically create the workflow in your n8n instance via REST API (requires API key from Settings → API)',
				displayOptions: {
					show: {
						outputFormat: ['workflow'],
					},
				},
			},
			{
				displayName: 'n8n API Key',
				name: 'apiKey',
				type: 'string',
				typeOptions: {
					password: true,
				},
				default: '',
				description: 'API key from n8n Settings → API (free for self-hosted)',
				displayOptions: {
					show: {
						outputFormat: ['workflow'],
						createInN8n: [true],
					},
				},
			},
			{
				displayName: 'n8n Base URL',
				name: 'baseUrl',
				type: 'string',
				default: 'http://localhost:5678',
				description: 'Base URL of your n8n instance',
				displayOptions: {
					show: {
						outputFormat: ['workflow'],
						createInN8n: [true],
					},
				},
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Error Handling',
						name: 'includeErrorHandling',
						type: 'boolean',
						default: true,
						description: 'Whether to add try-catch and retry logic',
					},
					{
						displayName: 'Parameterize Inputs',
						name: 'parameterizeInputs',
						type: 'boolean',
						default: true,
						description:
							'Whether to extract dynamic values (username, password, search terms) as parameters',
					},
					{
						displayName: 'Add Human Delays',
						name: 'addHumanDelays',
						type: 'boolean',
						default: true,
						description: 'Whether to add random delays between actions to appear more human',
					},
					{
						displayName: 'Generate Loop Support',
						name: 'generateLoopSupport',
						type: 'boolean',
						default: false,
						description:
							'Whether to add loop support for repetitive actions (e.g., apply to multiple jobs)',
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
				// Get pipeline from input
				const pipeline = items[i].json.pipeline as {
					domain: string;
					goalPattern: string;
					originalGoal: string;
					params: string[];
					steps: Array<{
						type: string;
						operation: string;
						selector?: string;
						value?: string;
						url?: string;
						description?: string;
						param?: string;
					}>;
				};

				if (!pipeline || !pipeline.steps) {
					throw new NodeOperationError(
						this.getNode(),
						'No pipeline data found in input. Connect this node to Browser Agent output.',
					);
				}

				// Get options
				const scriptName = this.getNodeParameter('scriptName', i, '') as string;
				const outputFormat = this.getNodeParameter('outputFormat', i, 'typescript') as string;
				const options = this.getNodeParameter('options', i, {}) as {
					includeErrorHandling?: boolean;
					parameterizeInputs?: boolean;
					addHumanDelays?: boolean;
					generateLoopSupport?: boolean;
				};

				const workflowName = scriptName || pipeline.domain.replace(/\./g, '_');

				// Handle n8n Workflow format differently (no AI needed)
				if (outputFormat === 'workflow') {
					const subWorkflow = generateSubWorkflow(pipeline, workflowName);
					const createInN8n = this.getNodeParameter('createInN8n', i, false) as boolean;

					const outputItem: INodeExecutionData = {
						json: {
							scriptName: workflowName,
							outputFormat,
							domain: pipeline.domain,
							originalGoal: pipeline.originalGoal,
							stepsCount: pipeline.steps.length,
							parameters: pipeline.params,
							generatedAt: new Date().toISOString(),
							// Sub-workflow data for rendering on canvas
							workflow: {
								name: subWorkflow.name,
								nodes: subWorkflow.nodes,
								connections: subWorkflow.connections,
							},
						},
						binary: {},
					};

					// Create workflow via n8n REST API if enabled
					if (createInN8n) {
						const apiKey = this.getNodeParameter('apiKey', i, '') as string;
						const baseUrl = this.getNodeParameter('baseUrl', i, 'http://localhost:5678') as string;

						if (!apiKey) {
							throw new NodeOperationError(
								this.getNode(),
								'API Key is required to create workflow in n8n. Generate one in Settings → API.',
							);
						}

						try {
							// Create the workflow via n8n REST API
							const response = await this.helpers.httpRequest({
								method: 'POST',
								url: `${baseUrl}/api/v1/workflows`,
								headers: {
									'X-N8N-API-KEY': apiKey,
									'Content-Type': 'application/json',
								},
								body: {
									name: subWorkflow.name,
									nodes: subWorkflow.nodes,
									connections: subWorkflow.connections,
									settings: {
										executionOrder: 'v1',
									},
								},
								json: true,
							});

							outputItem.json.createdWorkflow = {
								id: response.id,
								name: response.name,
								url: `${baseUrl}/workflow/${response.id}`,
								message: 'Workflow created successfully! Open the URL to view it.',
							};
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							outputItem.json.createError = `Failed to create workflow: ${errorMessage}`;
						}
					}

					// Also add as downloadable JSON file
					const workflowJson = JSON.stringify(subWorkflow, null, 2);
					outputItem.binary!.workflow = await this.helpers.prepareBinaryData(
						Buffer.from(workflowJson, 'utf-8'),
						`${workflowName}_workflow.json`,
						'application/json',
					);

					returnData.push(outputItem);
					continue;
				}

				// Generate script using AI for other formats
				const generatedCode = await generatePlaywrightScript(this, pipeline, {
					scriptName: workflowName,
					outputFormat,
					includeErrorHandling: options.includeErrorHandling ?? true,
					parameterizeInputs: options.parameterizeInputs ?? true,
					addHumanDelays: options.addHumanDelays ?? true,
					generateLoopSupport: options.generateLoopSupport ?? false,
				});

				// Prepare output
				const outputItem: INodeExecutionData = {
					json: {
						scriptName: workflowName,
						outputFormat,
						domain: pipeline.domain,
						originalGoal: pipeline.originalGoal,
						stepsCount: pipeline.steps.length,
						parameters: pipeline.params,
						generatedAt: new Date().toISOString(),
					},
					binary: {},
				};

				// Add generated code as binary file
				const extension =
					outputFormat === 'typescript' ? 'ts' : outputFormat === 'javascript' ? 'js' : 'json';
				const filename = `${workflowName}.${extension}`;

				outputItem.binary!.script = await this.helpers.prepareBinaryData(
					Buffer.from(generatedCode, 'utf-8'),
					filename,
					outputFormat === 'json' ? 'application/json' : 'text/plain',
				);

				// Also include code in JSON for easy viewing
				outputItem.json.code = generatedCode;

				returnData.push(outputItem);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : 'Unknown error',
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
