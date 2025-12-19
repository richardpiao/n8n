import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';

interface ElementInfo {
	index: number;
	selector: string;
	type: 'button' | 'link' | 'input' | 'select' | 'textarea' | 'checkbox' | 'radio' | 'other';
	tagName: string;
	text: string;
	placeholder?: string;
	href?: string;
	name?: string;
	id?: string;
	value?: string;
	isVisible: boolean;
	isEnabled: boolean;
	boundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

interface PageInfo {
	url: string;
	title: string;
	elementsCount: number;
	elements: ElementInfo[];
}

export const description: INodeProperties[] = [
	{
		displayName: 'Include Hidden Elements',
		name: 'includeHidden',
		type: 'boolean',
		default: false,
		description: 'Whether to include elements that are not visible on the page',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getPageInfo'],
			},
		},
	},
	{
		displayName: 'Max Elements',
		name: 'maxElements',
		type: 'number',
		default: 100,
		description: 'Maximum number of elements to return (to avoid overwhelming AI context)',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getPageInfo'],
			},
		},
	},
	{
		displayName: 'Include Bounding Boxes',
		name: 'includeBoundingBox',
		type: 'boolean',
		default: false,
		description:
			'Whether to include element positions (x, y, width, height) for vision-based interaction',
		displayOptions: {
			show: {
				resource: ['extraction'],
				operation: ['getPageInfo'],
			},
		},
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;
	const includeHidden = this.getNodeParameter('includeHidden', index, false) as boolean;
	const maxElements = this.getNodeParameter('maxElements', index, 100) as number;
	const includeBoundingBox = this.getNodeParameter('includeBoundingBox', index, false) as boolean;

	const page = await browserPool.getPage(sessionId, pageId);

	// Get all interactive elements from the page
	const elements = await page.evaluate(
		({ includeHidden: includeHiddenParam, maxElements: maxElementsParam }) => {
			const interactiveSelectors = [
				'a[href]',
				'button',
				'input:not([type="hidden"])',
				'select',
				'textarea',
				'[role="button"]',
				'[role="link"]',
				'[role="checkbox"]',
				'[role="radio"]',
				'[role="menuitem"]',
				'[role="tab"]',
				'[onclick]',
				'[tabindex]:not([tabindex="-1"])',
			];

			const allElements: Array<{
				tagName: string;
				type: string;
				text: string;
				placeholder?: string;
				href?: string;
				name?: string;
				id?: string;
				value?: string;
				isVisible: boolean;
				isEnabled: boolean;
				rect: DOMRect;
				attributes: Record<string, string>;
			}> = [];

			const seen = new Set<Element>();

			for (const selector of interactiveSelectors) {
				const elements = document.querySelectorAll(selector);
				for (const el of elements) {
					if (seen.has(el)) continue;
					seen.add(el);

					const rect = el.getBoundingClientRect();
					const style = window.getComputedStyle(el);
					const isVisible =
						rect.width > 0 &&
						rect.height > 0 &&
						style.visibility !== 'hidden' &&
						style.display !== 'none' &&
						style.opacity !== '0';

					if (!includeHiddenParam && !isVisible) continue;

					const htmlEl = el as HTMLElement;
					const inputEl = el as HTMLInputElement;
					const anchorEl = el as HTMLAnchorElement;

					// Determine element type
					let type = 'other';
					const tagName = el.tagName.toLowerCase();
					if (tagName === 'a') type = 'link';
					else if (tagName === 'button' || el.getAttribute('role') === 'button') type = 'button';
					else if (tagName === 'input') {
						const inputType = inputEl.type?.toLowerCase() || 'text';
						if (inputType === 'checkbox') type = 'checkbox';
						else if (inputType === 'radio') type = 'radio';
						else if (inputType === 'submit' || inputType === 'button') type = 'button';
						else type = 'input';
					} else if (tagName === 'select') type = 'select';
					else if (tagName === 'textarea') type = 'textarea';

					// Get visible text
					let text = htmlEl.innerText?.trim() || '';
					if (!text && inputEl.value) text = inputEl.value;
					if (!text && el.getAttribute('aria-label')) text = el.getAttribute('aria-label') || '';
					if (!text && el.getAttribute('title')) text = el.getAttribute('title') || '';

					// Truncate long text
					if (text.length > 100) text = text.substring(0, 100) + '...';

					// Get key attributes
					const attributes: Record<string, string> = {};
					for (const attr of [
						'class',
						'data-testid',
						'data-test-id',
						'aria-label',
						'name',
						'type',
					]) {
						const value = el.getAttribute(attr);
						if (value) attributes[attr] = value;
					}

					allElements.push({
						tagName,
						type,
						text,
						placeholder: inputEl.placeholder || undefined,
						href: anchorEl.href || undefined,
						name: inputEl.name || undefined,
						id: el.id || undefined,
						value: inputEl.value || undefined,
						isVisible,
						isEnabled: !(htmlEl as HTMLButtonElement).disabled,
						rect,
						attributes,
					});

					if (allElements.length >= maxElementsParam) break;
				}
				if (allElements.length >= maxElementsParam) break;
			}

			return allElements;
		},
		{ includeHidden, maxElements },
	);

	// Generate unique selectors for each element
	const elementsWithSelectors: ElementInfo[] = elements.map((el, idx) => {
		// Build a unique selector
		let selector = el.tagName;
		if (el.id) {
			selector = `#${el.id}`;
		} else if (el.attributes['data-testid']) {
			selector = `[data-testid="${el.attributes['data-testid']}"]`;
		} else if (el.attributes['data-test-id']) {
			selector = `[data-test-id="${el.attributes['data-test-id']}"]`;
		} else if (el.name) {
			selector = `${el.tagName}[name="${el.name}"]`;
		} else if (el.attributes['aria-label']) {
			selector = `${el.tagName}[aria-label="${el.attributes['aria-label']}"]`;
		} else if (el.text && el.text.length < 50) {
			// Use text content for short text
			selector = `${el.tagName}:has-text("${el.text.replace(/"/g, '\\"')}")`;
		}

		const elementInfo: ElementInfo = {
			index: idx,
			selector,
			type: el.type as ElementInfo['type'],
			tagName: el.tagName,
			text: el.text,
			isVisible: el.isVisible,
			isEnabled: el.isEnabled,
		};

		if (el.placeholder) elementInfo.placeholder = el.placeholder;
		if (el.href) elementInfo.href = el.href;
		if (el.name) elementInfo.name = el.name;
		if (el.id) elementInfo.id = el.id;
		if (el.value) elementInfo.value = el.value;

		if (includeBoundingBox) {
			elementInfo.boundingBox = {
				x: Math.round(el.rect.x),
				y: Math.round(el.rect.y),
				width: Math.round(el.rect.width),
				height: Math.round(el.rect.height),
			};
		}

		return elementInfo;
	});

	const pageInfo: PageInfo = {
		url: page.url(),
		title: await page.title(),
		elementsCount: elementsWithSelectors.length,
		elements: elementsWithSelectors,
	};

	return [
		{
			json: {
				sessionId,
				pageId,
				...pageInfo,
			},
		},
	];
}
