/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver';
import { Trees } from '../trees';
import { DocumentStore } from '../documentStore';
import { Locals } from './fileInfo';

export class DocumentHighlightsProvider {

	constructor(
		private readonly _documents: DocumentStore,
		private readonly _trees: Trees,
	) { }

	register(connection: lsp.Connection) {
		connection.onDocumentHighlight(this.provideDocumentHighlights.bind(this));
	}

	async provideDocumentHighlights(params: lsp.DocumentHighlightParams): Promise<lsp.DocumentHighlight[]> {
		const document = await this._documents.retrieve(params.textDocument.uri);

		const info = Locals.create(document, this._trees);
		const scope = info.root.findScope(params.position);
		const anchor = scope.findDefinitionOrUsage(params.position);
		if (!anchor) {
			return [];
		}
		const result: lsp.DocumentHighlight[] = [];
		for (let def of scope.findDefinitions(anchor.name)) {
			result.push(lsp.DocumentHighlight.create(def.range, lsp.DocumentHighlightKind.Write));
		}
		if (result.length === 0) {
			// needs a definition
			return [];
		}
		for (let usage of scope.findUsages(anchor.name)) {
			result.push(lsp.DocumentHighlight.create(usage.range, lsp.DocumentHighlightKind.Read));
		}
		return result;
	}
}
