import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import {
	browserTypeField,
	headlessField,
	sessionPathField,
	viewportFields,
	proxyFields,
} from '../common/fields';

export const description: INodeProperties[] = [
	{
		...browserTypeField,
		displayOptions: {
			show: {
				resource: ['browser'],
				operation: ['launch'],
			},
		},
	},
	{
		...headlessField,
		displayOptions: {
			show: {
				resource: ['browser'],
				operation: ['launch'],
			},
		},
	},
	{
		displayName: 'Session ID',
		name: 'sessionId',
		type: 'string',
		default: '={{ $runIndex }}-{{ Date.now() }}',
		description: 'Unique identifier for this browser session',
		displayOptions: {
			show: {
				resource: ['browser'],
				operation: ['launch'],
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
				resource: ['browser'],
				operation: ['launch'],
			},
		},
		options: [
			{
				...sessionPathField,
				description: 'Load session state (cookies, localStorage) from this file path',
			},
			{
				displayName: 'Slow Motion (ms)',
				name: 'slowMo',
				type: 'number',
				default: 0,
				description: 'Slow down Playwright operations by specified milliseconds',
			},
			viewportFields,
			proxyFields,
		],
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const browserType = this.getNodeParameter('browserType', index) as
		| 'chromium'
		| 'firefox'
		| 'webkit';
	const headless = this.getNodeParameter('headless', index) as boolean;
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const options = this.getNodeParameter('options', index, {}) as {
		sessionPath?: string;
		slowMo?: number;
		viewport?: { width: number; height: number };
		proxy?: { server: string; username?: string; password?: string };
	};

	const result = await browserPool.launchBrowser(sessionId, {
		browserType,
		headless,
		slowMo: options.slowMo,
		viewport: options.viewport,
		proxy: options.proxy,
		storageState: options.sessionPath,
	});

	return [
		{
			json: {
				sessionId: result.sessionId,
				pageId: result.pageId,
				browserType,
				headless,
				message: 'Browser launched successfully',
			},
		},
	];
}
