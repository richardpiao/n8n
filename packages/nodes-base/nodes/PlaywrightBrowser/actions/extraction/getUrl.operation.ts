import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

export const description: INodeProperties[] = [];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;

	const page = await browserPool.getPage(sessionId, pageId);

	return [
		{
			json: {
				sessionId,
				pageId,
				url: page.url(),
				title: await page.title(),
			},
		},
	];
}
