import { NodeConnectionTypes } from 'n8n-workflow';
import type { IExecuteFunctions, INodeType, INodeTypeDescription } from 'n8n-workflow';

import * as browser from './actions/browser/Browser.resource';
import * as page from './actions/page/Page.resource';
import * as interaction from './actions/interaction/Interaction.resource';
import * as extraction from './actions/extraction/Extraction.resource';
import * as wait from './actions/wait/Wait.resource';
import * as session from './actions/session/Session.resource';
import { router } from './actions/router';

export class PlaywrightBrowser implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Playwright Browser',
		name: 'playwrightBrowser',
		icon: 'file:playwrightBrowser.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Automate browser interactions with Playwright. Supports AI Agent integration with action memory for faster replay.',
		usableAsTool: true,
		defaults: {
			name: 'Playwright Browser',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			// Memory configuration (for AI Agent integration)
			{
				displayName: 'Action Memory',
				name: 'actionMemoryNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						resource: ['browser'],
						operation: ['launch'],
					},
				},
			},
			{
				displayName: 'Use Action Memory',
				name: 'useActionMemory',
				type: 'boolean',
				default: true,
				description:
					'Remember successful action sequences for faster replay. When enabled, the first execution learns the workflow, subsequent executions replay it without AI.',
				displayOptions: {
					show: {
						resource: ['browser'],
						operation: ['launch'],
					},
				},
			},
			{
				displayName: 'Memory Mode',
				name: 'memoryMode',
				type: 'options',
				options: [
					{
						name: 'Learn & Replay',
						value: 'auto',
						description: 'Learn on first run, replay on subsequent runs',
					},
					{
						name: 'Always Learn',
						value: 'learn',
						description: 'Always use AI to decide actions (updates memory)',
					},
					{
						name: 'Replay Only',
						value: 'replay',
						description: 'Only use saved workflows (fail if not found)',
					},
				],
				default: 'auto',
				description: 'How to use the action memory',
				displayOptions: {
					show: {
						resource: ['browser'],
						operation: ['launch'],
						useActionMemory: [true],
					},
				},
			},
			{
				displayName: 'Goal',
				name: 'workflowGoal',
				type: 'string',
				default: '',
				placeholder: 'e.g., Apply to software engineer jobs',
				description: 'The goal of this browser workflow. Used to match saved action sequences.',
				displayOptions: {
					show: {
						resource: ['browser'],
						operation: ['launch'],
						useActionMemory: [true],
					},
				},
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Browser',
						value: 'browser',
					},
					{
						name: 'Extraction',
						value: 'extraction',
					},
					{
						name: 'Interaction',
						value: 'interaction',
					},
					{
						name: 'Page',
						value: 'page',
					},
					{
						name: 'Session',
						value: 'session',
					},
					{
						name: 'Wait',
						value: 'wait',
					},
				],
				default: 'page',
			},
			...browser.description,
			...page.description,
			...interaction.description,
			...extraction.description,
			...wait.description,
			...session.description,
		],
	};

	async execute(this: IExecuteFunctions) {
		return await router.call(this);
	}
}
