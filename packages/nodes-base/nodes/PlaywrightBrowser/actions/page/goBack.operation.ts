import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { loadStateField, timeoutField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['page'],
				operation: ['goBack'],
			},
		},
		options: [loadStateField, timeoutField],
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;
	const options = this.getNodeParameter('options', index, {}) as {
		waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
		timeout?: number;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	const response = await page.goBack({
		waitUntil: options.waitUntil || 'load',
		timeout: options.timeout || 30000,
	});

	return [
		{
			json: {
				sessionId,
				pageId,
				url: page.url(),
				title: await page.title(),
				status: response?.status() || null,
				message: response ? 'Navigated back successfully' : 'No previous page in history',
			},
		},
	];
}
