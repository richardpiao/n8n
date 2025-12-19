import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import * as browserOperations from './browser';
import * as pageOperations from './page';
import * as interactionOperations from './interaction';
import * as extractionOperations from './extraction';
import * as waitOperations from './wait';
import * as sessionOperations from './session';

import type { PlaywrightResource } from './types';

type OperationModule = {
	execute: (this: IExecuteFunctions, index: number) => Promise<INodeExecutionData[]>;
};

const operationMap: Record<PlaywrightResource, Record<string, OperationModule>> = {
	browser: browserOperations as unknown as Record<string, OperationModule>,
	page: pageOperations as unknown as Record<string, OperationModule>,
	interaction: interactionOperations as unknown as Record<string, OperationModule>,
	extraction: extractionOperations as unknown as Record<string, OperationModule>,
	wait: waitOperations as unknown as Record<string, OperationModule>,
	session: sessionOperations as unknown as Record<string, OperationModule>,
};

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const operationResult: INodeExecutionData[] = [];

	const items = this.getInputData();
	const resource = this.getNodeParameter('resource', 0) as PlaywrightResource;
	const operation = this.getNodeParameter('operation', 0) as string;

	for (let i = 0; i < items.length; i++) {
		try {
			const resourceOperations = operationMap[resource];
			const operationHandler = resourceOperations[operation];

			if (!operationHandler) {
				throw new NodeOperationError(
					this.getNode(),
					`The operation "${operation}" is not supported for resource "${resource}"!`,
				);
			}

			const responseData = await operationHandler.execute.call(this, i);

			const executionData = this.helpers.constructExecutionMetaData(responseData, {
				itemData: { item: i },
			});

			operationResult.push(...executionData);
		} catch (error) {
			if (this.continueOnFail()) {
				operationResult.push({
					json: this.getInputData(i)[0].json,
					error: error as NodeOperationError,
				});
			} else {
				throw error;
			}
		}
	}

	return [operationResult];
}
