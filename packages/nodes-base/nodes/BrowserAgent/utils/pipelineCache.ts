import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Step types for cached pipelines
 */
export type CachedStepType = 'fixed' | 'dynamic';

/**
 * A single step in a cached pipeline
 */
export interface CachedStep {
	type: CachedStepType;
	operation: string;
	selector?: string;
	value?: string;
	url?: string;
	key?: string;
	scrollY?: number;
	ms?: number;
	script?: string;
	attribute?: string;
	filePath?: string;
	// For dynamic steps
	description?: string;
	// For parameterized values
	param?: string;
}

/**
 * A cached pipeline structure
 */
export interface CachedPipeline {
	domain: string;
	goalPattern: string;
	originalGoal: string;
	params: string[];
	steps: CachedStep[];
	createdAt: number;
	updatedAt: number;
	successCount: number;
}

/**
 * Domain cache file structure
 */
interface DomainCache {
	domain: string;
	pipelines: CachedPipeline[];
}

/**
 * Get the cache directory path
 */
function getCacheDir(): string {
	const n8nDir = process.env.N8N_USER_FOLDER || path.join(os.homedir(), '.n8n');
	return path.join(n8nDir, 'browser-agent-cache');
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
	const cacheDir = getCacheDir();
	if (!fs.existsSync(cacheDir)) {
		fs.mkdirSync(cacheDir, { recursive: true });
	}
}

/**
 * Get cache file path for a domain
 */
function getCacheFilePath(domain: string): string {
	const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
	return path.join(getCacheDir(), `${safeDomain}.json`);
}

/**
 * Load domain cache from file
 */
function loadDomainCache(domain: string): DomainCache {
	const filePath = getCacheFilePath(domain);

	if (!fs.existsSync(filePath)) {
		return { domain, pipelines: [] };
	}

	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(content) as DomainCache;
	} catch {
		return { domain, pipelines: [] };
	}
}

/**
 * Save domain cache to file
 */
function saveDomainCache(cache: DomainCache): void {
	ensureCacheDir();
	const filePath = getCacheFilePath(cache.domain);
	fs.writeFileSync(filePath, JSON.stringify(cache, null, 2));
}

/**
 * Extract domain from URL or goal
 */
export function extractDomain(urlOrGoal: string): string {
	// Try to extract URL from the text
	const urlMatch = urlOrGoal.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)/);
	if (urlMatch) {
		return urlMatch[1];
	}

	// Try common site names
	const siteNames = [
		'google',
		'linkedin',
		'indeed',
		'instagram',
		'facebook',
		'twitter',
		'github',
		'youtube',
		'amazon',
		'ebay',
	];
	const lowerText = urlOrGoal.toLowerCase();
	for (const site of siteNames) {
		if (lowerText.includes(site)) {
			return `${site}.com`;
		}
	}

	return 'unknown';
}

/**
 * Convert a goal to a pattern by replacing specific values with wildcards
 */
export function goalToPattern(goal: string): { pattern: string; params: string[] } {
	const params: string[] = [];
	let pattern = goal;

	// Extract quoted strings as parameters
	const quotedMatches = goal.match(/"([^"]+)"/g);
	if (quotedMatches) {
		quotedMatches.forEach((match, index) => {
			const paramName = `param${index + 1}`;
			params.push(paramName);
			pattern = pattern.replace(match, `{{${paramName}}}`);
		});
	}

	// Extract URLs as parameters
	const urlMatches = goal.match(/https?:\/\/[^\s]+/g);
	if (urlMatches) {
		urlMatches.forEach((match) => {
			if (!pattern.includes('{{')) {
				const paramName = 'url';
				params.push(paramName);
				pattern = pattern.replace(match, `{{${paramName}}}`);
			}
		});
	}

	return { pattern, params };
}

/**
 * Calculate similarity between two strings (simple Jaccard similarity)
 */
function calculateSimilarity(str1: string, str2: string): number {
	const words1 = new Set(str1.toLowerCase().split(/\s+/));
	const words2 = new Set(str2.toLowerCase().split(/\s+/));

	const intersection = new Set([...words1].filter((x) => words2.has(x)));
	const union = new Set([...words1, ...words2]);

	return intersection.size / union.size;
}

/**
 * Find a matching pipeline for a goal
 */
export function findMatchingPipeline(
	domain: string,
	goal: string,
	threshold: number = 0.7,
): CachedPipeline | null {
	const cache = loadDomainCache(domain);

	if (cache.pipelines.length === 0) {
		return null;
	}

	// Find best matching pipeline
	let bestMatch: CachedPipeline | null = null;
	let bestScore = 0;

	for (const pipeline of cache.pipelines) {
		// Check exact pattern match first
		const { pattern } = goalToPattern(goal);
		if (pattern === pipeline.goalPattern) {
			return pipeline;
		}

		// Calculate similarity
		const similarity = calculateSimilarity(goal, pipeline.originalGoal);
		if (similarity > bestScore && similarity >= threshold) {
			bestScore = similarity;
			bestMatch = pipeline;
		}
	}

	return bestMatch;
}

/**
 * Save a successful pipeline to cache
 */
export function savePipeline(domain: string, goal: string, steps: CachedStep[]): CachedPipeline {
	const cache = loadDomainCache(domain);
	const { pattern, params } = goalToPattern(goal);
	const now = Date.now();

	// Check if pipeline already exists
	const existingIndex = cache.pipelines.findIndex((p) => p.goalPattern === pattern);

	if (existingIndex >= 0) {
		// Update existing pipeline
		cache.pipelines[existingIndex].steps = steps;
		cache.pipelines[existingIndex].updatedAt = now;
		cache.pipelines[existingIndex].successCount++;
		saveDomainCache(cache);
		return cache.pipelines[existingIndex];
	}

	// Create new pipeline
	const newPipeline: CachedPipeline = {
		domain,
		goalPattern: pattern,
		originalGoal: goal,
		params,
		steps,
		createdAt: now,
		updatedAt: now,
		successCount: 1,
	};

	cache.pipelines.push(newPipeline);
	saveDomainCache(cache);

	return newPipeline;
}

/**
 * Update a single step in a cached pipeline
 */
export function updatePipelineStep(
	domain: string,
	goalPattern: string,
	stepIndex: number,
	newStep: CachedStep,
): boolean {
	const cache = loadDomainCache(domain);
	const pipelineIndex = cache.pipelines.findIndex((p) => p.goalPattern === goalPattern);

	if (pipelineIndex < 0) {
		return false;
	}

	if (stepIndex >= cache.pipelines[pipelineIndex].steps.length) {
		return false;
	}

	cache.pipelines[pipelineIndex].steps[stepIndex] = newStep;
	cache.pipelines[pipelineIndex].updatedAt = Date.now();
	saveDomainCache(cache);

	return true;
}

/**
 * Delete a pipeline from cache
 */
export function deletePipeline(domain: string, goalPattern: string): boolean {
	const cache = loadDomainCache(domain);
	const initialLength = cache.pipelines.length;

	cache.pipelines = cache.pipelines.filter((p) => p.goalPattern !== goalPattern);

	if (cache.pipelines.length < initialLength) {
		saveDomainCache(cache);
		return true;
	}

	return false;
}

/**
 * Clear all pipelines for a domain
 */
export function clearDomainCache(domain: string): void {
	const filePath = getCacheFilePath(domain);
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}
}

/**
 * Get all cached pipelines for a domain
 */
export function getDomainPipelines(domain: string): CachedPipeline[] {
	const cache = loadDomainCache(domain);
	return cache.pipelines;
}

/**
 * Extract parameter values from a goal using a pattern
 */
export function extractParams(
	goal: string,
	pattern: string,
	paramNames: string[],
): Record<string, string> {
	const params: Record<string, string> = {};

	// Build regex from pattern
	let regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	paramNames.forEach((paramName) => {
		regexPattern = regexPattern.replace(`\\{\\{${paramName}\\}\\}`, '(.+?)');
	});

	const match = goal.match(new RegExp(regexPattern, 'i'));
	if (match) {
		paramNames.forEach((paramName, index) => {
			params[paramName] = match[index + 1] || '';
		});
	}

	return params;
}

/**
 * Apply parameter values to a step
 */
export function applyParamsToStep(step: CachedStep, params: Record<string, string>): CachedStep {
	const appliedStep = { ...step };

	if (step.param && params[step.param]) {
		appliedStep.value = params[step.param];
	}

	// Replace {{param}} placeholders in value
	if (appliedStep.value) {
		for (const [key, value] of Object.entries(params)) {
			appliedStep.value = appliedStep.value.replace(`{{${key}}}`, value);
		}
	}

	// Replace {{param}} placeholders in URL
	if (appliedStep.url) {
		for (const [key, value] of Object.entries(params)) {
			appliedStep.url = appliedStep.url.replace(`{{${key}}}`, value);
		}
	}

	return appliedStep;
}
