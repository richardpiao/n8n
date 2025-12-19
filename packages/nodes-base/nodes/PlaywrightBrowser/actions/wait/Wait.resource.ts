import type { INodeProperties } from 'n8n-workflow';

import * as waitForSelector from './waitForSelector.operation';
import * as waitForTimeout from './waitForTimeout.operation';
import * as waitForNavigation from './waitForNavigation.operation';
import * as waitForFunction from './waitForFunction.operation';
import { sessionIdField, pageIdField } from '../common/fields';

export { waitForSelector, waitForTimeout, waitForNavigation, waitForFunction };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['wait'],
			},
		},
		options: [
			{
				name: 'Wait for Function',
				value: 'waitForFunction',
				description: 'Wait for a JavaScript function to return true',
				action: 'Wait for function',
			},
			{
				name: 'Wait for Navigation',
				value: 'waitForNavigation',
				description: 'Wait for page navigation to complete',
				action: 'Wait for navigation',
			},
			{
				name: 'Wait for Selector',
				value: 'waitForSelector',
				description: 'Wait for an element to appear on the page',
				action: 'Wait for selector',
			},
			{
				name: 'Wait for Timeout',
				value: 'waitForTimeout',
				description: 'Wait for a specified amount of time',
				action: 'Wait for timeout',
			},
		],
		default: 'waitForSelector',
	},
	{
		...sessionIdField,
		displayOptions: {
			show: {
				resource: ['wait'],
			},
		},
	},
	{
		...pageIdField,
		displayOptions: {
			show: {
				resource: ['wait'],
			},
		},
	},
	...waitForSelector.description,
	...waitForTimeout.description,
	...waitForNavigation.description,
	...waitForFunction.description,
];
