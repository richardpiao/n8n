import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { timeoutField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		displayName: 'JavaScript Function',
		name: 'function',
		type: 'string',
		typeOptions: {
			rows: 3,
		},
		default: 'return document.readyState === "complete";',
		required: true,
		placeholder: 'return document.querySelector(".loaded") !== null;',
		description: 'JavaScript function that returns true when condition is met',
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForFunction'],
			},
		},
	},
	{
		displayName: 'Polling Interval (ms)',
		name: 'polling',
		type: 'number',
		default: 100,
		description: 'Interval between function evaluations',
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForFunction'],
			},
		},
	},
	{
		...timeoutField,
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForFunction'],
			},
		},
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;
	const func = this.getNodeParameter('function', index) as string;
	const polling = this.getNodeParameter('polling', index, 100) as number;
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;

	const page = await browserPool.getPage(sessionId, pageId);

	// Wrap function if needed
	const wrappedFunc = func.trim().startsWith('return') ? `(function() { ${func} })()` : func;

	await page.waitForFunction(wrappedFunc, { polling, timeout });

	return [
		{
			json: {
				sessionId,
				pageId,
				message: 'Function condition met',
			},
		},
	];
}
