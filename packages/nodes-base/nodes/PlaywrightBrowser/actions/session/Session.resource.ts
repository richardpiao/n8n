import type { INodeProperties } from 'n8n-workflow';

import * as save from './save.operation';
import * as load from './load.operation';
import * as getCookies from './getCookies.operation';
import * as setCookies from './setCookies.operation';
import { sessionIdField, pageIdField } from '../common/fields';

export { save, load, getCookies, setCookies };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['session'],
			},
		},
		options: [
			{
				name: 'Get Cookies',
				value: 'getCookies',
				description: 'Get all cookies from the browser context',
				action: 'Get cookies',
			},
			{
				name: 'Load Session',
				value: 'load',
				description: 'Load session state from a file',
				action: 'Load session',
			},
			{
				name: 'Save Session',
				value: 'save',
				description: 'Save session state to a file',
				action: 'Save session',
			},
			{
				name: 'Set Cookies',
				value: 'setCookies',
				description: 'Set cookies in the browser context',
				action: 'Set cookies',
			},
		],
		default: 'save',
	},
	{
		...sessionIdField,
		displayOptions: {
			show: {
				resource: ['session'],
			},
		},
	},
	{
		...pageIdField,
		displayOptions: {
			show: {
				resource: ['session'],
				operation: ['getCookies', 'setCookies'],
			},
		},
	},
	...save.description,
	...load.description,
	...getCookies.description,
	...setCookies.description,
];
