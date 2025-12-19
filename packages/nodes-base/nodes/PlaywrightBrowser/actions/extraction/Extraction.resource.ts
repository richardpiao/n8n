import type { INodeProperties } from 'n8n-workflow';

import * as screenshot from './screenshot.operation';
import * as getContent from './getContent.operation';
import * as getText from './getText.operation';
import * as evaluate from './evaluate.operation';
import * as getAttribute from './getAttribute.operation';
import * as getUrl from './getUrl.operation';
import * as getPageInfo from './getPageInfo.operation';
import { sessionIdField, pageIdField } from '../common/fields';

export { screenshot, getContent, getText, evaluate, getAttribute, getUrl, getPageInfo };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['extraction'],
			},
		},
		options: [
			{
				name: 'Evaluate JavaScript',
				value: 'evaluate',
				description: 'Execute JavaScript in the page context',
				action: 'Evaluate JavaScript',
			},
			{
				name: 'Get Attribute',
				value: 'getAttribute',
				description: 'Get an attribute value from an element',
				action: 'Get attribute',
			},
			{
				name: 'Get Page Content',
				value: 'getContent',
				description: 'Get the full HTML content of the page',
				action: 'Get page content',
			},
			{
				name: 'Get Text',
				value: 'getText',
				description: 'Get text content from an element',
				action: 'Get text',
			},
			{
				name: 'Get URL',
				value: 'getUrl',
				description: 'Get the current page URL and title',
				action: 'Get URL',
			},
			{
				name: 'Get Page Info',
				value: 'getPageInfo',
				description: 'Get all interactive elements on the page (for AI agent context)',
				action: 'Get page info',
			},
			{
				name: 'Take Screenshot',
				value: 'screenshot',
				description: 'Take a screenshot of the page or element',
				action: 'Take screenshot',
			},
		],
		default: 'screenshot',
	},
	{
		...sessionIdField,
		displayOptions: {
			show: {
				resource: ['extraction'],
			},
		},
	},
	{
		...pageIdField,
		displayOptions: {
			show: {
				resource: ['extraction'],
			},
		},
	},
	...screenshot.description,
	...getContent.description,
	...getText.description,
	...evaluate.description,
	...getAttribute.description,
	...getUrl.description,
	...getPageInfo.description,
];
