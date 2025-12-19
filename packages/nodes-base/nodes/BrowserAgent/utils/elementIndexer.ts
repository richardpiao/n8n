import type { Page } from 'playwright';

/**
 * Indexed element with bounding box for visual reference
 */
export interface IndexedElement {
	index: number;
	type: string;
	text?: string;
	placeholder?: string;
	href?: string;
	ariaLabel?: string;
	selector: string; // CSS selector as fallback
	boundingBox: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
}

/**
 * Colors for bounding box highlighting (cycling through)
 */
const HIGHLIGHT_COLORS = [
	'#FF0000', // Red
	'#00FF00', // Green
	'#0000FF', // Blue
	'#FFA500', // Orange
	'#800080', // Purple
	'#00FFFF', // Cyan
	'#FF00FF', // Magenta
	'#FFFF00', // Yellow
	'#008080', // Teal
	'#FF6347', // Tomato
	'#4682B4', // Steel Blue
	'#32CD32', // Lime Green
];

/**
 * Get all interactive elements from the page with sequential indexes
 * Each element includes its bounding box for visual highlighting
 */
export async function getIndexedElements(page: Page): Promise<IndexedElement[]> {
	return page.evaluate(() => {
		const elements: Array<{
			index: number;
			type: string;
			text?: string;
			placeholder?: string;
			href?: string;
			ariaLabel?: string;
			selector: string;
			boundingBox: { x: number; y: number; width: number; height: number };
		}> = [];
		let index = 0;

		// Selectors for interactive elements (same as scraper.ts)
		const selectors = [
			'a[href]',
			'button',
			'input:not([type="hidden"])',
			'textarea',
			'select',
			'[role="button"]',
			'[role="link"]',
			'[role="tab"]',
			'[role="menuitem"]',
			'[onclick]',
		];

		/**
		 * Build a stable CSS selector for an element
		 */
		function buildSelector(el: Element): string {
			const tag = el.tagName.toLowerCase();

			// Priority order for selector stability
			if (el.id && !el.id.match(/^[0-9]|[:]/)) {
				return `#${el.id}`;
			}
			if (el.getAttribute('data-testid')) {
				return `[data-testid="${el.getAttribute('data-testid')}"]`;
			}
			if (el.getAttribute('name')) {
				return `${tag}[name="${el.getAttribute('name')}"]`;
			}
			if (tag === 'a' && (el as HTMLAnchorElement).getAttribute('href')) {
				const href = (el as HTMLAnchorElement).getAttribute('href');
				if (href && !href.startsWith('javascript:') && href.length < 100) {
					return `a[href="${href}"]`;
				}
			}
			if (el.getAttribute('aria-label')) {
				return `${tag}[aria-label="${el.getAttribute('aria-label')}"]`;
			}
			if (el.getAttribute('role')) {
				const role = el.getAttribute('role');
				const ariaLabel = el.getAttribute('aria-label');
				if (ariaLabel) {
					return `[role="${role}"][aria-label="${ariaLabel}"]`;
				}
				return `[role="${role}"]`;
			}
			if (el.getAttribute('type') && tag === 'input') {
				return `input[type="${el.getAttribute('type')}"]`;
			}

			// Last resort: tag name
			return tag;
		}

		// Collect all matching elements
		const seen = new Set<Element>();

		for (const selector of selectors) {
			document.querySelectorAll(selector).forEach((el) => {
				// Skip duplicates
				if (seen.has(el)) return;
				seen.add(el);

				const htmlEl = el as HTMLElement;

				// Skip hidden elements
				const style = window.getComputedStyle(htmlEl);
				if (style.display === 'none' || style.visibility === 'hidden') {
					return;
				}

				// Get bounding box
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;

				// Skip elements outside viewport (with some margin)
				if (
					rect.bottom < -100 ||
					rect.top > window.innerHeight + 100 ||
					rect.right < -100 ||
					rect.left > window.innerWidth + 100
				) {
					return;
				}

				// Determine element type
				let type = el.tagName.toLowerCase();
				if (type === 'input') {
					type = `input[${(el as HTMLInputElement).type || 'text'}]`;
				}

				elements.push({
					index: index++,
					type,
					text: htmlEl.innerText?.trim().substring(0, 50) || undefined,
					placeholder: (el as HTMLInputElement).placeholder || undefined,
					href: (el as HTMLAnchorElement).href || undefined,
					ariaLabel: el.getAttribute('aria-label') || undefined,
					selector: buildSelector(el),
					boundingBox: {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
					},
				});
			});
		}

		return elements;
	});
}

/**
 * Draw bounding boxes on the page and take a screenshot
 * Returns the screenshot buffer with highlighted elements
 */
export async function drawBoundingBoxes(page: Page, elements: IndexedElement[]): Promise<Buffer> {
	// Inject highlight overlays
	await page.evaluate(
		({ els, colors }) => {
			// Create container for overlays
			const container = document.createElement('div');
			container.id = 'n8n-highlight-container';
			container.style.cssText =
				'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 999999;';

			els.forEach((el) => {
				const color = colors[el.index % colors.length];

				// Create overlay box
				const overlay = document.createElement('div');
				overlay.className = 'n8n-highlight-box';
				overlay.style.cssText = `
					position: fixed;
					top: ${el.boundingBox.y}px;
					left: ${el.boundingBox.x}px;
					width: ${el.boundingBox.width}px;
					height: ${el.boundingBox.height}px;
					border: 2px solid ${color};
					background: ${color}1A;
					pointer-events: none;
					box-sizing: border-box;
				`;

				// Create index label
				const label = document.createElement('div');
				label.className = 'n8n-highlight-label';
				label.textContent = el.index.toString();
				label.style.cssText = `
					position: absolute;
					top: -1px;
					right: -1px;
					background: ${color};
					color: white;
					padding: 1px 4px;
					font-size: ${Math.min(12, Math.max(8, el.boundingBox.height / 2))}px;
					font-family: monospace;
					font-weight: bold;
					line-height: 1;
					border-radius: 2px;
				`;

				overlay.appendChild(label);
				container.appendChild(overlay);
			});

			document.body.appendChild(container);
		},
		{ els: elements, colors: HIGHLIGHT_COLORS },
	);

	// Take screenshot
	const screenshot = await page.screenshot({ type: 'png', fullPage: false });

	// Remove overlays
	await page.evaluate(() => {
		const container = document.getElementById('n8n-highlight-container');
		if (container) {
			container.remove();
		}
	});

	return screenshot;
}

/**
 * Format elements for AI prompt
 * Output format: [0]<button>Sign In</button>
 */
export function formatElementsForPrompt(elements: IndexedElement[]): string {
	return elements
		.map((el) => {
			let content = el.text || '';
			if (el.placeholder) {
				content = content
					? `${content} (placeholder: ${el.placeholder})`
					: `placeholder: ${el.placeholder}`;
			}
			if (el.ariaLabel && !content.includes(el.ariaLabel)) {
				content = content ? `${content} [${el.ariaLabel}]` : el.ariaLabel;
			}
			return `[${el.index}]<${el.type}>${content}</${el.type.split('[')[0]}>`;
		})
		.join('\n');
}

/**
 * Check if DOM has changed significantly between two element lists
 * Used to stop multi-action batch when page updates
 */
export function hasSignificantDOMChange(
	oldElements: IndexedElement[],
	newElements: IndexedElement[],
): boolean {
	// Quick check: significant count change (>20% difference)
	const countDiff = Math.abs(oldElements.length - newElements.length);
	if (countDiff > oldElements.length * 0.2) {
		return true;
	}

	// Check if new elements appeared (not just moved)
	const oldSelectors = new Set(oldElements.map((e) => e.selector));
	const newSelectors = newElements.map((e) => e.selector);

	let newCount = 0;
	for (const selector of newSelectors) {
		if (!oldSelectors.has(selector)) {
			newCount++;
		}
	}

	// If more than 30% new elements, consider it a significant change
	return newCount > oldElements.length * 0.3;
}
