import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { saveSession } from '../../utils/sessionPersistence';
import { sessionIdField, sessionPathField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...sessionIdField,
		displayOptions: {
			show: {
				resource: ['browser'],
				operation: ['close'],
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
				operation: ['close'],
			},
		},
		options: [
			{
				...sessionPathField,
				description: 'Save session state (cookies, localStorage) to this file path before closing',
			},
		],
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const options = this.getNodeParameter('options', index, {}) as {
		sessionPath?: string;
	};

	// Save session if path is provided
	if (options.sessionPath) {
		try {
			const context = await browserPool.getContext(sessionId);
			await saveSession(context, options.sessionPath);
		} catch {
			// Session might already be closed
		}
	}

	await browserPool.closeBrowser(sessionId);

	return [
		{
			json: {
				sessionId,
				message: 'Browser closed successfully',
				sessionSaved: !!options.sessionPath,
			},
		},
	];
}
