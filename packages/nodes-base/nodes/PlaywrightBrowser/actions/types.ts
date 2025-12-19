export type PlaywrightResource =
	| 'browser'
	| 'page'
	| 'interaction'
	| 'extraction'
	| 'wait'
	| 'session';

export interface BrowserLaunchOptions {
	browserType: 'chromium' | 'firefox' | 'webkit';
	headless: boolean;
	slowMo?: number;
	sessionPath?: string;
	proxy?: {
		server: string;
		username?: string;
		password?: string;
	};
	viewport?: {
		width: number;
		height: number;
	};
}

export interface HumanDelayConfig {
	enabled: boolean;
	min: number;
	max: number;
	typeSpeed?: number;
	variation?: number;
}

export interface PlaywrightExecutionData {
	sessionId: string;
	pageId?: string;
	[key: string]: unknown;
}
