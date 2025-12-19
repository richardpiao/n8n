import type { INodeProperties } from 'n8n-workflow';

import * as navigate from './navigate.operation';
import * as reload from './reload.operation';
import * as goBack from './goBack.operation';
import * as goForward from './goForward.operation';
import { sessionIdField, pageIdField } from '../common/fields';

export { navigate, reload, goBack, goForward };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['page'],
			},
		},
		options: [
			{
				name: 'Navigate',
				value: 'navigate',
				description: 'Navigate to a URL',
				action: 'Navigate to URL',
			},
			{
				name: 'Reload',
				value: 'reload',
				description: 'Reload the current page',
				action: 'Reload page',
			},
			{
				name: 'Go Back',
				value: 'goBack',
				description: 'Navigate to the previous page in history',
				action: 'Go back',
			},
			{
				name: 'Go Forward',
				value: 'goForward',
				description: 'Navigate to the next page in history',
				action: 'Go forward',
			},
		],
		default: 'navigate',
	},
	{
		...sessionIdField,
		displayOptions: {
			show: {
				resource: ['page'],
			},
		},
	},
	{
		...pageIdField,
		displayOptions: {
			show: {
				resource: ['page'],
			},
		},
	},
	...navigate.description,
	...reload.description,
	...goBack.description,
	...goForward.description,
];
