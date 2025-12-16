import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { applyHumanDelay } from '../../utils/humanDelay';
import { selectorField, textField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['fill'],
			},
		},
	},
	{
		...textField,
		required: true,
		description: 'Text to fill in the input (clears existing content)',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['fill'],
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
	const additionalOptions = this.getNodeParameter('additionalOptions', index, {}) as {
		humanDelay?: { enabled?: boolean; min?: number; max?: number };
		force?: boolean;
		timeout?: number;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	// Apply human-like delay
	if (additionalOptions.humanDelay?.enabled !== false) {
		await applyHumanDelay(additionalOptions.humanDelay);
	}

	await page.fill(selector, text, {
		force: additionalOptions.force,
		timeout: additionalOptions.timeout || 30000,
	});

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				text,
				message: 'Input filled successfully',
			},
		},
	];
}
