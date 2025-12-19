import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { selectorField, timeoutField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForSelector'],
			},
		},
	},
	{
		displayName: 'State',
		name: 'state',
		type: 'options',
		default: 'visible',
		options: [
			{
				name: 'Visible',
				value: 'visible',
				description: 'Wait for element to be visible',
			},
			{
				name: 'Hidden',
				value: 'hidden',
				description: 'Wait for element to be hidden or removed',
			},
			{
				name: 'Attached',
				value: 'attached',
				description: 'Wait for element to be attached to DOM',
			},
			{
				name: 'Detached',
				value: 'detached',
				description: 'Wait for element to be detached from DOM',
			},
		],
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForSelector'],
			},
		},
	},
	{
		...timeoutField,
		displayOptions: {
			show: {
				resource: ['wait'],
				operation: ['waitForSelector'],
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
	const state = this.getNodeParameter('state', index) as
		| 'visible'
		| 'hidden'
		| 'attached'
		| 'detached';
	const timeout = this.getNodeParameter('timeout', index, 30000) as number;

	const page = await browserPool.getPage(sessionId, pageId);

	await page.waitForSelector(selector, { state, timeout });

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				state,
				message: `Element ${state}`,
			},
		},
	];
}
