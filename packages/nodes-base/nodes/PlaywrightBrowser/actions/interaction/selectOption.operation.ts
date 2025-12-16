import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { applyHumanDelay } from '../../utils/humanDelay';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		description: 'CSS selector for the <select> element',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['selectOption'],
			},
		},
	},
	{
		displayName: 'Select By',
		name: 'selectBy',
		type: 'options',
		default: 'value',
		options: [
			{
				name: 'Value',
				value: 'value',
				description: 'Select by option value attribute',
			},
			{
				name: 'Label',
				value: 'label',
				description: 'Select by visible text',
			},
			{
				name: 'Index',
				value: 'index',
				description: 'Select by option index (0-based)',
			},
		],
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['selectOption'],
			},
		},
	},
	{
		displayName: 'Option Value',
		name: 'optionValue',
		type: 'string',
		default: '',
		required: true,
		description: 'The value, label, or index to select',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['selectOption'],
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
	const selectBy = this.getNodeParameter('selectBy', index) as string;
	const optionValue = this.getNodeParameter('optionValue', index) as string;
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

	let selectedValues: string[];

	switch (selectBy) {
		case 'label':
			selectedValues = await page.selectOption(selector, { label: optionValue }, options);
			break;
		case 'index':
			selectedValues = await page.selectOption(
				selector,
				{ index: parseInt(optionValue, 10) },
				options,
			);
			break;
		default:
			selectedValues = await page.selectOption(selector, optionValue, options);
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				selectBy,
				optionValue,
				selectedValues,
				message: 'Option selected successfully',
			},
		},
	];
}
