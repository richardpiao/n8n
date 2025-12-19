import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { sessionExists } from '../../utils/sessionPersistence';
import { sessionPathField, browserTypeField, headlessField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...sessionPathField,
		required: true,
		description: 'Path to load the session state from',
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['load'],
			},
		},
	},
	{
		...browserTypeField,
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['load'],
			},
		},
	},
	{
		...headlessField,
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['load'],
			},
		},
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const sessionPath = this.getNodeParameter('sessionPath', index) as string;
	const browserType = this.getNodeParameter('browserType', index, 'chromium') as
		| 'chromium'
		| 'firefox'
		| 'webkit';
	const headless = this.getNodeParameter('headless', index, true) as boolean;

	// Check if session file exists
	const exists = await sessionExists(sessionPath);
	if (!exists) {
		// Launch without session if file doesn't exist
		const result = await browserPool.launchBrowser(sessionId, {
			browserType,
			headless,
		});

		return [
			{
				json: {
					sessionId: result.sessionId,
					pageId: result.pageId,
					sessionPath,
					sessionLoaded: false,
					message: 'Session file not found, launched new browser',
				},
			},
		];
	}

	// Launch browser with session state
	const result = await browserPool.launchBrowser(sessionId, {
		browserType,
		headless,
		storageState: sessionPath,
	});

	return [
		{
			json: {
				sessionId: result.sessionId,
				pageId: result.pageId,
				sessionPath,
				sessionLoaded: true,
				message: 'Session loaded successfully',
			},
		},
	];
}
