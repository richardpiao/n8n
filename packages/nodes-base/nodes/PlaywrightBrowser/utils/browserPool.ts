import type { Browser, BrowserContext, Page, LaunchOptions } from 'playwright';

interface BrowserInstance {
	browser: Browser;
	context: BrowserContext;
	pages: Map<string, Page>;
	createdAt: number;
}

/**
 * Singleton browser pool that manages browser instances across workflow executions.
 * Browsers persist between runs to maintain session state.
 */
class BrowserPool {
	private static instance: BrowserPool;
	private browsers: Map<string, BrowserInstance> = new Map();
	private playwright: typeof import('playwright') | null = null;

	private constructor() {}

	static getInstance(): BrowserPool {
		if (!BrowserPool.instance) {
			BrowserPool.instance = new BrowserPool();
		}
		return BrowserPool.instance;
	}

	private async getPlaywright() {
		if (!this.playwright) {
			this.playwright = await import('playwright');
		}
		return this.playwright;
	}

	async launchBrowser(
		sessionId: string,
		options: {
			browserType?: 'chromium' | 'firefox' | 'webkit';
			headless?: boolean;
			slowMo?: number;
			proxy?: {
				server: string;
				username?: string;
				password?: string;
			};
			viewport?: {
				width: number;
				height: number;
			};
			storageState?: string;
		} = {},
	): Promise<{ sessionId: string; pageId: string }> {
		const {
			browserType = 'chromium',
			headless = true,
			slowMo = 0,
			proxy,
			viewport = { width: 1920, height: 1080 },
			storageState,
		} = options;

		// If session already exists, return it
		if (this.browsers.has(sessionId)) {
			const instance = this.browsers.get(sessionId)!;
			const pageId = instance.pages.keys().next().value || 'default';
			return { sessionId, pageId };
		}

		const pw = await this.getPlaywright();

		const launchOptions: LaunchOptions = {
			headless,
			slowMo,
		};

		if (proxy?.server) {
			launchOptions.proxy = {
				server: proxy.server,
				username: proxy.username,
				password: proxy.password,
			};
		}

		const browser = await pw[browserType].launch(launchOptions);

		// Create context with optional storage state (for session persistence)
		const contextOptions: Parameters<Browser['newContext']>[0] = {
			viewport,
		};

		if (storageState) {
			try {
				const fs = await import('fs/promises');
				const state = JSON.parse(await fs.readFile(storageState, 'utf-8'));
				contextOptions.storageState = state;
			} catch {
				// Storage state file doesn't exist yet, that's fine
			}
		}

		const context = await browser.newContext(contextOptions);
		const page = await context.newPage();
		const pageId = 'default';

		const instance: BrowserInstance = {
			browser,
			context,
			pages: new Map([[pageId, page]]),
			createdAt: Date.now(),
		};

		this.browsers.set(sessionId, instance);

		return { sessionId, pageId };
	}

	async getPage(sessionId: string, pageId: string = 'default'): Promise<Page> {
		const instance = this.browsers.get(sessionId);
		if (!instance) {
			throw new Error(`No browser session found with ID: ${sessionId}`);
		}

		let page = instance.pages.get(pageId);
		if (!page) {
			// Create a new page if it doesn't exist
			page = await instance.context.newPage();
			instance.pages.set(pageId, page);
		}

		return page;
	}

	async getContext(sessionId: string): Promise<BrowserContext> {
		const instance = this.browsers.get(sessionId);
		if (!instance) {
			throw new Error(`No browser session found with ID: ${sessionId}`);
		}
		return instance.context;
	}

	async closeBrowser(sessionId: string): Promise<void> {
		const instance = this.browsers.get(sessionId);
		if (instance) {
			await instance.browser.close();
			this.browsers.delete(sessionId);
		}
	}

	async closeAllBrowsers(): Promise<void> {
		for (const [sessionId] of this.browsers) {
			await this.closeBrowser(sessionId);
		}
	}

	hasSession(sessionId: string): boolean {
		return this.browsers.has(sessionId);
	}

	getActiveSessions(): string[] {
		return Array.from(this.browsers.keys());
	}
}

export const browserPool = BrowserPool.getInstance();
