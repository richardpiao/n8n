import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { applyHumanDelay } from '../../utils/humanDelay';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		description: 'CSS selector for the element to focus (leave empty to press on page)',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['press'],
			},
		},
	},
	{
		displayName: 'Key',
		name: 'key',
		type: 'string',
		required: true,
		default: 'Enter',
		placeholder: 'e.g. Enter, Tab, Escape, ArrowDown, Control+c',
		description: 'Key to press. Can be a single key or combination like Control+c, Shift+Tab, etc.',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['press'],
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
	const key = this.getNodeParameter('key', index) as string;
	const additionalOptions = this.getNodeParameter('additionalOptions', index, {}) as {
		humanDelay?: { enabled?: boolean; min?: number; max?: number };
		timeout?: number;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	// Apply human-like delay
	if (additionalOptions.humanDelay?.enabled !== false) {
		await applyHumanDelay(additionalOptions.humanDelay);
	}

	if (selector) {
		await page.press(selector, key, { timeout: additionalOptions.timeout || 30000 });
	} else {
		await page.keyboard.press(key);
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector: selector || 'page',
				key,
				message: 'Key pressed successfully',
			},
		},
	];
}
