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
				operation: ['click'],
			},
		},
	},
	{
		displayName: 'Click Type',
		name: 'clickType',
		type: 'options',
		default: 'single',
		options: [
			{
				name: 'Single Click',
				value: 'single',
			},
			{
				name: 'Double Click',
				value: 'double',
			},
			{
				name: 'Right Click',
				value: 'right',
			},
		],
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['click'],
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
	const clickType = this.getNodeParameter('clickType', index, 'single') as string;
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

	const clickOptions = {
		force: additionalOptions.force,
		timeout: additionalOptions.timeout || 30000,
	};

	switch (clickType) {
		case 'double':
			await page.dblclick(selector, clickOptions);
			break;
		case 'right':
			await page.click(selector, { ...clickOptions, button: 'right' });
			break;
		default:
			await page.click(selector, clickOptions);
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				clickType,
				message: 'Click executed successfully',
			},
		},
	];
}
