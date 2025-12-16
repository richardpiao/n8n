import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		description: 'CSS selector for the element (leave empty for entire page text)',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getText'],
			},
		},
	},
	{
		displayName: 'Get All Matches',
		name: 'getAllMatches',
		type: 'boolean',
		default: false,
		description: 'Whether to get text from all matching elements',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getText'],
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
	const selector = this.getNodeParameter('selector', index, '') as string;
	const getAllMatches = this.getNodeParameter('getAllMatches', index, false) as boolean;

	const page = await browserPool.getPage(sessionId, pageId);

	let text: string | string[];

	if (!selector) {
		// Get all text from the page
		text = await page.evaluate(() => document.body.innerText);
	} else if (getAllMatches) {
		// Get text from all matching elements
		text = await page.locator(selector).allTextContents();
	} else {
		// Get text from first matching element
		text = (await page.locator(selector).textContent()) || '';
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector: selector || 'body',
				text,
				url: page.url(),
			},
		},
	];
}
