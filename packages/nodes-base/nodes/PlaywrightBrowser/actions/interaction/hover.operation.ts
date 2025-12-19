import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { applyHumanDelay } from '../../utils/humanDelay';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['hover'],
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

	await page.hover(selector, {
		force: additionalOptions.force,
		timeout: additionalOptions.timeout || 30000,
	});

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				message: 'Hover executed successfully',
			},
		},
	];
}
