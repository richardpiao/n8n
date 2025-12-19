import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		displayName: 'Screenshot Type',
		name: 'screenshotType',
		type: 'options',
		default: 'fullPage',
		options: [
			{
				name: 'Full Page',
				value: 'fullPage',
				description: 'Capture the entire scrollable page',
			},
			{
				name: 'Viewport',
				value: 'viewport',
				description: 'Capture only the visible viewport',
			},
			{
				name: 'Element',
				value: 'element',
				description: 'Capture a specific element',
			},
		],
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['screenshot'],
			},
		},
	},
	{
		...selectorField,
		displayName: 'Element Selector',
		description: 'CSS selector for the element to capture',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['screenshot'],
				screenshotType: ['element'],
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['screenshot'],
			},
		},
		options: [
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: 'screenshot.png',
				description: 'Name for the screenshot file',
			},
			{
				displayName: 'Image Type',
				name: 'type',
				type: 'options',
				default: 'png',
				options: [
					{ name: 'PNG', value: 'png' },
					{ name: 'JPEG', value: 'jpeg' },
				],
			},
			{
				displayName: 'Quality (JPEG only)',
				name: 'quality',
				type: 'number',
				default: 80,
				description: 'JPEG quality (0-100)',
				displayOptions: {
					show: {
						type: ['jpeg'],
					},
				},
			},
			{
				displayName: 'Omit Background',
				name: 'omitBackground',
				type: 'boolean',
				default: false,
				description: 'Whether to hide the default white background (PNG only)',
			},
		],
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;
	const screenshotType = this.getNodeParameter('screenshotType', index) as string;
	const options = this.getNodeParameter('options', index, {}) as {
		fileName?: string;
		type?: 'png' | 'jpeg';
		quality?: number;
		omitBackground?: boolean;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	const screenshotOptions: Parameters<typeof page.screenshot>[0] = {
		type: options.type || 'png',
		fullPage: screenshotType === 'fullPage',
		omitBackground: options.omitBackground,
	};

	if (options.type === 'jpeg' && options.quality) {
		screenshotOptions.quality = options.quality;
	}

	let buffer: Buffer;

	if (screenshotType === 'element') {
		const selector = this.getNodeParameter('selector', index) as string;
		buffer = await page.locator(selector).screenshot(screenshotOptions);
	} else {
		buffer = await page.screenshot(screenshotOptions);
	}

	const fileName = options.fileName || `screenshot.${options.type || 'png'}`;
	const mimeType = options.type === 'jpeg' ? 'image/jpeg' : 'image/png';

	return [
		{
			json: {
				sessionId,
				pageId,
				screenshotType,
				fileName,
				message: 'Screenshot captured successfully',
			},
			binary: {
				data: await this.helpers.prepareBinaryData(buffer, fileName, mimeType),
			},
		},
	];
}
