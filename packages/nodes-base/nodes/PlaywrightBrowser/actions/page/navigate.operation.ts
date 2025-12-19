import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { applyHumanDelay } from '../../utils/humanDelay';
import { urlField, loadStateField, timeoutField, humanDelayFields } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...urlField,
		required: true,
		displayOptions: {
			show: {
				resource: ['page'],
				operation: ['navigate'],
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['page'],
				operation: ['navigate'],
			},
		},
		options: [loadStateField, timeoutField, humanDelayFields],
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;
	const url = this.getNodeParameter('url', index) as string;
	const options = this.getNodeParameter('options', index, {}) as {
		waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
		timeout?: number;
		humanDelay?: { enabled?: boolean; min?: number; max?: number };
	};

	const page = await browserPool.getPage(sessionId, pageId);

	// Apply human-like delay before navigation
	if (options.humanDelay?.enabled !== false) {
		await applyHumanDelay(options.humanDelay);
	}

	const response = await page.goto(url, {
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
				message: 'Navigation successful',
			},
		},
	];
}
