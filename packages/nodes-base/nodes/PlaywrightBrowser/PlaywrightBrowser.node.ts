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
		description: 'Automate browser interactions with Playwright',
		usableAsTool: true,
		defaults: {
			name: 'Playwright Browser',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
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
