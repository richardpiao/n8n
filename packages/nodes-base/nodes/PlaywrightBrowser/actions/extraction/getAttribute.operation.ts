import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getAttribute'],
			},
		},
	},
	{
		displayName: 'Attribute Name',
		name: 'attributeName',
		type: 'string',
		default: 'href',
		required: true,
		placeholder: 'e.g. href, src, value, data-id',
		description: 'Name of the attribute to get',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getAttribute'],
			},
		},
	},
	{
		displayName: 'Get All Matches',
		name: 'getAllMatches',
		type: 'boolean',
		default: false,
		description: 'Whether to get attribute from all matching elements',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getAttribute'],
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
	const selector = this.getNodeParameter('selector', index) as string;
	const attributeName = this.getNodeParameter('attributeName', index) as string;
	const getAllMatches = this.getNodeParameter('getAllMatches', index, false) as boolean;

	const page = await browserPool.getPage(sessionId, pageId);

	let value: string | null | (string | null)[];

	if (getAllMatches) {
		const locators = page.locator(selector);
		const count = await locators.count();
		value = [];
		for (let i = 0; i < count; i++) {
			value.push(await locators.nth(i).getAttribute(attributeName));
		}
	} else {
		value = await page.locator(selector).getAttribute(attributeName);
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				attributeName,
				value,
			},
		},
	];
}
