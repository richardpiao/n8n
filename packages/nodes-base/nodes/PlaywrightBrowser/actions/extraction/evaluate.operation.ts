import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

export const description: INodeProperties[] = [
	{
		displayName: 'JavaScript Code',
		name: 'code',
		type: 'string',
		typeOptions: {
			rows: 5,
		},
		default: 'return document.title;',
		required: true,
		description: 'JavaScript code to execute in the page context. Use "return" to return a value.',
		placeholder: 'return document.querySelectorAll("a").length;',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['evaluate'],
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
	const code = this.getNodeParameter('code', index) as string;

	const page = await browserPool.getPage(sessionId, pageId);

	// Wrap code in a function if it doesn't already return
	const wrappedCode = code.trim().startsWith('return') ? `(function() { ${code} })()` : code;

	const result: unknown = await page.evaluate(wrappedCode);

	return [
		{
			json: {
				sessionId,
				pageId,
				result: result as string | number | boolean | object | null,
				url: page.url(),
			},
		},
	];
}
