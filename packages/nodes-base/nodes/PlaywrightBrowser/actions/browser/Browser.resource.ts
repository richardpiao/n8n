import type { INodeProperties } from 'n8n-workflow';

import * as launch from './launch.operation';
import * as close from './close.operation';

export { launch, close };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['browser'],
			},
		},
		options: [
			{
				name: 'Launch',
				value: 'launch',
				description: 'Launch a new browser instance',
				action: 'Launch browser',
			},
			{
				name: 'Close',
				value: 'close',
				description: 'Close a browser instance',
				action: 'Close browser',
			},
		],
		default: 'launch',
	},
	...launch.description,
	...close.description,
];
