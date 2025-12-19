import type { Page } from 'playwright';

export interface HumanDelayConfig {
	enabled: boolean;
	min: number;
	max: number;
	typeSpeed?: number; // Characters per second
	variation?: number; // Random variation factor (0-1)
}

const DEFAULT_CONFIG: HumanDelayConfig = {
	enabled: true,
	min: 500,
	max: 2000,
	typeSpeed: 10,
	variation: 0.3,
};

/**
 * Wait for a random delay between min and max milliseconds
 */
export async function humanDelay(min: number, max: number): Promise<void> {
	const delay = min + Math.random() * (max - min);
	return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Apply human-like delay if enabled
 */
export async function applyHumanDelay(config: Partial<HumanDelayConfig> = {}): Promise<void> {
	const { enabled, min, max } = { ...DEFAULT_CONFIG, ...config };

	if (enabled) {
		await humanDelay(min, max);
	}
}

/**
 * Type text with human-like delays between keystrokes
 */
export async function humanType(
	page: Page,
	selector: string,
	text: string,
	config: Partial<HumanDelayConfig> = {},
): Promise<void> {
	const { enabled, typeSpeed = 10, variation = 0.3 } = { ...DEFAULT_CONFIG, ...config };

	if (!enabled) {
		await page.fill(selector, text);
		return;
	}

	// Focus the element first
	await page.focus(selector);

	// Clear any existing content
	await page.fill(selector, '');

	// Type character by character with random delays
	for (const char of text) {
		await page.type(selector, char, { delay: 0 });

		// Calculate delay for this character
		const baseDelay = 1000 / typeSpeed;
		const randomFactor = 1 + (Math.random() - 0.5) * 2 * variation;
		const charDelay = baseDelay * randomFactor;

		await humanDelay(charDelay * 0.5, charDelay * 1.5);
	}
}

/**
 * Click with human-like delay before the click
 */
export async function humanClick(
	page: Page,
	selector: string,
	config: Partial<HumanDelayConfig> = {},
): Promise<void> {
	await applyHumanDelay(config);
	await page.click(selector);
}

/**
 * Move mouse in a somewhat natural path (simplified)
 */
export async function humanMouseMove(
	page: Page,
	x: number,
	y: number,
	config: Partial<HumanDelayConfig> = {},
): Promise<void> {
	const { enabled } = { ...DEFAULT_CONFIG, ...config };

	if (!enabled) {
		await page.mouse.move(x, y);
		return;
	}

	// Get current position (start from 0,0 if unknown)
	const startX = 0;
	const startY = 0;

	// Calculate intermediate points for a more natural movement
	const steps = 5 + Math.floor(Math.random() * 5);
	const deltaX = x - startX;
	const deltaY = y - startY;

	for (let i = 1; i <= steps; i++) {
		const progress = i / steps;
		// Add some randomness to the path
		const wobbleX = (Math.random() - 0.5) * 10;
		const wobbleY = (Math.random() - 0.5) * 10;

		const currentX = startX + deltaX * progress + wobbleX;
		const currentY = startY + deltaY * progress + wobbleY;

		await page.mouse.move(currentX, currentY);
		await humanDelay(10, 30);
	}

	// Final precise move to target
	await page.mouse.move(x, y);
}

/**
 * Scroll with human-like behavior
 */
export async function humanScroll(
	page: Page,
	deltaY: number,
	config: Partial<HumanDelayConfig> = {},
): Promise<void> {
	const { enabled, min, max } = { ...DEFAULT_CONFIG, ...config };

	if (!enabled) {
		await page.mouse.wheel(0, deltaY);
		return;
	}

	// Break scroll into smaller chunks
	const chunks = 3 + Math.floor(Math.random() * 3);
	const chunkSize = deltaY / chunks;

	for (let i = 0; i < chunks; i++) {
		// Add some variation to each chunk
		const variation = chunkSize * (0.8 + Math.random() * 0.4);
		await page.mouse.wheel(0, variation);
		await humanDelay(min / 4, max / 4);
	}
}
