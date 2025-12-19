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
				operation: ['check'],
			},
		},
	},
	{
		displayName: 'Action',
		name: 'checkAction',
		type: 'options',
		default: 'check',
		options: [
			{
				name: 'Check',
				value: 'check',
			},
			{
				name: 'Uncheck',
				value: 'uncheck',
			},
			{
				name: 'Toggle',
				value: 'toggle',
			},
		],
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['check'],
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
	const checkAction = this.getNodeParameter('checkAction', index) as string;
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

	const options = {
		force: additionalOptions.force,
		timeout: additionalOptions.timeout || 30000,
	};

	switch (checkAction) {
		case 'uncheck':
			await page.uncheck(selector, options);
			break;
		case 'toggle':
			const isChecked = await page.isChecked(selector);
			if (isChecked) {
				await page.uncheck(selector, options);
			} else {
				await page.check(selector, options);
			}
			break;
		default:
			await page.check(selector, options);
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				action: checkAction,
				message: `Checkbox ${checkAction}ed successfully`,
			},
		},
	];
}
