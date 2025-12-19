import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { humanType, applyHumanDelay } from '../../utils/humanDelay';
import { selectorField, textField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['type'],
			},
		},
	},
	{
		...textField,
		required: true,
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['type'],
			},
		},
	},
	{
		displayName: 'Press Enter After',
		name: 'pressEnter',
		type: 'boolean',
		default: false,
		description: 'Whether to press Enter key after typing',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['type'],
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
	const text = this.getNodeParameter('text', index) as string;
	const pressEnter = this.getNodeParameter('pressEnter', index, false) as boolean;
	const additionalOptions = this.getNodeParameter('additionalOptions', index, {}) as {
		humanDelay?: { enabled?: boolean; min?: number; max?: number };
		timeout?: number;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	// Wait for element
	await page.waitForSelector(selector, { timeout: additionalOptions.timeout || 30000 });

	// Type with human-like delays if enabled
	if (additionalOptions.humanDelay?.enabled !== false) {
		await humanType(page, selector, text, additionalOptions.humanDelay);
	} else {
		await page.type(selector, text);
	}

	// Press Enter if requested
	if (pressEnter) {
		await applyHumanDelay(additionalOptions.humanDelay);
		await page.press(selector, 'Enter');
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				text,
				pressEnter,
				message: 'Text typed successfully',
			},
		},
	];
}
