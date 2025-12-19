import type { Page } from 'playwright';

/**
 * Scraped page data structure
 */
export interface ScrapedPageData {
	url: string;
	domain: string;
	title: string;
	description?: string;
	timestamp: number;

	// Page structure
	headings: Array<{
		level: number;
		text: string;
	}>;

	// Interactive elements
	elements: Array<{
		type: string;
		selector: string;
		text?: string;
		placeholder?: string;
		href?: string;
		name?: string;
		id?: string;
		ariaLabel?: string;
	}>;

	// Forms
	forms: Array<{
		action?: string;
		method?: string;
		fields: Array<{
			type: string;
			name: string;
			id?: string;
			placeholder?: string;
			required?: boolean;
			options?: string[];
		}>;
	}>;

	// Links structure
	links: Array<{
		href: string;
		text: string;
		isExternal: boolean;
	}>;

	// Sitemap data (if available)
	sitemap?: {
		robotsTxt?: string;
		sitemapUrls?: string[];
	};
}

/**
 * Scraper options
 */
export interface ScraperOptions {
	scrapeSitemap: boolean;
	scrapeDepth: number;
	maxPages: number;
	includeForms: boolean;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
	try {
		const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
		return urlObj.hostname;
	} catch {
		return 'unknown';
	}
}

/**
 * Scrape sitemap data (robots.txt and sitemap.xml)
 */
export async function scrapeSitemap(
	page: Page,
	baseUrl: string,
): Promise<ScrapedPageData['sitemap']> {
	const domain = extractDomain(baseUrl);
	const sitemap: ScrapedPageData['sitemap'] = {};

	try {
		// Try to fetch robots.txt
		const robotsUrl = `https://${domain}/robots.txt`;
		const robotsResponse = await page.context().request.get(robotsUrl);

		if (robotsResponse.ok()) {
			sitemap.robotsTxt = await robotsResponse.text();

			// Extract sitemap URLs from robots.txt
			const sitemapMatches = sitemap.robotsTxt.match(/Sitemap:\s*(.+)/gi);
			if (sitemapMatches) {
				sitemap.sitemapUrls = sitemapMatches.map((match) =>
					match.replace(/Sitemap:\s*/i, '').trim(),
				);
			}
		}
	} catch {
		// Sitemap fetch failed - not critical
	}

	return sitemap;
}

/**
 * Scrape page structure (headings, elements, forms, links)
 */
export async function scrapePageStructure(
	page: Page,
	options: ScraperOptions,
): Promise<Omit<ScrapedPageData, 'sitemap' | 'domain' | 'timestamp'>> {
	const url = page.url();
	const title = await page.title();

	// Extract all data in a single page.evaluate call for efficiency
	const pageData = await page.evaluate(
		(opts) => {
			// Get description
			const descMeta = document.querySelector('meta[name="description"]');
			const description = descMeta?.getAttribute('content') || undefined;

			// Get headings
			const headings: Array<{ level: number; text: string }> = [];
			document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
				const level = parseInt(h.tagName[1], 10);
				const text = (h as HTMLElement).innerText?.trim();
				if (text) {
					headings.push({ level, text: text.substring(0, 100) });
				}
			});

			// Get interactive elements
			const elements: Array<{
				type: string;
				selector: string;
				text?: string;
				placeholder?: string;
				href?: string;
				name?: string;
				id?: string;
				ariaLabel?: string;
			}> = [];

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

			for (const selector of selectors) {
				document.querySelectorAll(selector).forEach((el) => {
					const htmlEl = el as HTMLElement;

					// Skip hidden elements
					const style = window.getComputedStyle(htmlEl);
					if (style.display === 'none' || style.visibility === 'hidden') {
						return;
					}

					// Determine element type
					let type = el.tagName.toLowerCase();
					if (type === 'input') {
						type = `input[${(el as HTMLInputElement).type || 'text'}]`;
					}

					// Build a reliable selector
					let cssSelector = '';
					if (el.id) {
						cssSelector = `#${el.id}`;
					} else if (el.getAttribute('data-testid')) {
						cssSelector = `[data-testid="${el.getAttribute('data-testid')}"]`;
					} else if (el.getAttribute('name')) {
						cssSelector = `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
					} else if (el.className && typeof el.className === 'string' && el.className.trim()) {
						const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
						cssSelector = `${el.tagName.toLowerCase()}.${classes}`;
					} else {
						cssSelector = el.tagName.toLowerCase();
					}

					elements.push({
						type,
						selector: cssSelector,
						text: htmlEl.innerText?.trim().substring(0, 50) || undefined,
						placeholder: (el as HTMLInputElement).placeholder || undefined,
						href: (el as HTMLAnchorElement).href || undefined,
						name: el.getAttribute('name') || undefined,
						id: el.id || undefined,
						ariaLabel: el.getAttribute('aria-label') || undefined,
					});
				});
			}

			// Get forms
			const forms: Array<{
				action?: string;
				method?: string;
				fields: Array<{
					type: string;
					name: string;
					id?: string;
					placeholder?: string;
					required?: boolean;
					options?: string[];
				}>;
			}> = [];

			if (opts.includeForms) {
				document.querySelectorAll('form').forEach((form) => {
					const formData: (typeof forms)[0] = {
						action: form.action || undefined,
						method: form.method || undefined,
						fields: [],
					};

					form.querySelectorAll('input, textarea, select').forEach((field) => {
						const inputEl = field as HTMLInputElement;
						const selectEl = field as HTMLSelectElement;

						const fieldData: (typeof formData.fields)[0] = {
							type:
								field.tagName.toLowerCase() === 'input'
									? inputEl.type || 'text'
									: field.tagName.toLowerCase(),
							name: field.getAttribute('name') || '',
							id: field.id || undefined,
							placeholder: inputEl.placeholder || undefined,
							required: inputEl.required || false,
						};

						// Get select options
						if (field.tagName.toLowerCase() === 'select') {
							fieldData.options = Array.from(selectEl.options).map((opt) => opt.text);
						}

						if (fieldData.name) {
							formData.fields.push(fieldData);
						}
					});

					if (formData.fields.length > 0) {
						forms.push(formData);
					}
				});
			}

			// Get links
			const links: Array<{ href: string; text: string; isExternal: boolean }> = [];
			const currentDomain = window.location.hostname;

			document.querySelectorAll('a[href]').forEach((a) => {
				const anchor = a as HTMLAnchorElement;
				const href = anchor.href;
				const text = anchor.innerText?.trim().substring(0, 50) || '';

				if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
					let isExternal = false;
					try {
						const linkUrl = new URL(href);
						isExternal = linkUrl.hostname !== currentDomain;
					} catch {
						// Invalid URL
					}

					links.push({ href, text, isExternal });
				}
			});

			return {
				description,
				headings: headings.slice(0, 50),
				elements: elements.slice(0, 100),
				forms: forms.slice(0, 10),
				links: links.slice(0, 100),
			};
		},
		{ includeForms: options.includeForms },
	);

	return {
		url,
		title,
		...pageData,
	};
}

/**
 * Full page scrape - combines sitemap and page structure
 */
export async function scrapePage(page: Page, options: ScraperOptions): Promise<ScrapedPageData> {
	const url = page.url();
	const domain = extractDomain(url);

	// Scrape page structure
	const pageData = await scrapePageStructure(page, options);

	// Scrape sitemap if enabled
	let sitemap: ScrapedPageData['sitemap'] | undefined;
	if (options.scrapeSitemap) {
		sitemap = await scrapeSitemap(page, url);
	}

	return {
		...pageData,
		domain,
		timestamp: Date.now(),
		sitemap,
	};
}
