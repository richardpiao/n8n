import type { Page } from 'playwright';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { INPUT_CHAT_MODEL } from '../BrowserAgent.node';

/**
 * Sanitize JSON string from AI responses
 * Fixes common escape character issues that cause JSON.parse to fail
 */
function sanitizeJsonString(jsonStr: string): string {
	// Replace invalid escape sequences that AI models often produce
	// Common issues: \' (invalid), unescaped control chars, Windows paths with single backslash
	return (
		jsonStr
			// Fix invalid \' escape (should be just ' or \u0027)
			.replace(/\\'/g, "'")
			// Fix unescaped backslashes that aren't part of valid escapes
			.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
			// Remove control characters except whitespace
			.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
	);
}

/**
 * Vision analysis result
 */
export interface VisionAnalysisResult {
	description: string;
	elements: Array<{
		type: string;
		description: string;
		suggestedSelector?: string;
		location?: string;
		text?: string;
	}>;
	forms: Array<{
		description: string;
		fields: Array<{
			type: string;
			label: string;
			suggestedSelector?: string;
		}>;
	}>;
	suggestedActions: Array<{
		action: string;
		target: string;
		reasoning: string;
	}>;
}

/**
 * Vision options (uses same Chat Model)
 */
export interface VisionOptions {
	enabled: boolean;
	screenshotType: 'fullPage' | 'viewport';
}

const VISION_SYSTEM_PROMPT = `You are a visual analyzer for browser automation. Given a screenshot of a web page, identify:

1. **Interactive Elements**: Buttons, links, inputs, dropdowns, checkboxes, etc.
2. **Forms**: Login forms, search bars, registration forms, etc.
3. **Navigation**: Menu items, tabs, breadcrumbs, etc.
4. **Key Actions**: What can be clicked, filled, or interacted with.

For each element, provide:
- Type (button, link, input, etc.)
- Visual description
- Suggested CSS selector if you can infer it (from text, position, or likely attributes)
- Location on page (top, center, bottom, left, right)

Respond ONLY with valid JSON in this format:
{
  "description": "Brief description of the page",
  "elements": [
    {
      "type": "button|link|input|select|checkbox|etc",
      "description": "What this element is for",
      "suggestedSelector": "CSS selector suggestion",
      "location": "top-left|top-center|top-right|center|bottom-left|etc",
      "text": "Visible text on the element"
    }
  ],
  "forms": [
    {
      "description": "What this form is for",
      "fields": [
        {
          "type": "text|email|password|select|checkbox|etc",
          "label": "Field label or placeholder",
          "suggestedSelector": "CSS selector suggestion"
        }
      ]
    }
  ],
  "suggestedActions": [
    {
      "action": "click|fill|select|etc",
      "target": "Description of target element",
      "reasoning": "Why this action might be useful"
    }
  ]
}`;

/**
 * Get the connected Chat Model (used for both text and vision)
 */
async function getChatModel(context: IExecuteFunctions): Promise<BaseChatModel | null> {
	try {
		const chatModel = (await context.getInputConnectionData(
			NodeConnectionTypes.AiLanguageModel,
			INPUT_CHAT_MODEL,
		)) as BaseChatModel;

		return chatModel || null;
	} catch {
		return null;
	}
}

/**
 * Take a screenshot of the page
 */
export async function takeScreenshot(page: Page, options: VisionOptions): Promise<string> {
	const buffer = await page.screenshot({
		type: 'png',
		fullPage: options.screenshotType === 'fullPage',
	});
	return buffer.toString('base64');
}

/**
 * Analyze a screenshot using the Chat Model (requires vision-capable model like GPT-4o)
 * This is the main function called from executionLoop
 */
export async function analyzeScreenshotWithChatModel(
	context: IExecuteFunctions,
	page: Page,
	options: VisionOptions,
	goal?: string,
): Promise<VisionAnalysisResult | null> {
	if (!options.enabled) {
		return null;
	}

	const chatModel = await getChatModel(context);
	if (!chatModel) {
		return null;
	}

	try {
		// Take screenshot
		const screenshot = await takeScreenshot(page, options);

		// Build the user message with the screenshot
		const userMessage = goal
			? `Analyze this webpage screenshot. The user's goal is: "${goal}"\n\nIdentify elements that could help achieve this goal.`
			: 'Analyze this webpage screenshot and identify all interactive elements.';

		// Create message with image
		const messages = [
			new SystemMessage(VISION_SYSTEM_PROMPT),
			new HumanMessage({
				content: [
					{
						type: 'text',
						text: userMessage,
					},
					{
						type: 'image_url',
						image_url: {
							url: `data:image/png;base64,${screenshot}`,
						},
					},
				],
			}),
		];

		const response = await chatModel.invoke(messages);

		// Parse the response
		let content =
			typeof response.content === 'string'
				? response.content
				: Array.isArray(response.content)
					? response.content
							.map((block) => {
								if (typeof block === 'string') return block;
								if ('text' in block) return block.text;
								return '';
							})
							.join('')
					: String(response.content);

		// Extract JSON from response
		const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			content = jsonMatch[1].trim();
		}

		// Sanitize JSON - fix common escape character issues from AI responses
		const sanitizedContent = sanitizeJsonString(content);
		const result = JSON.parse(sanitizedContent) as VisionAnalysisResult;

		return result;
	} catch (error) {
		// Vision analysis failed - this is expected if model doesn't support vision
		// Just return null and fall back to text-only mode
		console.warn('Vision analysis failed (model may not support vision):', error);
		return null;
	}
}

/**
 * Convert vision analysis to page context format (compatible with scraper output)
 */
export function visionToPageContext(analysis: VisionAnalysisResult): {
	elements: Array<{
		type: string;
		selector: string;
		text?: string;
		placeholder?: string;
	}>;
	forms: Array<{
		fields: Array<{
			type: string;
			name: string;
			placeholder?: string;
		}>;
	}>;
} {
	return {
		elements: analysis.elements.map((el, index) => ({
			type: el.type,
			selector: el.suggestedSelector || `[vision-element-${index}]`,
			text: el.text || el.description,
			placeholder: undefined,
		})),
		forms: analysis.forms.map((form) => ({
			fields: form.fields.map((field) => ({
				type: field.type,
				name: field.label,
				placeholder: field.label,
			})),
		})),
	};
}
