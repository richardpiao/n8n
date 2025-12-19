import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { loadStateField, timeoutField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...loadStateField,
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForNavigation'],
			},
		},
	},
	{
		...timeoutField,
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForNavigation'],
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
	const waitUntil = this.getNodeParameter('waitUntil', index, 'load') as
		| 'load'
		| 'domcontentloaded'
		| 'networkidle';
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;

	const page = await browserPool.getPage(sessionId, pageId);

	await page.waitForLoadState(waitUntil, { timeout });

	return [
		{
			json: {
				sessionId,
				pageId,
				waitUntil,
				url: page.url(),
				title: await page.title(),
				message: 'Navigation complete',
			},
		},
	];
}
