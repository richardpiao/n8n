import type { BrowserContext } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SessionState {
	cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		httpOnly: boolean;
		secure: boolean;
		sameSite: 'Strict' | 'Lax' | 'None';
	}>;
	origins: Array<{
		origin: string;
		localStorage: Array<{
			name: string;
			value: string;
		}>;
	}>;
}

/**
 * Save browser session state to a file
 */
export async function saveSession(context: BrowserContext, sessionPath: string): Promise<void> {
	// Ensure directory exists
	const dir = path.dirname(sessionPath);
	await fs.mkdir(dir, { recursive: true });

	// Get storage state from context
	const storageState = await context.storageState();

	// Write to file
	await fs.writeFile(sessionPath, JSON.stringify(storageState, null, 2), 'utf-8');
}

/**
 * Load browser session state from a file
 */
export async function loadSession(sessionPath: string): Promise<SessionState | null> {
	try {
		const content = await fs.readFile(sessionPath, 'utf-8');
		return JSON.parse(content) as SessionState;
	} catch {
		// File doesn't exist or is invalid
		return null;
	}
}

/**
 * Check if a session file exists
 */
export async function sessionExists(sessionPath: string): Promise<boolean> {
	try {
		await fs.access(sessionPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Delete a session file
 */
export async function deleteSession(sessionPath: string): Promise<void> {
	try {
		await fs.unlink(sessionPath);
	} catch {
		// File doesn't exist, that's fine
	}
}

/**
 * Get the default session directory
 */
export function getDefaultSessionDir(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
	return path.join(homeDir, '.n8n', 'playwright-sessions');
}

/**
 * Generate a session path for a given platform
 */
export function getSessionPath(platform: string, sessionName?: string): string {
	const dir = getDefaultSessionDir();
	const name = sessionName || platform;
	return path.join(dir, `${name}.json`);
}
