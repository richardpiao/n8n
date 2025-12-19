import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

export const description: INodeProperties[] = [
	{
		displayName: 'Duration (ms)',
		name: 'duration',
		type: 'number',
		default: 1000,
		required: true,
		description: 'Time to wait in milliseconds',
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForTimeout'],
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
	const duration = this.getNodeParameter('duration', index) as number;

	const page = await browserPool.getPage(sessionId, pageId);

	await page.waitForTimeout(duration);

	return [
		{
			json: {
				sessionId,
				pageId,
				duration,
				message: `Waited ${duration}ms`,
			},
		},
	];
}
