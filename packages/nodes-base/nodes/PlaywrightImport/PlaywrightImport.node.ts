import { NodeConnectionTypes } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { generateWorkflowJson } from './utils/recordingParser';

export class PlaywrightImport implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Playwright Import',
		name: 'playwrightImport',
		icon: 'file:playwrightImport.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Convert CRX recording to workflow',
		description:
			'Import Playwright Chrome Extension recordings and convert them to n8n workflow JSON that can be pasted into the canvas.',
		defaults: {
			name: 'Playwright Import',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Recording Input',
				name: 'recordingInput',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				required: true,
				placeholder: `{"browserName":"chromium","launchOptions":{"headless":false},"contextOptions":{}}
{"name":"openPage","url":"https://example.com",...}
{"name":"click","selector":"#button",...}`,
				description:
					'Paste the Playwright CRX recording here. Each line should be a JSON object representing an action.',
			},
			{
				displayName: 'Workflow Name',
				name: 'workflowName',
				type: 'string',
				default: 'Playwright Recording',
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
						displayName: 'Start X Position',
						name: 'startX',
						type: 'number',
						default: 250,
						description: 'Starting X coordinate for the first node on the canvas',
					},
					{
						displayName: 'Start Y Position',
						name: 'startY',
						type: 'number',
						default: 300,
						description: 'Starting Y coordinate for the first node on the canvas',
					},
					{
						displayName: 'Node Spacing',
						name: 'nodeSpacing',
						type: 'number',
						default: 200,
						description: 'Horizontal spacing between nodes in pixels',
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
				const recordingInput = this.getNodeParameter('recordingInput', i, '') as string;
				const workflowName = this.getNodeParameter(
					'workflowName',
					i,
					'Playwright Recording',
				) as string;
				const options = this.getNodeParameter('options', i, {}) as {
					startX?: number;
					startY?: number;
					nodeSpacing?: number;
				};

				if (!recordingInput.trim()) {
					throw new Error('Recording input is empty. Please paste a Playwright CRX recording.');
				}

				const workflow = generateWorkflowJson(recordingInput, {
					workflowName,
					startX: options.startX,
					startY: options.startY,
					nodeSpacing: options.nodeSpacing,
				});

				// Output clean workflow format that n8n expects for pasting
				returnData.push({
					json: {
						nodes: workflow.nodes,
						connections: workflow.connections,
						meta: {},
					},
				});
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
