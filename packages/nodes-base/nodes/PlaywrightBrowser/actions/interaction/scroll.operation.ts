import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { humanScroll, applyHumanDelay } from '../../utils/humanDelay';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		displayName: 'Scroll Mode',
		name: 'scrollMode',
		type: 'options',
		default: 'pixels',
		options: [
			{
				name: 'By Pixels',
				value: 'pixels',
				description: 'Scroll by a specific number of pixels',
			},
			{
				name: 'To Element',
				value: 'element',
				description: 'Scroll to make an element visible',
			},
			{
				name: 'To Position',
				value: 'position',
				description: 'Scroll to top, bottom, or specific position',
			},
		],
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['scroll'],
			},
		},
	},
	{
		...selectorField,
		displayName: 'Element Selector',
		description: 'CSS selector of the element to scroll into view',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['scroll'],
				scrollMode: ['element'],
			},
		},
	},
	{
		displayName: 'Scroll Amount (px)',
		name: 'scrollAmount',
		type: 'number',
		default: 500,
		description: 'Number of pixels to scroll (positive = down, negative = up)',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['scroll'],
				scrollMode: ['pixels'],
			},
		},
	},
	{
		displayName: 'Position',
		name: 'scrollPosition',
		type: 'options',
		default: 'bottom',
		options: [
			{
				name: 'Top',
				value: 'top',
			},
			{
				name: 'Bottom',
				value: 'bottom',
			},
		],
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['scroll'],
				scrollMode: ['position'],
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
	const scrollMode = this.getNodeParameter('scrollMode', index) as string;
	const additionalOptions = this.getNodeParameter('additionalOptions', index, {}) as {
		humanDelay?: { enabled?: boolean; min?: number; max?: number };
		timeout?: number;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	// Apply human-like delay
	if (additionalOptions.humanDelay?.enabled !== false) {
		await applyHumanDelay(additionalOptions.humanDelay);
	}

	let scrollInfo = {};

	switch (scrollMode) {
		case 'element': {
			const selector = this.getNodeParameter('selector', index) as string;
			await page.locator(selector).scrollIntoViewIfNeeded({
				timeout: additionalOptions.timeout || 30000,
			});
			scrollInfo = { mode: 'element', selector };
			break;
		}
		case 'position': {
			const position = this.getNodeParameter('scrollPosition', index) as string;
			if (position === 'top') {
				await page.evaluate(() => window.scrollTo(0, 0));
			} else {
				await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			}
			scrollInfo = { mode: 'position', position };
			break;
		}
		default: {
			const scrollAmount = this.getNodeParameter('scrollAmount', index) as number;
			if (additionalOptions.humanDelay?.enabled !== false) {
				await humanScroll(page, scrollAmount, additionalOptions.humanDelay);
			} else {
				await page.mouse.wheel(0, scrollAmount);
			}
			scrollInfo = { mode: 'pixels', amount: scrollAmount };
			break;
		}
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				...scrollInfo,
				message: 'Scroll executed successfully',
			},
		},
	];
}
