import type { IExecuteFunctions } from 'n8n-workflow';
import type { Page } from 'playwright';
import * as os from 'os';
import * as path from 'path';

import { browserPool } from '../../PlaywrightBrowser/utils/browserPool';
import { applyHumanDelay } from '../../PlaywrightBrowser/utils/humanDelay';

import { runPlanner, type PlannerOutput, type ActionRecord } from './planner';
import {
	runNavigator,
	getActionType,
	getActionArgs,
	type ActionItem,
	type ActionResult,
} from './navigator';
import {
	getIndexedElements,
	drawBoundingBoxes,
	hasSignificantDOMChange,
	type IndexedElement,
} from './elementIndexer';

/**
 * Get the path for storing cookies for a domain
 */
function getCookiePath(domain: string): string {
	const n8nDir = path.join(os.homedir(), '.n8n', 'browser-agent-cookies');
	const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
	return path.join(n8nDir, `${safeDomain}.json`);
}

/**
 * Extract domain from goal text
 */
function extractDomain(goal: string): string {
	const urlMatch = goal.match(/https?:\/\/([^\/\s]+)/);
	if (urlMatch) return urlMatch[1];

	const domainMatch = goal.match(
		/(?:go to|visit|open|navigate to)\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
	);
	if (domainMatch) return domainMatch[1];

	return 'unknown';
}

/**
 * Value source for dynamic data in pipeline generation
 * When valueSource is present, the pipeline generator should use the expression
 * instead of the static value
 */
export interface ValueSource {
	type: 'static' | 'expression' | 'resume' | 'vectorStorage';
	// n8n expression to use in generated pipeline (e.g., "{{ $json.resume.name }}")
	expression?: string;
	// Field type hint for AI to detect (e.g., "name", "email", "phone", "address")
	fieldType?: string;
	// Human-readable label (e.g., "Full Name", "Email Address")
	fieldLabel?: string;
	// For vectorStorage: the query used to retrieve the value
	retrievalQuery?: string;
}

/**
 * A single Playwright action - clean format for pipeline export
 */
export interface PlaywrightAction {
	operation: 'navigate' | 'click' | 'fill' | 'press' | 'scroll' | 'hover' | 'selectOption' | 'wait';
	selector?: string;
	// The actual value used during execution (for logging/debugging)
	value?: string;
	// For dynamic values: how to get the value in the pipeline
	valueSource?: ValueSource;
	url?: string;
	key?: string;
	scrollY?: number;
	ms?: number;
	description?: string;
}

/**
 * Human-provided action correction
 */
export interface HumanCorrection {
	// Direct action specification
	action?: PlaywrightAction;
	// Or provide instruction for AI to interpret
	instruction?: string;
	// Or select element by index from previous screenshot
	elementIndex?: number;
	operation?: 'click' | 'fill' | 'hover';
	value?: string; // For fill operations
}

/**
 * Dynamic data context for form filling
 * Provides data sources that AI can use to fill forms
 */
export interface DataContext {
	// Resume/profile data (name, email, phone, address, etc.)
	resume?: {
		name?: string;
		firstName?: string;
		lastName?: string;
		email?: string;
		phone?: string;
		address?: string;
		city?: string;
		state?: string;
		zip?: string;
		country?: string;
		linkedin?: string;
		github?: string;
		website?: string;
		summary?: string;
		// Allow any additional fields
		[key: string]: string | undefined;
	};
	// Custom key-value data
	customData?: Record<string, string>;
	// Vector storage retrieval function name (for pipeline generator)
	vectorStorageNode?: string;
}

/**
 * Execution options (simplified - no cache)
 */
export interface ExecutionOptions {
	browserOptions: {
		headless: boolean;
		maxSteps: number;
		timeout: number;
		maxRetries: number;
		proxyUrl?: string;
		saveCookies: boolean;
		humanDelay: boolean;
		humanDelayMin: number;
		humanDelayMax: number;
		planningInterval: number;
		maxActionsPerStep: number;
	};
	visionOptions: {
		enabled: boolean;
		screenshotType: 'fullPage' | 'viewport';
	};
	outputOptions: {
		includeScreenshots: boolean;
	};
	// Dynamic data for form filling
	dataContext?: DataContext;
	// Resume from human intervention
	resumeOptions?: {
		// Previous actions to prepend to final output
		previousActions: PlaywrightAction[];
		// Human's correction to apply first
		humanCorrection?: HumanCorrection;
		// URL to navigate to (resume point)
		resumeUrl?: string;
	};
}

/**
 * Result of browser agent execution
 */
export interface ExecutionResult {
	success: boolean;
	result?: string;
	error?: string;
	// Raw action log (for debugging)
	actions: Array<{
		operation: string;
		index?: number;
		selector?: string;
		value?: string;
		success: boolean;
		screenshot?: string;
		reasoning?: string;
	}>;
	// Clean Playwright actions for pipeline generator
	playwrightActions: PlaywrightAction[];
	finalScreenshot?: string;
	executionTime: number;
	aiCallsCount: number;
	// When AI is uncertain - needs human help
	needsHumanHelp?: boolean;
	humanHelpContext?: {
		currentUrl: string;
		currentTitle: string;
		elements: IndexedElement[];
		screenshot?: string;
		lastError?: string;
		suggestedAction?: string;
	};
}

const DEFAULT_PLANNING_INTERVAL = 3;
const DEFAULT_MAX_ACTIONS_PER_STEP = 10;

/**
 * Main execution loop for browser agent
 * Always in "learn" mode - AI decides every action
 * Exports clean PlaywrightAction[] for pipeline generator
 * Supports resuming from human intervention
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
	// Include previous actions if resuming from human intervention
	const playwrightActions: PlaywrightAction[] = options.resumeOptions?.previousActions
		? [...options.resumeOptions.previousActions]
		: [];
	let aiCallsCount = 0;

	const planningInterval = options.browserOptions.planningInterval ?? DEFAULT_PLANNING_INTERVAL;
	const maxActionsPerStep =
		options.browserOptions.maxActionsPerStep ?? DEFAULT_MAX_ACTIONS_PER_STEP;

	try {
		const domain = extractDomain(goal);
		const cookiePath = options.browserOptions.saveCookies ? getCookiePath(domain) : undefined;

		// Launch browser
		console.log(`[BrowserAgent] Launching browser (headless: ${options.browserOptions.headless})`);
		await browserPool.launchBrowser(sessionId, {
			headless: options.browserOptions.headless,
			proxy: options.browserOptions.proxyUrl
				? { server: options.browserOptions.proxyUrl }
				: undefined,
			storageState: cookiePath,
		});
		const page = await browserPool.getPage(sessionId, 'default');
		console.log('[BrowserAgent] Browser launched successfully');

		// Handle resume from human intervention
		if (options.resumeOptions) {
			console.log('[BrowserAgent] Resuming from human intervention');

			// Navigate to resume URL if provided
			if (options.resumeOptions.resumeUrl) {
				console.log(`[BrowserAgent] Navigating to resume URL: ${options.resumeOptions.resumeUrl}`);
				await page.goto(options.resumeOptions.resumeUrl, {
					timeout: options.browserOptions.timeout,
					waitUntil: 'domcontentloaded',
				});
				playwrightActions.push({
					operation: 'navigate',
					url: options.resumeOptions.resumeUrl,
					description: 'Human resumed: navigate to resume point',
				});
			}

			// Apply human correction if provided
			if (options.resumeOptions.humanCorrection) {
				const correction = options.resumeOptions.humanCorrection;
				console.log('[BrowserAgent] Applying human correction');

				if (correction.action) {
					// Direct action from human
					const result = await executeHumanAction(
						page,
						correction.action,
						options.browserOptions.timeout,
					);
					if (result.success) {
						playwrightActions.push({
							...correction.action,
							description: `Human corrected: ${correction.action.description || correction.action.operation}`,
						});
						actions.push({
							operation: correction.action.operation,
							selector: correction.action.selector,
							value: correction.action.value || correction.action.url,
							success: true,
							reasoning: 'Human correction',
						});
					} else {
						console.log(`[BrowserAgent] Human correction failed: ${result.error}`);
					}
				} else if (correction.elementIndex !== undefined && correction.operation) {
					// Human selected element by index - need to get current elements
					const elements = await getIndexedElements(page);
					const element = elements.find((e) => e.index === correction.elementIndex);
					if (element) {
						const humanAction = await executeHumanElementAction(
							page,
							element,
							correction.operation,
							correction.value,
							options.browserOptions.timeout,
						);
						if (humanAction) {
							playwrightActions.push(humanAction);
							actions.push({
								operation: correction.operation,
								index: correction.elementIndex,
								selector: element.selector,
								value: correction.value,
								success: true,
								reasoning: 'Human selected element',
							});
						}
					}
				}
				// Note: correction.instruction is handled by AI in the main loop
			}
		}

		// Execution loop
		const history: ActionRecord[] = [];
		let plannerOutput: PlannerOutput | null = null;
		let step = 0;
		let consecutiveErrors = 0;
		const MAX_CONSECUTIVE_ERRORS = 5;

		while (step < options.browserOptions.maxSteps) {
			step++;
			console.log(`[BrowserAgent] Step ${step}/${options.browserOptions.maxSteps}`);

			// Get indexed elements
			const elements = await getIndexedElements(page);
			const url = page.url();
			const title = await page.title();
			console.log(`[BrowserAgent] Page: ${url} | Elements: ${elements.length}`);

			// Take screenshot with bounding boxes (if vision enabled)
			let screenshot: Buffer | undefined;
			if (options.visionOptions.enabled) {
				screenshot = await drawBoundingBoxes(page, elements);
				console.log('[BrowserAgent] Screenshot with bounding boxes captured');
			}

			// Check if too many consecutive errors - need human help
			if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				console.log('[BrowserAgent] Too many errors - requesting human help');

				const screenshotBase64 = screenshot ? screenshot.toString('base64') : undefined;

				await browserPool.closeBrowser(sessionId);

				return {
					success: false,
					error: 'AI is stuck - needs human assistance',
					actions,
					playwrightActions,
					executionTime: Date.now() - startTime,
					aiCallsCount,
					needsHumanHelp: true,
					humanHelpContext: {
						currentUrl: url,
						currentTitle: title,
						elements,
						screenshot: screenshotBase64,
						lastError: history[history.length - 1]?.error,
						suggestedAction: plannerOutput?.next_steps,
					},
				};
			}

			// Run Planner every N steps
			const shouldRunPlanner =
				step === 1 || step % planningInterval === 0 || plannerOutput?.done === true;

			if (shouldRunPlanner) {
				console.log('[BrowserAgent] Running Planner (strategic analysis)...');
				plannerOutput = await runPlanner(context, goal, url, title, elements, history);
				aiCallsCount++;

				if (plannerOutput.done) {
					console.log('[BrowserAgent] Planner says task is complete');

					let finalScreenshot: string | undefined;
					if (options.outputOptions.includeScreenshots) {
						finalScreenshot = await takeScreenshotBase64(page);
					}

					if (cookiePath) {
						try {
							await browserPool.saveStorageState(sessionId, cookiePath);
						} catch (e) {
							console.log('[BrowserAgent] Failed to save cookies:', e);
						}
					}

					await browserPool.closeBrowser(sessionId);

					return {
						success: true,
						result: plannerOutput.final_answer || 'Goal completed successfully',
						actions,
						playwrightActions,
						finalScreenshot,
						executionTime: Date.now() - startTime,
						aiCallsCount,
					};
				}
			}

			// Run Navigator
			console.log('[BrowserAgent] Running Navigator (tactical execution)...');
			const navigatorOutput = await runNavigator(
				context,
				goal,
				plannerOutput?.next_steps || '',
				url,
				title,
				elements,
				history,
				screenshot,
				maxActionsPerStep,
			);
			aiCallsCount++;

			// Execute actions
			console.log(`[BrowserAgent] Executing ${navigatorOutput.action.length} actions...`);
			const results = await executeMultiAction(
				page,
				navigatorOutput.action,
				elements,
				options.browserOptions.timeout,
			);

			// Process results
			let stepHadSuccess = false;
			for (let i = 0; i < results.length; i++) {
				const action = navigatorOutput.action[i];
				const result = results[i];
				const actionType = getActionType(action);
				const actionArgs = getActionArgs(action);

				// Record in history
				history.push({
					operation: actionType,
					index: actionArgs.index as number | undefined,
					selector: actionArgs.selector as string | undefined,
					value: (actionArgs.text || actionArgs.url || actionArgs.value) as string | undefined,
					success: result.success,
					error: result.error,
				});

				// Find element for selector
				const element =
					actionArgs.index !== undefined
						? elements.find((e) => e.index === actionArgs.index)
						: undefined;

				// Record in actions output
				actions.push({
					operation: actionType,
					index: actionArgs.index as number | undefined,
					selector: element?.selector,
					value: (actionArgs.text || actionArgs.url || actionArgs.value) as string | undefined,
					success: result.success,
					reasoning: actionArgs.intent as string | undefined,
				});

				// Record clean Playwright action (only successful ones)
				if (result.success && actionType !== 'done') {
					const pwAction = mapToPlaywrightAction(
						actionType,
						actionArgs,
						element,
						options.dataContext,
					);
					if (pwAction) {
						playwrightActions.push(pwAction);
					}
					stepHadSuccess = true;
				}

				// Check if done
				if (result.isDone) {
					console.log('[BrowserAgent] Navigator says task is complete');

					let finalScreenshot: string | undefined;
					if (options.outputOptions.includeScreenshots) {
						finalScreenshot = await takeScreenshotBase64(page);
					}

					if (cookiePath) {
						try {
							await browserPool.saveStorageState(sessionId, cookiePath);
						} catch (e) {
							console.log('[BrowserAgent] Failed to save cookies:', e);
						}
					}

					await browserPool.closeBrowser(sessionId);

					return {
						success: true,
						result: result.result || 'Goal completed successfully',
						actions,
						playwrightActions,
						finalScreenshot,
						executionTime: Date.now() - startTime,
						aiCallsCount,
					};
				}
			}

			// Track consecutive errors
			if (stepHadSuccess) {
				consecutiveErrors = 0;
			} else {
				consecutiveErrors++;
			}

			// Human delay between steps
			await applyHumanDelay({
				enabled: options.browserOptions.humanDelay,
				min: options.browserOptions.humanDelayMin,
				max: options.browserOptions.humanDelayMax,
			});
		}

		// Max steps reached
		await browserPool.closeBrowser(sessionId);

		return {
			success: false,
			error: `Max steps (${options.browserOptions.maxSteps}) reached without completing goal`,
			actions,
			playwrightActions,
			executionTime: Date.now() - startTime,
			aiCallsCount,
		};
	} catch (error) {
		try {
			await browserPool.closeBrowser(sessionId);
		} catch {
			// Ignore cleanup errors
		}

		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			actions,
			playwrightActions,
			executionTime: Date.now() - startTime,
			aiCallsCount,
		};
	}
}

/**
 * Detect field type from element attributes for dynamic value mapping
 */
function detectFieldType(
	element: IndexedElement,
): { fieldType: string; fieldLabel: string } | null {
	const text = (element.text || '').toLowerCase();
	const placeholder = (element.placeholder || '').toLowerCase();
	const ariaLabel = (element.ariaLabel || '').toLowerCase();
	const selector = (element.selector || '').toLowerCase();
	const type = (element.type || '').toLowerCase();

	// Extract name/id from selector (e.g., "#firstName" or "[name='email']")
	const combined = `${text} ${placeholder} ${ariaLabel} ${selector} ${type}`;

	// Field type detection patterns
	const patterns: Array<{ pattern: RegExp; fieldType: string; fieldLabel: string }> = [
		// Name fields
		{ pattern: /\b(full\s*name|your\s*name)\b/, fieldType: 'name', fieldLabel: 'Full Name' },
		{
			pattern: /\b(first\s*name|given\s*name|fname)\b/,
			fieldType: 'firstName',
			fieldLabel: 'First Name',
		},
		{
			pattern: /\b(last\s*name|family\s*name|surname|lname)\b/,
			fieldType: 'lastName',
			fieldLabel: 'Last Name',
		},

		// Contact fields
		{ pattern: /\b(email|e-mail)\b/, fieldType: 'email', fieldLabel: 'Email Address' },
		{
			pattern: /\b(phone|telephone|mobile|cell)\b/,
			fieldType: 'phone',
			fieldLabel: 'Phone Number',
		},

		// Address fields
		{ pattern: /\b(address|street)\b/, fieldType: 'address', fieldLabel: 'Address' },
		{ pattern: /\b(city|town)\b/, fieldType: 'city', fieldLabel: 'City' },
		{ pattern: /\b(state|province|region)\b/, fieldType: 'state', fieldLabel: 'State' },
		{ pattern: /\b(zip|postal|postcode)\b/, fieldType: 'zip', fieldLabel: 'ZIP Code' },
		{ pattern: /\b(country)\b/, fieldType: 'country', fieldLabel: 'Country' },

		// Professional fields
		{ pattern: /\b(linkedin)\b/, fieldType: 'linkedin', fieldLabel: 'LinkedIn URL' },
		{ pattern: /\b(github)\b/, fieldType: 'github', fieldLabel: 'GitHub URL' },
		{ pattern: /\b(website|portfolio|url)\b/, fieldType: 'website', fieldLabel: 'Website' },
		{ pattern: /\b(company|employer|organization)\b/, fieldType: 'company', fieldLabel: 'Company' },
		{
			pattern: /\b(title|position|job\s*title|role)\b/,
			fieldType: 'jobTitle',
			fieldLabel: 'Job Title',
		},

		// Application fields
		{ pattern: /\b(cover\s*letter)\b/, fieldType: 'coverLetter', fieldLabel: 'Cover Letter' },
		{
			pattern: /\b(summary|about|bio|introduction)\b/,
			fieldType: 'summary',
			fieldLabel: 'Summary',
		},
		{
			pattern: /\b(salary|compensation|expected\s*salary)\b/,
			fieldType: 'salary',
			fieldLabel: 'Expected Salary',
		},
		{
			pattern: /\b(start\s*date|availability|available)\b/,
			fieldType: 'startDate',
			fieldLabel: 'Start Date',
		},
	];

	for (const { pattern, fieldType, fieldLabel } of patterns) {
		if (pattern.test(combined)) {
			return { fieldType, fieldLabel };
		}
	}

	return null;
}

/**
 * Map Navigator action to clean PlaywrightAction
 * Includes valueSource for dynamic data when filling forms
 */
function mapToPlaywrightAction(
	actionType: string,
	args: Record<string, unknown>,
	element?: IndexedElement,
	dataContext?: DataContext,
): PlaywrightAction | null {
	const description = args.intent as string | undefined;

	switch (actionType) {
		case 'click_element':
			if (!element?.selector) return null;
			return {
				operation: 'click',
				selector: element.selector,
				description,
			};

		case 'input_text': {
			if (!element?.selector) return null;
			const value = args.text as string;

			// Detect if this is a dynamic field
			const fieldInfo = detectFieldType(element);
			let valueSource: ValueSource | undefined;

			if (fieldInfo && dataContext?.resume) {
				// Check if we have data for this field type
				const resumeValue = dataContext.resume[fieldInfo.fieldType];
				if (resumeValue) {
					valueSource = {
						type: 'resume',
						expression: `{{ $json.resume.${fieldInfo.fieldType} }}`,
						fieldType: fieldInfo.fieldType,
						fieldLabel: fieldInfo.fieldLabel,
					};
				}
			} else if (fieldInfo) {
				// No data context but we detected field type - mark for pipeline
				valueSource = {
					type: 'expression',
					expression: `{{ $json.resume.${fieldInfo.fieldType} }}`,
					fieldType: fieldInfo.fieldType,
					fieldLabel: fieldInfo.fieldLabel,
				};
			}

			return {
				operation: 'fill',
				selector: element.selector,
				value,
				valueSource,
				description,
			};
		}

		case 'go_to_url': {
			const url = args.url as string;
			return {
				operation: 'navigate',
				url: url.startsWith('http') ? url : `https://${url}`,
				description,
			};
		}

		case 'send_keys':
			return {
				operation: 'press',
				key: args.keys as string,
				description,
			};

		case 'scroll_down':
			return {
				operation: 'scroll',
				scrollY: (args.pixels as number) || 500,
				description,
			};

		case 'scroll_up':
			return {
				operation: 'scroll',
				scrollY: -((args.pixels as number) || 500),
				description,
			};

		case 'scroll_to_element':
			if (!element?.selector) return null;
			return {
				operation: 'scroll',
				selector: element.selector,
				description,
			};

		case 'hover':
			if (!element?.selector) return null;
			return {
				operation: 'hover',
				selector: element.selector,
				description,
			};

		case 'select_option':
			if (!element?.selector) return null;
			return {
				operation: 'selectOption',
				selector: element.selector,
				value: args.value as string,
				description,
			};

		case 'wait':
			return {
				operation: 'wait',
				ms: ((args.seconds as number) || 1) * 1000,
				description,
			};

		default:
			return null;
	}
}

/**
 * Execute multiple actions in sequence
 */
async function executeMultiAction(
	page: Page,
	actions: ActionItem[],
	elements: IndexedElement[],
	timeout: number,
): Promise<ActionResult[]> {
	const results: ActionResult[] = [];
	let errorCount = 0;
	const MAX_ERRORS = 3;

	for (let i = 0; i < actions.length; i++) {
		const action = actions[i];
		const actionType = getActionType(action);
		const actionArgs = getActionArgs(action);

		console.log(`[BrowserAgent] Action ${i + 1}/${actions.length}: ${actionType}`);

		if (errorCount >= MAX_ERRORS) {
			console.log('[BrowserAgent] Too many errors, stopping batch');
			break;
		}

		try {
			// Check for DOM changes after first action
			if (i > 0) {
				const newElements = await getIndexedElements(page);
				if (hasSignificantDOMChange(elements, newElements)) {
					console.log('[BrowserAgent] DOM changed significantly, stopping batch');
					break;
				}
			}

			const result = await executeSingleAction(page, actionType, actionArgs, elements, timeout);
			results.push(result);

			if (result.success) {
				console.log(`[BrowserAgent] Action ${actionType} succeeded`);
			} else {
				console.log(`[BrowserAgent] Action ${actionType} failed: ${result.error}`);
				errorCount++;
			}

			if (result.isDone) {
				break;
			}

			await page.waitForTimeout(1000);
		} catch (error) {
			errorCount++;
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.log(`[BrowserAgent] Action ${actionType} error: ${errorMsg}`);
			results.push({
				success: false,
				error: errorMsg,
			});
		}
	}

	return results;
}

/**
 * Execute a single action
 */
async function executeSingleAction(
	page: Page,
	actionType: string,
	args: Record<string, unknown>,
	elements: IndexedElement[],
	timeout: number,
): Promise<ActionResult> {
	try {
		switch (actionType) {
			case 'click_element': {
				const index = args.index as number;
				const element = elements.find((e) => e.index === index);
				if (!element) {
					return { success: false, error: `Element [${index}] not found` };
				}
				await page.locator(element.selector).first().click({ timeout });
				return { success: true };
			}

			case 'input_text': {
				const index = args.index as number;
				const text = args.text as string;
				const element = elements.find((e) => e.index === index);
				if (!element) {
					return { success: false, error: `Element [${index}] not found` };
				}
				await page.locator(element.selector).first().fill(text, { timeout });
				return { success: true };
			}

			case 'go_to_url': {
				const url = args.url as string;
				const fullUrl = url.startsWith('http') ? url : `https://${url}`;
				await page.goto(fullUrl, { timeout, waitUntil: 'domcontentloaded' });
				return { success: true };
			}

			case 'send_keys': {
				const keys = args.keys as string;
				await page.keyboard.press(keys);
				return { success: true };
			}

			case 'scroll_down': {
				const pixels = (args.pixels as number) || 500;
				await page.evaluate((y) => window.scrollBy(0, y), pixels);
				return { success: true };
			}

			case 'scroll_up': {
				const pixels = (args.pixels as number) || 500;
				await page.evaluate((y) => window.scrollBy(0, -y), pixels);
				return { success: true };
			}

			case 'scroll_to_element': {
				const index = args.index as number;
				const element = elements.find((e) => e.index === index);
				if (!element) {
					return { success: false, error: `Element [${index}] not found` };
				}
				await page.locator(element.selector).first().scrollIntoViewIfNeeded({ timeout });
				return { success: true };
			}

			case 'wait': {
				const seconds = (args.seconds as number) || 1;
				await page.waitForTimeout(seconds * 1000);
				return { success: true };
			}

			case 'hover': {
				const index = args.index as number;
				const element = elements.find((e) => e.index === index);
				if (!element) {
					return { success: false, error: `Element [${index}] not found` };
				}
				await page.locator(element.selector).first().hover({ timeout });
				return { success: true };
			}

			case 'select_option': {
				const index = args.index as number;
				const value = args.value as string;
				const element = elements.find((e) => e.index === index);
				if (!element) {
					return { success: false, error: `Element [${index}] not found` };
				}
				await page.locator(element.selector).first().selectOption(value, { timeout });
				return { success: true };
			}

			case 'done': {
				const text = args.text as string;
				const success = args.success as boolean;
				return { success: true, isDone: true, result: text, data: { success } };
			}

			default:
				return { success: false, error: `Unknown action type: ${actionType}` };
		}
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

/**
 * Execute a human-provided PlaywrightAction
 */
async function executeHumanAction(
	page: Page,
	action: PlaywrightAction,
	timeout: number,
): Promise<ActionResult> {
	try {
		switch (action.operation) {
			case 'navigate':
				if (!action.url) return { success: false, error: 'URL required for navigate' };
				await page.goto(action.url, { timeout, waitUntil: 'domcontentloaded' });
				return { success: true };

			case 'click':
				if (!action.selector) return { success: false, error: 'Selector required for click' };
				await page.locator(action.selector).first().click({ timeout });
				return { success: true };

			case 'fill':
				if (!action.selector) return { success: false, error: 'Selector required for fill' };
				await page
					.locator(action.selector)
					.first()
					.fill(action.value || '', { timeout });
				return { success: true };

			case 'press':
				if (!action.key) return { success: false, error: 'Key required for press' };
				await page.keyboard.press(action.key);
				return { success: true };

			case 'scroll':
				if (action.selector) {
					await page.locator(action.selector).first().scrollIntoViewIfNeeded({ timeout });
				} else {
					await page.evaluate((y) => window.scrollBy(0, y), action.scrollY || 500);
				}
				return { success: true };

			case 'hover':
				if (!action.selector) return { success: false, error: 'Selector required for hover' };
				await page.locator(action.selector).first().hover({ timeout });
				return { success: true };

			case 'selectOption':
				if (!action.selector)
					return { success: false, error: 'Selector required for selectOption' };
				await page
					.locator(action.selector)
					.first()
					.selectOption(action.value || '', { timeout });
				return { success: true };

			case 'wait':
				await page.waitForTimeout(action.ms || 1000);
				return { success: true };

			default:
				return { success: false, error: `Unknown operation: ${action.operation}` };
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Execute human's element selection (by index) as a PlaywrightAction
 */
async function executeHumanElementAction(
	page: Page,
	element: IndexedElement,
	operation: 'click' | 'fill' | 'hover',
	value: string | undefined,
	timeout: number,
): Promise<PlaywrightAction | null> {
	try {
		switch (operation) {
			case 'click':
				await page.locator(element.selector).first().click({ timeout });
				return {
					operation: 'click',
					selector: element.selector,
					description: `Human selected: click [${element.index}] ${element.text || element.type}`,
				};

			case 'fill':
				await page
					.locator(element.selector)
					.first()
					.fill(value || '', { timeout });
				return {
					operation: 'fill',
					selector: element.selector,
					value,
					description: `Human selected: fill [${element.index}] with "${value}"`,
				};

			case 'hover':
				await page.locator(element.selector).first().hover({ timeout });
				return {
					operation: 'hover',
					selector: element.selector,
					description: `Human selected: hover [${element.index}]`,
				};

			default:
				return null;
		}
	} catch (error) {
		console.log(`[BrowserAgent] Human element action failed: ${error}`);
		return null;
	}
}
