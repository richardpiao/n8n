import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { browserPool } from '../../utils/browserPool';
import { applyHumanDelay } from '../../utils/humanDelay';
import { selectorField } from '../common/fields';

export const description: INodeProperties[] = [
	{
		...selectorField,
		required: true,
		description: 'CSS selector for the file input element',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['uploadFile'],
			},
		},
	},
	{
		displayName: 'File Source',
		name: 'fileSource',
		type: 'options',
		default: 'path',
		options: [
			{
				name: 'File Path',
				value: 'path',
				description: 'Upload from local file path',
			},
			{
				name: 'Binary Data',
				value: 'binary',
				description: 'Upload from binary input',
			},
		],
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['uploadFile'],
			},
		},
	},
	{
		displayName: 'File Path',
		name: 'filePath',
		type: 'string',
		default: '',
		required: true,
		placeholder: '/path/to/file.pdf',
		description: 'Path to the file to upload',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['uploadFile'],
				fileSource: ['path'],
			},
		},
	},
	{
		displayName: 'Binary Property',
		name: 'binaryProperty',
		type: 'string',
		default: 'data',
		required: true,
		description: 'Name of the binary property containing the file',
		displayOptions: {
			show: {
				resource: ['interaction'],
				operation: ['uploadFile'],
				fileSource: ['binary'],
			},
		},
	},
];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const sessionId = this.getNodeParameter('sessionId', index) as string;
	const pageId = this.getNodeParameter('pageId', index, 'default') as string;
	const selector = this.getNodeParameter('selector', index) as string;
	const fileSource = this.getNodeParameter('fileSource', index) as string;
	const additionalOptions = this.getNodeParameter('additionalOptions', index, {}) as {
		humanDelay?: { enabled?: boolean; min?: number; max?: number };
		timeout?: number;
	};

	const page = await browserPool.getPage(sessionId, pageId);

	// Apply human-like delay
	if (additionalOptions.humanDelay?.enabled !== false) {
		await applyHumanDelay(additionalOptions.humanDelay);
	}

	let filePath: string;

	if (fileSource === 'binary') {
		const binaryProperty = this.getNodeParameter('binaryProperty', index) as string;
		const binaryData = this.helpers.assertBinaryData(index, binaryProperty);

		// Write binary data to temp file
		const fs = await import('fs/promises');
		const path = await import('path');
		const os = await import('os');

		const tempDir = os.tmpdir();
		const fileName = binaryData.fileName || 'upload';
		filePath = path.join(tempDir, `n8n-playwright-${Date.now()}-${fileName}`);

		const buffer = await this.helpers.getBinaryDataBuffer(index, binaryProperty);
		await fs.writeFile(filePath, buffer);
	} else {
		filePath = this.getNodeParameter('filePath', index) as string;
	}

	await page.setInputFiles(selector, filePath, {
		timeout: additionalOptions.timeout || 30000,
	});

	// Clean up temp file if we created one
	if (fileSource === 'binary') {
		const fs = await import('fs/promises');
		try {
			await fs.unlink(filePath);
		} catch {
			// Ignore cleanup errors
		}
	}

	return [
		{
			json: {
				sessionId,
				pageId,
				selector,
				fileSource,
				message: 'File uploaded successfully',
			},
		},
	];
}
