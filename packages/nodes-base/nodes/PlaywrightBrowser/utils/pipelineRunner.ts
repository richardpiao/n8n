import type { Page } from 'playwright';

import type { ActionMemory, ActionStep } from './actionMemory';
import { actionMemoryStore } from './actionMemory';
import { browserPool } from './browserPool';

/**
 * Calculate a human-like delay with some variation
 */
function calculateHumanDelay(baseDelay: number): number {
	const variation = 0.3; // 30% variation
	const min = baseDelay * (1 - variation);
	const max = baseDelay * (1 + variation);
	return Math.floor(min + Math.random() * (max - min));
}

/**
 * Result of a pipeline step execution
 */
export interface StepResult {
	success: boolean;
	stepIndex: number;
	action: ActionStep;
	error?: string;
	/** Context for AI fallback if step failed */
	context?: {
		currentUrl: string;
		expectedSelector?: string;
		availableElements?: string[];
		screenshot?: string;
	};
}

/**
 * Result of a full pipeline execution
 */
export interface PipelineResult {
	success: boolean;
	completedSteps: number;
	totalSteps: number;
	failedStep?: StepResult;
	/** All step results */
	steps: StepResult[];
}

/**
 * Options for pipeline execution
 */
export interface PipelineOptions {
	/** Session ID for browser */
	sessionId: string;
	/** Page ID within session */
	pageId?: string;
	/** Variables to substitute in actions */
	variables: Record<string, string>;
	/** Timeout for each step in ms */
	stepTimeout?: number;
	/** Whether to take screenshots for validation */
	validateWithScreenshots?: boolean;
	/** Whether to add human-like delays */
	humanLikeDelays?: boolean;
}

/**
 * Substitutes variables in a string
 * e.g., "search for {{job_title}}" with variables {job_title: "developer"} -> "search for developer"
 */
function substituteVariables(text: string, variables: Record<string, string>): string {
	let result = text;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
	}
	return result;
}

/**
 * Try to find an element using primary selector or fallbacks
 */
async function findElement(
	page: Page,
	selector: string,
	fallbacks?: string[],
): Promise<{ found: boolean; usedSelector: string }> {
	// Try primary selector
	try {
		const element = page.locator(selector);
		const count = await element.count();
		if (count > 0) {
			return { found: true, usedSelector: selector };
		}
	} catch {
		// Selector failed, try fallbacks
	}

	// Try fallback selectors
	if (fallbacks) {
		for (const fallback of fallbacks) {
			try {
				const element = page.locator(fallback);
				const count = await element.count();
				if (count > 0) {
					return { found: true, usedSelector: fallback };
				}
			} catch {
				// This fallback failed, try next
			}
		}
	}

	return { found: false, usedSelector: selector };
}

/**
 * Get context about current page state for AI fallback
 */
async function getFailureContext(page: Page, action: ActionStep): Promise<StepResult['context']> {
	const context: StepResult['context'] = {
		currentUrl: page.url(),
		expectedSelector: action.selector,
	};

	// Get available interactive elements
	try {
		const elements = await page.evaluate(() => {
			const interactiveElements: string[] = [];
			const selectors = ['button', 'a', 'input', 'select', 'textarea', '[role="button"]'];

			for (const sel of selectors) {
				document.querySelectorAll(sel).forEach((el) => {
					const text = (el as HTMLElement).innerText?.substring(0, 50) || '';
					const id = el.id ? `#${el.id}` : '';
					const classes = el.className ? `.${el.className.split(' ').join('.')}` : '';
					interactiveElements.push(`${el.tagName.toLowerCase()}${id}${classes}: "${text}"`);
				});
			}

			return interactiveElements.slice(0, 20); // Limit to 20 elements
		});
		context.availableElements = elements;
	} catch {
		// Ignore errors getting context
	}

	return context;
}

/**
 * Execute a single pipeline step
 */
async function executeStep(
	page: Page,
	action: ActionStep,
	variables: Record<string, string>,
	options: PipelineOptions,
): Promise<{ success: boolean; error?: string; usedSelector?: string }> {
	const timeout = options.stepTimeout || 30000;

	try {
		switch (action.resource) {
			case 'page': {
				switch (action.operation) {
					case 'navigate': {
						const url = substituteVariables(action.url || '', variables);
						await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
						break;
					}
					case 'reload':
						await page.reload({ timeout });
						break;
					case 'goBack':
						await page.goBack({ timeout });
						break;
					case 'goForward':
						await page.goForward({ timeout });
						break;
				}
				break;
			}

			case 'interaction': {
				if (!action.selector) {
					return { success: false, error: 'No selector provided for interaction' };
				}

				const { found, usedSelector } = await findElement(
					page,
					action.selector,
					action.selectorFallbacks,
				);

				if (!found) {
					return {
						success: false,
						error: `Element not found: ${action.selector}`,
						usedSelector,
					};
				}

				const element = page.locator(usedSelector).first();

				switch (action.operation) {
					case 'click':
						await element.click({ timeout });
						break;
					case 'fill': {
						const value = substituteVariables(action.value || '', variables);
						await element.fill(value, { timeout });
						break;
					}
					case 'type': {
						const value = substituteVariables(action.value || '', variables);
						await element.pressSequentially(value, { delay: 50 });
						break;
					}
					case 'check':
						await element.check({ timeout });
						break;
					case 'hover':
						await element.hover({ timeout });
						break;
					case 'press':
						await page.keyboard.press(action.value || 'Enter');
						break;
					case 'selectOption':
						await element.selectOption(action.value || '', { timeout });
						break;
				}

				return { success: true, usedSelector };
			}

			case 'wait': {
				switch (action.operation) {
					case 'waitForSelector':
						if (action.selector) {
							await page.waitForSelector(action.selector, { timeout });
						}
						break;
					case 'waitForNavigation':
						await page.waitForLoadState('domcontentloaded', { timeout });
						break;
					case 'waitForTimeout':
						await page.waitForTimeout(action.waitAfter || 1000);
						break;
				}
				break;
			}
		}

		// Add human-like delay if enabled
		if (options.humanLikeDelays && action.waitAfter) {
			await page.waitForTimeout(calculateHumanDelay(action.waitAfter));
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
 * Execute a complete pipeline (recorded workflow)
 */
export async function executePipeline(
	workflow: ActionMemory,
	options: PipelineOptions,
): Promise<PipelineResult> {
	const result: PipelineResult = {
		success: false,
		completedSteps: 0,
		totalSteps: workflow.actions.length,
		steps: [],
	};

	const page = await browserPool.getPage(options.sessionId, options.pageId || 'default');

	for (let i = 0; i < workflow.actions.length; i++) {
		const action = workflow.actions[i];

		const stepResult = await executeStep(page, action, options.variables, options);

		const stepResultWithContext: StepResult = {
			success: stepResult.success,
			stepIndex: i,
			action,
		};

		if (!stepResult.success) {
			stepResultWithContext.error = stepResult.error;
			stepResultWithContext.context = await getFailureContext(page, action);

			result.steps.push(stepResultWithContext);
			result.failedStep = stepResultWithContext;

			// Record failure in memory
			actionMemoryStore.recordFailure(workflow.domain, workflow.goalPattern);

			return result;
		}

		// If we used a different selector, update the action in memory
		if (stepResult.usedSelector && stepResult.usedSelector !== action.selector) {
			actionMemoryStore.updateAction(workflow.domain, workflow.goalPattern, i, {
				...action,
				selector: stepResult.usedSelector,
			});
		}

		result.steps.push(stepResultWithContext);
		result.completedSteps++;
	}

	result.success = true;

	// Record success in memory
	actionMemoryStore.recordSuccess(workflow.domain, workflow.goalPattern);

	return result;
}

/**
 * Check if a pipeline can likely be executed on the current page
 * (basic validation before running)
 */
export async function validatePipeline(
	workflow: ActionMemory,
	sessionId: string,
	pageId?: string,
): Promise<{ valid: boolean; reason?: string }> {
	try {
		const page = await browserPool.getPage(sessionId, pageId || 'default');
		const currentUrl = page.url();
		const currentDomain = new URL(currentUrl).hostname;

		// Check if we're on the right domain
		if (!currentDomain.includes(workflow.domain) && !workflow.domain.includes(currentDomain)) {
			// First action should be navigate
			const firstAction = workflow.actions[0];
			if (firstAction.operation !== 'navigate') {
				return {
					valid: false,
					reason: `Current page (${currentDomain}) doesn't match workflow domain (${workflow.domain}) and first action is not navigate`,
				};
			}
		}

		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
