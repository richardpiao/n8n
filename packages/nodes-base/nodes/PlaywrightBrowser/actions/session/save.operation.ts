import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { saveSession } from '../../utils/sessionPersistence';
import { sessionPathField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...sessionPathField,
		required: true,
		description: 'Path to save the session state (cookies, localStorage)',
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['save'],
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

	const context = await browserPool.getContext(sessionId);
	await saveSession(context, sessionPath);

	return [
		{
			json: {
				sessionId,
				sessionPath,
				message: 'Session saved successfully',
			},
		},
	];
}
