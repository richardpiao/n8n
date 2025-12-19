import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

export const description: INodeProperties[] = [
	{
		displayName: 'Content Type',
		name: 'contentType',
		type: 'options',
		default: 'html',
		options: [
			{
				name: 'HTML',
				value: 'html',
				description: 'Get the full HTML content',
			},
			{
				name: 'Outer HTML',
				value: 'outerHtml',
				description: 'Get outer HTML of a specific element',
			},
			{
				name: 'Inner HTML',
				value: 'innerHtml',
				description: 'Get inner HTML of a specific element',
			},
		],
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getContent'],
			},
		},
	},
	{
		displayName: 'Selector',
		name: 'selector',
		type: 'string',
		default: '',
		description: 'CSS selector for the element (required for outerHtml/innerHtml)',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getContent'],
				contentType: ['outerHtml', 'innerHtml'],
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
	const contentType = this.getNodeParameter('contentType', index) as string;

	const page = await browserPool.getPage(sessionId, pageId);

	let content: string;

	switch (contentType) {
		case 'outerHtml': {
			const selector = this.getNodeParameter('selector', index) as string;
			content = await page.locator(selector).evaluate((el) => el.outerHTML);
			break;
		}
		case 'innerHtml': {
			const selector = this.getNodeParameter('selector', index) as string;
			content = await page.locator(selector).innerHTML();
			break;
		}
		default:
			content = await page.content();
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				contentType,
				content,
				url: page.url(),
				title: await page.title(),
			},
		},
	];
}
