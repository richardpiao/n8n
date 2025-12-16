import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

export const description: INodeProperties[] = [
	{
		displayName: 'Filter by URL',
		name: 'filterUrl',
		type: 'string',
		default: '',
		placeholder: 'https://linkedin.com',
		description: 'Only return cookies matching this URL (leave empty for all)',
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['getCookies'],
			},
		},
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const filterUrl = this.getNodeParameter('filterUrl', index, '') as string;

	const context = await browserPool.getContext(sessionId);

	let cookies;
	if (filterUrl) {
		cookies = await context.cookies(filterUrl);
	} else {
		cookies = await context.cookies();
	}

	return [
		{
			json: {
				sessionId,
				cookies,
				count: cookies.length,
			},
		},
	];
}
