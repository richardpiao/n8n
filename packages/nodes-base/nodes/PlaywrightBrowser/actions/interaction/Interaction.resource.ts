import type { INodeProperties } from 'n8n-workflow';

import * as click from './click.operation';
import * as type from './type.operation';
import * as fill from './fill.operation';
import * as press from './press.operation';
import * as hover from './hover.operation';
import * as scroll from './scroll.operation';
import * as check from './check.operation';
import * as selectOption from './selectOption.operation';
import * as uploadFile from './uploadFile.operation';
import { sessionIdField, pageIdField, humanDelayFields } from '../common/fields';

export { click, type, fill, press, hover, scroll, check, selectOption, uploadFile };

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['interaction'],
			},
		},
		options: [
			{
				name: 'Check',
				value: 'check',
				description: 'Check a checkbox or radio button',
				action: 'Check checkbox',
			},
			{
				name: 'Click',
				value: 'click',
				description: 'Click on an element',
				action: 'Click element',
			},
			{
				name: 'Fill',
				value: 'fill',
				description: 'Fill an input field (clears existing content)',
				action: 'Fill input',
			},
			{
				name: 'Hover',
				value: 'hover',
				description: 'Hover over an element',
				action: 'Hover element',
			},
			{
				name: 'Press Key',
				value: 'press',
				description: 'Press a keyboard key',
				action: 'Press key',
			},
			{
				name: 'Scroll',
				value: 'scroll',
				description: 'Scroll the page or an element',
				action: 'Scroll page',
			},
			{
				name: 'Select Option',
				value: 'selectOption',
				description: 'Select an option from a dropdown',
				action: 'Select option',
			},
			{
				name: 'Type',
				value: 'type',
				description: 'Type text character by character',
				action: 'Type text',
			},
			{
				name: 'Upload File',
				value: 'uploadFile',
				description: 'Upload a file to an input element',
				action: 'Upload file',
			},
		],
		default: 'click',
	},
	{
		...sessionIdField,
		displayOptions: {
			show: {
				resource: ['interaction'],
			},
		},
	},
	{
		...pageIdField,
		displayOptions: {
			show: {
				resource: ['interaction'],
			},
		},
	},
	...click.description,
	...type.description,
	...fill.description,
	...press.description,
	...hover.description,
	...scroll.description,
	...check.description,
	...selectOption.description,
	...uploadFile.description,
	{
		displayName: 'Additional Options',
		name: 'additionalOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['interaction'],
			},
		},
		options: [
			humanDelayFields,
			{
				displayName: 'Force',
				name: 'force',
				type: 'boolean',
				default: false,
				description: 'Whether to bypass actionability checks (visibility, enabled, etc.)',
			},
			{
				displayName: 'Timeout (ms)',
				name: 'timeout',
				type: 'number',
				default: 30000,
				description: 'Maximum time to wait for the element',
			},
		],
	},
];
