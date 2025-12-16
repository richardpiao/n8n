import type { INodeProperties } from 'n8n-workflow';

/**
 * Session/Browser ID fields
 */
export const sessionIdField: INodeProperties = {
	displayName: 'Session ID',
	name: 'sessionId',
	type: 'string',
	required: true,
	default: '={{ $json["sessionId"] }}',
	description: 'The ID of the browser session to use',
};

export const pageIdField: INodeProperties = {
	displayName: 'Page ID',
	name: 'pageId',
	type: 'string',
	default: '={{ $json["pageId"] || "default" }}',
	description: 'The ID of the page within the session (defaults to "default")',
};

/**
 * Selector field
 */
export const selectorField: INodeProperties = {
	displayName: 'Selector',
	name: 'selector',
	type: 'string',
	default: '',
	description: 'CSS selector, XPath, or text selector to target an element',
	placeholder: 'e.g. #submit-btn, //button[@type="submit"], text=Submit',
};

/**
 * URL field
 */
export const urlField: INodeProperties = {
	displayName: 'URL',
	name: 'url',
	type: 'string',
	default: '',
	placeholder: 'e.g. https://linkedin.com/jobs',
	description: 'URL to navigate to',
};

/**
 * Browser settings fields
 */
export const browserTypeField: INodeProperties = {
	displayName: 'Browser Type',
	name: 'browserType',
	type: 'options',
	default: 'chromium',
	options: [
		{
			name: 'Chromium',
			value: 'chromium',
		},
		{
			name: 'Firefox',
			value: 'firefox',
		},
		{
			name: 'WebKit (Safari)',
			value: 'webkit',
		},
	],
	description: 'The browser engine to use',
};

export const headlessField: INodeProperties = {
	displayName: 'Headless Mode',
	name: 'headless',
	type: 'boolean',
	default: true,
	description: 'Whether to run browser in headless mode (no visible window)',
};

/**
 * Human-like behavior fields
 */
export const humanDelayFields: INodeProperties = {
	displayName: 'Human-Like Delay',
	name: 'humanDelay',
	type: 'collection',
	placeholder: 'Configure delays',
	default: {},
	options: [
		{
			displayName: 'Enabled',
			name: 'enabled',
			type: 'boolean',
			default: true,
			description: 'Whether to add random delays between actions',
		},
		{
			displayName: 'Min Delay (ms)',
			name: 'min',
			type: 'number',
			default: 500,
			description: 'Minimum delay between actions in milliseconds',
		},
		{
			displayName: 'Max Delay (ms)',
			name: 'max',
			type: 'number',
			default: 2000,
			description: 'Maximum delay between actions in milliseconds',
		},
	],
};

/**
 * Viewport fields
 */
export const viewportFields: INodeProperties = {
	displayName: 'Viewport',
	name: 'viewport',
	type: 'collection',
	placeholder: 'Configure viewport',
	default: {},
	options: [
		{
			displayName: 'Width',
			name: 'width',
			type: 'number',
			default: 1920,
			description: 'Viewport width in pixels',
		},
		{
			displayName: 'Height',
			name: 'height',
			type: 'number',
			default: 1080,
			description: 'Viewport height in pixels',
		},
	],
};

/**
 * Proxy fields
 */
export const proxyFields: INodeProperties = {
	displayName: 'Proxy',
	name: 'proxy',
	type: 'collection',
	placeholder: 'Configure proxy',
	default: {},
	options: [
		{
			displayName: 'Server',
			name: 'server',
			type: 'string',
			default: '',
			placeholder: 'e.g. http://proxy.example.com:8080',
			description: 'Proxy server URL',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			description: 'Proxy username for authentication',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Proxy password for authentication',
		},
	],
};

/**
 * Session path field
 */
export const sessionPathField: INodeProperties = {
	displayName: 'Session Path',
	name: 'sessionPath',
	type: 'string',
	default: '',
	placeholder: 'e.g. ~/.n8n/sessions/linkedin.json',
	description: 'Path to save/load browser session (cookies, localStorage)',
};

/**
 * Timeout field
 */
export const timeoutField: INodeProperties = {
	displayName: 'Timeout (ms)',
	name: 'timeout',
	type: 'number',
	default: 30000,
	description: 'Maximum time to wait in milliseconds',
};

/**
 * Text input field
 */
export const textField: INodeProperties = {
	displayName: 'Text',
	name: 'text',
	type: 'string',
	default: '',
	description: 'Text to type or fill',
};

/**
 * Wait for load state options
 */
export const loadStateField: INodeProperties = {
	displayName: 'Wait Until',
	name: 'waitUntil',
	type: 'options',
	default: 'load',
	options: [
		{
			name: 'Load (Default)',
			value: 'load',
			description: 'Wait until the load event is fired',
		},
		{
			name: 'DOM Content Loaded',
			value: 'domcontentloaded',
			description: 'Wait until DOMContentLoaded event is fired',
		},
		{
			name: 'Network Idle',
			value: 'networkidle',
			description: 'Wait until there are no network connections for 500ms',
		},
	],
	description: 'When to consider the navigation complete',
};
