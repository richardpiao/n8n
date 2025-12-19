import type { IExecuteFunctions } from 'n8n-workflow';
import type { Page } from 'playwright';

import { browserPool } from '../../PlaywrightBrowser/utils/browserPool';
import { applyHumanDelay } from '../../PlaywrightBrowser/utils/humanDelay';

import type { PlannerResult, PageContext, ActionHistory, PlaywrightOperation } from './aiPlanner';
import { planNextAction, fixBrokenStep } from './aiPlanner';
import { scrapePageStructure } from './scraper';
import { analyzeScreenshotWithChatModel } from './visionAnalyzer';
import {
	findMatchingPipeline,
	savePipeline,
	extractDomain,
	extractParams,
	applyParamsToStep,
	type CachedPipeline,
	type CachedStep,
} from './pipelineCache';

/**
 * Simplified execution options
 */
export interface ExecutionOptions {
	browserOptions: {
		headless: boolean;
		maxSteps: number;
		timeout: number;
		humanDelays: boolean;
	};
	visionOptions: {
		enabled: boolean;
		screenshotType: 'fullPage' | 'viewport';
	};
	cacheOptions: {
		enabled: boolean;
		autoSave: boolean;
	};
	outputOptions: {
		exportPipeline: boolean;
		includeScreenshots: boolean;
	};
}

/**
 * Result of browser agent execution
 */
export interface ExecutionResult {
	success: boolean;
	result?: string;
	error?: string;
	actions: Array<{
		operation: string;
		selector?: string;
		value?: string;
		success: boolean;
		screenshot?: string;
		reasoning?: string;
		usedAI: boolean;
	}>;
	finalScreenshot?: string;
	executionTime: number;
	mode: 'learn' | 'replay' | 'fix';
	aiCallsCount: number;
	pipeline?: CachedPipeline;
}

/**
 * Main execution loop for browser agent
 */
export async function executeGoal(
	context: IExecuteFunctions,
	goal: string,
	options: ExecutionOptions,
): Promise<ExecutionResult> {
	console.log('[executeGoal] Received goal:', JSON.stringify(goal));
	const startTime = Date.now();
	const sessionId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
	const actions: ExecutionResult['actions'] = [];
	let mode: ExecutionResult['mode'] = 'learn';
	let aiCallsCount = 0;
	let savedPipeline: CachedPipeline | undefined;

	try {
		// 1. Extract domain from goal
		const domain = extractDomain(goal);

		// 2. Check for cached pipeline if caching is enabled
		if (options.cacheOptions.enabled) {
			const cachedPipeline = findMatchingPipeline(domain, goal);

			if (cachedPipeline) {
				mode = 'replay';

				// Launch browser for replay
				await browserPool.launchBrowser(sessionId, {
					headless: options.browserOptions.headless,
				});
				const page = await browserPool.getPage(sessionId, 'default');

				// Extract parameters from goal
				const params = extractParams(goal, cachedPipeline.goalPattern, cachedPipeline.params);

				// Execute cached steps
				const replayResult = await executeCachedPipeline(
					page,
					context,
					cachedPipeline,
					params,
					goal,
					options,
				);

				if (replayResult.success) {
					// Take final screenshot
					let finalScreenshot: string | undefined;
					if (options.outputOptions.includeScreenshots) {
						finalScreenshot = await takeScreenshotBase64(page);
					}

					await browserPool.closeBrowser(sessionId);

					return {
						success: true,
						result: `Completed using cached pipeline (${replayResult.stepsCompleted} steps, ${replayResult.aiCalls} AI calls)`,
						actions: replayResult.actions,
						finalScreenshot,
						executionTime: Date.now() - startTime,
						mode: replayResult.aiCalls > 0 ? 'fix' : 'replay',
						aiCallsCount: replayResult.aiCalls,
						pipeline: cachedPipeline,
					};
				}

				// Replay failed - fall through to learn mode
				await browserPool.closeBrowser(sessionId);
				mode = 'learn';
			}
		}

		// 3. Learn mode - Launch browser and execute with AI
		await browserPool.launchBrowser(sessionId, {
			headless: options.browserOptions.headless,
		});
		const page = await browserPool.getPage(sessionId, 'default');

		// 4. Execution loop
		const history: ActionHistory[] = [];
		const learnedSteps: CachedStep[] = [];

		for (let step = 0; step < options.browserOptions.maxSteps; step++) {
			// Get current page state
			const pageContext = await getPageContext(page, context, options, goal);

			// Ask AI what to do
			const aiResponse = await planNextAction(context, goal, pageContext, history);
			aiCallsCount++;

			// Check if done
			if (aiResponse.isDone) {
				// Take final screenshot
				let finalScreenshot: string | undefined;
				if (options.outputOptions.includeScreenshots) {
					finalScreenshot = await takeScreenshotBase64(page);
				}

				// Save pipeline to cache if enabled
				if (
					options.cacheOptions.enabled &&
					options.cacheOptions.autoSave &&
					learnedSteps.length > 0
				) {
					savedPipeline = savePipeline(domain, goal, learnedSteps);
				}

				await browserPool.closeBrowser(sessionId);

				return {
					success: true,
					result: aiResponse.result || 'Goal completed successfully',
					actions,
					finalScreenshot,
					executionTime: Date.now() - startTime,
					mode,
					aiCallsCount,
					pipeline: savedPipeline,
				};
			}

			// Apply human-like delay if enabled
			if (options.browserOptions.humanDelays) {
				await applyHumanDelay({ enabled: true, min: 100, max: 500 });
			}

			// Execute the action using Playwright
			const actionResult = await executePlaywrightAction(
				page,
				aiResponse,
				options.browserOptions.timeout,
			);

			// Take screenshot if enabled
			let screenshot: string | undefined;
			if (options.outputOptions.includeScreenshots && actionResult.success) {
				screenshot = await takeScreenshotBase64(page);
			}

			// Record action
			actions.push({
				operation: aiResponse.operation,
				selector: aiResponse.selector,
				value: aiResponse.value || aiResponse.url,
				success: actionResult.success,
				screenshot,
				reasoning: aiResponse.reasoning,
				usedAI: true,
			});

			// Update history for AI context
			history.push({
				operation: aiResponse.operation,
				selector: aiResponse.selector,
				value: aiResponse.value || aiResponse.url,
				success: actionResult.success,
				error: actionResult.error,
			});

			// Record step for caching (determine if fixed or dynamic)
			if (actionResult.success) {
				const stepType = isFixedStep(aiResponse) ? 'fixed' : 'dynamic';
				learnedSteps.push({
					type: stepType,
					operation: aiResponse.operation,
					selector: aiResponse.selector,
					value: aiResponse.value,
					url: aiResponse.url,
					key: aiResponse.key,
					scrollY: aiResponse.scrollY,
					ms: aiResponse.ms,
					script: aiResponse.script,
					attribute: aiResponse.attribute,
					filePath: aiResponse.filePath,
					description: stepType === 'dynamic' ? aiResponse.reasoning : undefined,
				});
			}

			// Small delay between actions
			await page.waitForTimeout(300);
		}

		// Max steps reached
		await browserPool.closeBrowser(sessionId);

		return {
			success: false,
			error: `Max steps (${options.browserOptions.maxSteps}) reached without completing goal`,
			actions,
			executionTime: Date.now() - startTime,
			mode,
			aiCallsCount,
		};
	} catch (error) {
		// Clean up on error
		try {
			await browserPool.closeBrowser(sessionId);
		} catch {
			// Ignore cleanup errors
		}

		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			actions,
			executionTime: Date.now() - startTime,
			mode,
			aiCallsCount,
		};
	}
}

/**
 * Determine if a step should be cached as fixed (replayable without AI)
 */
function isFixedStep(action: PlannerResult): boolean {
	// Navigation and form filling with specific values are fixed
	const fixedOperations = [
		'navigate',
		'click',
		'fill',
		'type',
		'press',
		'check',
		'selectOption',
		'scroll',
	];

	if (!fixedOperations.includes(action.operation)) {
		return false;
	}

	// If it has a specific selector, it's more likely to be fixed
	if (action.selector && action.selector.startsWith('#')) {
		return true;
	}

	// If it has a specific value or URL, it's fixed
	if (action.url || action.value) {
		return true;
	}

	return false;
}

/**
 * Execute a cached pipeline with fixed/dynamic step handling
 */
async function executeCachedPipeline(
	page: Page,
	context: IExecuteFunctions,
	pipeline: CachedPipeline,
	params: Record<string, string>,
	goal: string,
	options: ExecutionOptions,
): Promise<{
	success: boolean;
	stepsCompleted: number;
	aiCalls: number;
	actions: ExecutionResult['actions'];
}> {
	const actions: ExecutionResult['actions'] = [];
	let aiCalls = 0;

	for (let i = 0; i < pipeline.steps.length; i++) {
		const step = pipeline.steps[i];

		if (step.type === 'fixed') {
			// Execute fixed step directly
			const appliedStep = applyParamsToStep(step, params);
			const result = await executePlaywrightAction(
				page,
				stepToPlannerResult(appliedStep),
				options.browserOptions.timeout,
			);

			actions.push({
				operation: step.operation,
				selector: step.selector,
				value: appliedStep.value || appliedStep.url,
				success: result.success,
				usedAI: false,
			});

			if (!result.success) {
				// Try to fix with AI
				const pageContext = await getPageContext(page, context, options, goal);
				const fixedAction = await fixBrokenStep(
					context,
					{
						resource: 'interaction',
						operation: step.operation,
						selector: step.selector,
						value: step.value,
						recordedAt: Date.now(),
					},
					pageContext,
					result.error || 'Step failed',
				);
				aiCalls++;

				const retryResult = await executePlaywrightAction(
					page,
					fixedAction,
					options.browserOptions.timeout,
				);
				if (!retryResult.success) {
					return { success: false, stepsCompleted: i, aiCalls, actions };
				}
			}
		} else {
			// Dynamic step - always use AI
			const pageContext = await getPageContext(page, context, options, goal);
			const aiAction = await planNextAction(context, goal, pageContext, []);
			aiCalls++;

			const result = await executePlaywrightAction(page, aiAction, options.browserOptions.timeout);

			actions.push({
				operation: aiAction.operation,
				selector: aiAction.selector,
				value: aiAction.value || aiAction.url,
				success: result.success,
				reasoning: aiAction.reasoning,
				usedAI: true,
			});

			if (!result.success) {
				return { success: false, stepsCompleted: i, aiCalls, actions };
			}
		}

		// Human-like delay
		if (options.browserOptions.humanDelays) {
			await applyHumanDelay({ enabled: true, min: 100, max: 500 });
		}
	}

	return { success: true, stepsCompleted: pipeline.steps.length, aiCalls, actions };
}

/**
 * Convert cached step to PlannerResult format
 */
function stepToPlannerResult(step: CachedStep): PlannerResult {
	return {
		operation: step.operation as PlaywrightOperation,
		resource: 'interaction',
		selector: step.selector,
		value: step.value,
		url: step.url,
		key: step.key,
		scrollY: step.scrollY,
		ms: step.ms,
		script: step.script,
		attribute: step.attribute,
		filePath: step.filePath,
		reasoning: step.description || 'Cached step',
		isDone: false,
	};
}

/**
 * Get current page context for AI
 * Uses scraper and optional vision fallback
 */
async function getPageContext(
	page: Page,
	context: IExecuteFunctions,
	options: ExecutionOptions,
	goal: string,
): Promise<PageContext> {
	const url = page.url();
	const title = await page.title();

	// Get interactive elements from page using scraper
	const scraperOptions = {
		scrapeSitemap: false,
		scrapeDepth: 0,
		maxPages: 1,
		includeForms: true,
	};
	const pageData = await scrapePageStructure(page, scraperOptions);

	// Convert to PageContext format
	const elements = pageData.elements.map((el, index) => ({
		index,
		selector: el.selector,
		type: el.type,
		text: el.text || '',
		placeholder: el.placeholder,
		href: el.href,
	}));

	// If elements are sparse and vision is enabled, try vision fallback
	if (elements.length < 5 && options.visionOptions.enabled) {
		const visionResult = await analyzeScreenshotWithChatModel(
			context,
			page,
			options.visionOptions,
			goal,
		);

		if (visionResult) {
			// Merge vision elements
			const visionElements = visionResult.elements.map((el, i) => ({
				index: elements.length + i,
				selector: el.suggestedSelector || `[vision-${i}]`,
				type: el.type,
				text: el.text || el.description,
				placeholder: undefined,
				href: undefined,
			}));

			return {
				url,
				title,
				elements: [...elements, ...visionElements],
				forms: pageData.forms,
			};
		}
	}

	return { url, title, elements, forms: pageData.forms };
}

/**
 * Execute a Playwright action based on AI decision
 * Supports all 24 operations
 */
async function executePlaywrightAction(
	page: Page,
	action: PlannerResult,
	timeout: number,
): Promise<{ success: boolean; error?: string; data?: unknown }> {
	try {
		const operation = action.operation as PlaywrightOperation;

		switch (operation) {
			// === INTERACTION (9) ===
			case 'click': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for click' };
				}
				await page.locator(action.selector).first().click({ timeout });
				break;
			}

			case 'fill': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for fill' };
				}
				await page
					.locator(action.selector)
					.first()
					.fill(action.value || '', { timeout });
				break;
			}

			case 'type': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for type' };
				}
				await page
					.locator(action.selector)
					.first()
					.pressSequentially(action.value || '', {
						delay: 50,
						timeout,
					});
				break;
			}

			case 'press': {
				const key = action.key || action.value || 'Enter';
				if (action.selector) {
					await page.locator(action.selector).first().press(key, { timeout });
				} else {
					await page.keyboard.press(key);
				}
				break;
			}

			case 'hover': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for hover' };
				}
				await page.locator(action.selector).first().hover({ timeout });
				break;
			}

			case 'scroll': {
				const scrollY = action.scrollY || 500;
				if (action.selector) {
					await page.locator(action.selector).first().scrollIntoViewIfNeeded({ timeout });
				} else {
					await page.evaluate((y) => window.scrollBy(0, y), scrollY);
				}
				break;
			}

			case 'check': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for check' };
				}
				await page.locator(action.selector).first().check({ timeout });
				break;
			}

			case 'selectOption': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for selectOption' };
				}
				await page
					.locator(action.selector)
					.first()
					.selectOption(action.value || '', { timeout });
				break;
			}

			case 'uploadFile': {
				if (!action.selector || !action.filePath) {
					return { success: false, error: 'Selector and filePath required for uploadFile' };
				}
				await page.locator(action.selector).first().setInputFiles(action.filePath, { timeout });
				break;
			}

			// === PAGE (4) ===
			case 'navigate': {
				const url = action.url || action.value;
				if (!url) {
					return { success: false, error: 'No URL provided for navigate' };
				}
				const fullUrl = url.startsWith('http') ? url : `https://${url}`;
				await page.goto(fullUrl, { timeout, waitUntil: 'domcontentloaded' });
				break;
			}

			case 'reload': {
				await page.reload({ timeout, waitUntil: 'domcontentloaded' });
				break;
			}

			case 'goBack': {
				await page.goBack({ timeout, waitUntil: 'domcontentloaded' });
				break;
			}

			case 'goForward': {
				await page.goForward({ timeout, waitUntil: 'domcontentloaded' });
				break;
			}

			// === EXTRACTION (7) ===
			case 'screenshot': {
				const buffer = await page.screenshot({ type: 'png', fullPage: false });
				return { success: true, data: buffer.toString('base64') };
			}

			case 'getText': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for getText' };
				}
				const text = await page.locator(action.selector).first().textContent({ timeout });
				return { success: true, data: text };
			}

			case 'getContent': {
				const content = await page.content();
				return { success: true, data: content };
			}

			case 'getAttribute': {
				if (!action.selector || !action.attribute) {
					return { success: false, error: 'Selector and attribute required for getAttribute' };
				}
				const attrValue = await page
					.locator(action.selector)
					.first()
					.getAttribute(action.attribute, { timeout });
				return { success: true, data: attrValue };
			}

			case 'getUrl': {
				const currentUrl = page.url();
				const pageTitle = await page.title();
				return { success: true, data: { url: currentUrl, title: pageTitle } };
			}

			case 'getPageInfo': {
				const pageUrl = page.url();
				const pageTitle = await page.title();
				return { success: true, data: { url: pageUrl, title: pageTitle } };
			}

			case 'evaluate': {
				if (!action.script) {
					return { success: false, error: 'No script provided for evaluate' };
				}
				const result = await page.evaluate((script) => {
					return new Function(script)();
				}, action.script);
				return { success: true, data: result };
			}

			// === WAIT (4) ===
			case 'waitForSelector': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for waitForSelector' };
				}
				await page.waitForSelector(action.selector, { timeout: action.ms || timeout });
				break;
			}

			case 'waitForTimeout': {
				const ms = action.ms || 1000;
				await page.waitForTimeout(ms);
				break;
			}

			case 'waitForNavigation': {
				await page.waitForLoadState('domcontentloaded', { timeout });
				break;
			}

			case 'waitForFunction': {
				if (!action.script) {
					return { success: false, error: 'No script provided for waitForFunction' };
				}
				await page.waitForFunction(action.script, { timeout: action.ms || timeout });
				break;
			}

			// === DONE ===
			case 'done': {
				break;
			}

			default:
				return { success: false, error: `Unknown operation: ${operation}` };
		}

		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Take a screenshot and return as base64
 */
async function takeScreenshotBase64(page: Page): Promise<string> {
	try {
		const buffer = await page.screenshot({ type: 'png', fullPage: false });
		return buffer.toString('base64');
	} catch {
		return '';
	}
}
