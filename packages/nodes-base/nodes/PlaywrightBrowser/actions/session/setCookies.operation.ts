import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

export const description: INodeProperties[] = [
	{
		displayName: 'Cookies',
		name: 'cookies',
		type: 'json',
		default: '[]',
		required: true,
		description: 'Array of cookie objects to set',
		placeholder: '[{"name": "session", "value": "abc123", "domain": ".example.com", "path": "/"}]',
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['setCookies'],
			},
		},
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const cookiesJson = this.getNodeParameter('cookies', index) as string;

	const context = await browserPool.getContext(sessionId);

	let cookies: Array<{
		name: string;
		value: string;
		domain?: string;
		path?: string;
		expires?: number;
		httpOnly?: boolean;
		secure?: boolean;
		sameSite?: 'Strict' | 'Lax' | 'None';
	}>;

	if (typeof cookiesJson === 'string') {
		cookies = JSON.parse(cookiesJson);
	} else {
		cookies = cookiesJson as typeof cookies;
	}

	await context.addCookies(cookies);

	return [
		{
			json: {
				sessionId,
				cookiesSet: cookies.length,
				message: 'Cookies set successfully',
			},
		},
	];
}
