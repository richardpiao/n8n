import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	INodeExecutionData,
	INodeInputConfiguration,
} from 'n8n-workflow';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// Input index for Chat Model
export const INPUT_CHAT_MODEL = 0;

function getInputs(): Array<INodeInputConfiguration> {
	return [
		// 1. Main input (optional - for pipeline conversion mode)
		{ type: NodeConnectionTypes.Main },

		// 2. Chat Model for workflow generation (REQUIRED)
		{
			type: NodeConnectionTypes.AiLanguageModel,
			displayName: 'Chat Model',
			required: true,
			maxConnections: 1,
		},
	];
}

export class AIWorkflowGenerator implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AI Workflow Generator',
		name: 'aiWorkflowGenerator',
		icon: 'fa:magic',
		group: ['transform'],
		version: 1,
		subtitle: 'Generate n8n Workflows with AI',
		description:
			'Use AI (GPT/Claude) to generate n8n workflows from natural language descriptions or convert Browser Agent pipelines into optimized workflows.',
		defaults: {
			name: 'AI Workflow Generator',
		},
		inputs: `={{ ((parameters) => { return ${JSON.stringify(getInputs())}; })($parameter) }}`,
		outputs: [NodeConnectionTypes.Main],
		properties: [
			// === MODE SELECTION ===
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				default: 'generate',
				options: [
					{
						name: 'Generate from Description',
						value: 'generate',
						description: 'Create a workflow from natural language description',
					},
					{
						name: 'Convert Pipeline',
						value: 'convert',
						description: 'Convert Browser Agent pipeline to optimized n8n workflow',
					},
				],
			},

			// === GENERATE MODE OPTIONS ===
			{
				displayName: 'Workflow Description',
				name: 'description',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: '',
				required: true,
				placeholder:
					'e.g., Create a workflow that fetches data from a REST API every hour, transforms the JSON, and saves it to Google Sheets',
				description: 'Describe what you want the workflow to do in natural language',
				displayOptions: {
					show: {
						mode: ['generate'],
					},
				},
			},

			// === WORKFLOW OPTIONS ===
			{
				displayName: 'Workflow Name',
				name: 'workflowName',
				type: 'string',
				default: '',
				placeholder: 'e.g., My Automated Workflow',
				description: 'Name for the generated workflow',
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
						description: 'Whether to add error handling nodes',
					},
					{
						displayName: 'Add Comments',
						name: 'addComments',
						type: 'boolean',
						default: true,
						description: 'Whether to add sticky notes explaining the workflow',
					},
				],
			},

			// === WORKFLOW CREATION OPTIONS ===
			{
				displayName: 'Create Workflow in n8n',
				name: 'createInN8n',
				type: 'boolean',
				default: false,
				description:
					'Whether to automatically create the workflow in your n8n instance via REST API (requires API key from Settings → API). Free for self-hosted instances.',
			},
			{
				displayName: 'n8n API Key',
				name: 'apiKey',
				type: 'string',
				typeOptions: {
					password: true,
				},
				default: '',
				description: 'API key from n8n Settings → API (free for self-hosted instances)',
				displayOptions: {
					show: {
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
						createInN8n: [true],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get connected LLM
		const llm = (await this.getInputConnectionData(
			NodeConnectionTypes.AiLanguageModel,
			INPUT_CHAT_MODEL,
		)) as BaseChatModel;

		if (!llm) {
			throw new NodeOperationError(
				this.getNode(),
				'Chat Model is required for workflow generation',
			);
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const mode = this.getNodeParameter('mode', i) as string;
				const workflowName = this.getNodeParameter('workflowName', i, '') as string;
				const options = this.getNodeParameter('options', i, {}) as {
					includeErrorHandling?: boolean;
					addComments?: boolean;
				};

				let generatedWorkflow: GeneratedWorkflow;

				if (mode === 'generate') {
					// Generate from natural language description
					const description = this.getNodeParameter('description', i) as string;

					if (!description) {
						throw new NodeOperationError(this.getNode(), 'Workflow description is required');
					}

					generatedWorkflow = await generateWorkflowFromDescription(
						llm,
						description,
						workflowName,
						options,
					);
				} else {
					// Convert from pipeline
					const pipeline = items[i].json.pipeline as PipelineInput | undefined;

					if (!pipeline || !pipeline.steps) {
						throw new NodeOperationError(
							this.getNode(),
							'No pipeline data found in input. Connect Browser Agent output or switch to Generate mode.',
						);
					}

					generatedWorkflow = await convertPipelineToWorkflow(
						llm,
						pipeline,
						workflowName || pipeline.domain?.replace(/\./g, '_') || 'converted_workflow',
						options,
					);
				}

				// Prepare output
				const outputItem: INodeExecutionData = {
					json: {
						success: true,
						workflowName: generatedWorkflow.name,
						nodesCount: generatedWorkflow.nodes.length,
						generatedAt: new Date().toISOString(),
						// The complete workflow data
						workflow: {
							name: generatedWorkflow.name,
							nodes: generatedWorkflow.nodes,
							connections: generatedWorkflow.connections,
							settings: {
								executionOrder: 'v1',
							},
						},
					},
					binary: {},
				};

				// Create workflow via n8n REST API if enabled
				const createInN8n = this.getNodeParameter('createInN8n', i, false) as boolean;
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
								name: generatedWorkflow.name,
								nodes: generatedWorkflow.nodes,
								connections: generatedWorkflow.connections,
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

				// Add as downloadable JSON file
				const workflowJson = JSON.stringify(
					{
						name: generatedWorkflow.name,
						nodes: generatedWorkflow.nodes,
						connections: generatedWorkflow.connections,
						settings: { executionOrder: 'v1' },
					},
					null,
					2,
				);

				outputItem.binary!.workflow = await this.helpers.prepareBinaryData(
					Buffer.from(workflowJson, 'utf-8'),
					`${generatedWorkflow.name.replace(/\s+/g, '_')}_workflow.json`,
					'application/json',
				);

				returnData.push(outputItem);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							success: false,
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

// Types
interface PipelineInput {
	domain?: string;
	originalGoal?: string;
	steps: Array<{
		operation: string;
		selector?: string;
		value?: string;
		url?: string;
		description?: string;
		[key: string]: unknown;
	}>;
}

interface GeneratedWorkflow {
	name: string;
	nodes: WorkflowNode[];
	connections: Record<string, unknown>;
}

interface WorkflowNode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
}

// System prompt for workflow generation
const WORKFLOW_GENERATION_PROMPT = `You are an expert n8n workflow designer. Generate n8n workflow JSON based on user requirements.

IMPORTANT RULES:
1. Generate valid n8n workflow JSON with nodes and connections
2. Use real n8n node types (e.g., n8n-nodes-base.httpRequest, n8n-nodes-base.set, n8n-nodes-base.if)
3. Each node must have: id, name, type, typeVersion, position, parameters
4. Connections use the format: { "NodeName": { "main": [[{ "node": "NextNodeName", "type": "main", "index": 0 }]] } }
5. Position nodes horizontally with ~200px spacing
6. Include a trigger node (e.g., n8n-nodes-base.manualTrigger, n8n-nodes-base.scheduleTrigger)

COMMON NODE TYPES:
- n8n-nodes-base.manualTrigger - Manual trigger to start workflow
- n8n-nodes-base.scheduleTrigger - Schedule-based trigger (cron)
- n8n-nodes-base.httpRequest - Make HTTP requests
- n8n-nodes-base.set - Set/transform data
- n8n-nodes-base.if - Conditional logic
- n8n-nodes-base.switch - Multiple conditions
- n8n-nodes-base.code - Custom JavaScript code
- n8n-nodes-base.merge - Merge data from multiple branches
- n8n-nodes-base.splitInBatches - Process items in batches
- n8n-nodes-base.wait - Wait/delay
- n8n-nodes-base.noOp - No operation (for branching)

OUTPUT FORMAT:
Return ONLY valid JSON with this structure:
{
  "name": "Workflow Name",
  "nodes": [...],
  "connections": {...}
}

Do not include any explanation or markdown - just the JSON.`;

/**
 * Generate workflow from natural language description
 */
async function generateWorkflowFromDescription(
	llm: BaseChatModel,
	description: string,
	workflowName: string,
	options: { includeErrorHandling?: boolean; addComments?: boolean },
): Promise<GeneratedWorkflow> {
	const userPrompt = buildGenerationPrompt(description, workflowName, options);

	const messages = [new SystemMessage(WORKFLOW_GENERATION_PROMPT), new HumanMessage(userPrompt)];

	const response = await llm.invoke(messages);

	// Extract content from response
	let content =
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
	const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		content = codeBlockMatch[1].trim();
	}

	// Parse the JSON
	try {
		const workflow = JSON.parse(content) as GeneratedWorkflow;
		return {
			name: workflow.name || workflowName || 'Generated Workflow',
			nodes: workflow.nodes || [],
			connections: workflow.connections || {},
		};
	} catch {
		throw new Error('Failed to parse AI response as valid workflow JSON');
	}
}

/**
 * Convert Browser Agent pipeline to optimized n8n workflow
 */
async function convertPipelineToWorkflow(
	llm: BaseChatModel,
	pipeline: PipelineInput,
	workflowName: string,
	options: { includeErrorHandling?: boolean; addComments?: boolean },
): Promise<GeneratedWorkflow> {
	const conversionPrompt = `Convert this Browser Agent pipeline into an optimized n8n workflow using PlaywrightBrowser nodes.

PIPELINE:
Domain: ${pipeline.domain || 'unknown'}
Goal: ${pipeline.originalGoal || 'Browser automation'}
Steps:
${pipeline.steps.map((step, i) => `${i + 1}. ${step.operation}${step.selector ? ` on "${step.selector}"` : ''}${step.value ? ` with value "${step.value}"` : ''}${step.url ? ` url: ${step.url}` : ''}${step.description ? ` - ${step.description}` : ''}`).join('\n')}

REQUIREMENTS:
- Use n8n-nodes-base.playwrightBrowser node for browser actions
- Start with session/start operation
- End with session/close operation
- Map operations: navigate->page/goto, click->interaction/click, fill->interaction/fill, etc.
- Include sessionId and pageId expressions: {{ $json.sessionId }}, {{ $json.pageId }}
${options.includeErrorHandling ? '- Add error handling' : ''}
${options.addComments ? '- Add descriptive node names' : ''}

Generate the complete n8n workflow JSON:`;

	const messages = [
		new SystemMessage(WORKFLOW_GENERATION_PROMPT),
		new HumanMessage(conversionPrompt),
	];

	const response = await llm.invoke(messages);

	let content =
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

	const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		content = codeBlockMatch[1].trim();
	}

	try {
		const workflow = JSON.parse(content) as GeneratedWorkflow;
		return {
			name: workflow.name || workflowName,
			nodes: workflow.nodes || [],
			connections: workflow.connections || {},
		};
	} catch {
		throw new Error('Failed to parse AI response as valid workflow JSON');
	}
}

/**
 * Build the user prompt for workflow generation
 */
function buildGenerationPrompt(
	description: string,
	workflowName: string,
	options: { includeErrorHandling?: boolean; addComments?: boolean },
): string {
	const lines: string[] = [];

	lines.push('Generate an n8n workflow based on this description:');
	lines.push('');
	lines.push(`Description: ${description}`);
	lines.push('');

	if (workflowName) {
		lines.push(`Workflow Name: ${workflowName}`);
	}

	lines.push('');
	lines.push('Requirements:');
	if (options.includeErrorHandling) {
		lines.push('- Include error handling (try/catch patterns where appropriate)');
	}
	if (options.addComments) {
		lines.push('- Use descriptive node names that explain what each node does');
	}
	lines.push('- Start with an appropriate trigger node');
	lines.push('- Ensure all nodes are properly connected');
	lines.push('');
	lines.push('Generate the complete workflow JSON now:');

	return lines.join('\n');
}
