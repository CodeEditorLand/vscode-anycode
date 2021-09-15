/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from 'vscode-languageserver';
import { asLspRange, compareRangeByStart, containsPosition, containsRange, symbolMapping } from '../common';
import { Trees } from '../trees';
import { QueryCapture } from '../../tree-sitter/tree-sitter';
import { Queries } from '../queries';
import { TextDocument } from 'vscode-languageserver-textdocument';


export class Locals {

	static create(document: TextDocument, trees: Trees): Locals {
		const root = new Scope(lsp.Range.create(0, 0, document.lineCount, 0));
		const tree = trees.getParseTree(document);
		if (!tree) {
			return new Locals(document, root);
		}

		const all: Node[] = [];
		const query = Queries.get(document.languageId, 'locals');
		const captures = query.captures(tree.rootNode).sort(this._compareCaptures);

		// Find all scopes and merge some. The challange is that function-bodies "see" their
		// arguments but function-block-nodes and argument-list-nodes are usually siblings
		const scopeCaptures = captures.filter(capture => capture.name.startsWith('scope'));
		for (let i = 0; i < scopeCaptures.length; i++) {
			const capture = scopeCaptures[i];
			const range = asLspRange(capture.node);
			if (capture.name.endsWith('.merge')) {
				all[all.length - 1].range.end = range.end;
			} else {
				all.push(new Scope(range));
			}
		}

		// Find all definitions and usages and mix them with scopes
		this._fillInDefinitionsAndUsages(all, captures);

		//
		this._constructTree(root, all);

		const info = new Locals(document, root);
		// info.debugPrint();
		return info;
	}

	private static _fillInDefinitionsAndUsages(bucket: Node[], captures: QueryCapture[]): void {
		for (const capture of captures) {
			if (capture.name.startsWith('definition')) {
				bucket.push(new Definition(
					capture.node.text,
					asLspRange(capture.node)

				));
			} else if (capture.name.startsWith('usage')) {
				bucket.push(new Usage(
					capture.node.text,
					asLspRange(capture.node),
					capture.name.endsWith('.void')
				));
			}
		}
	}

	private static _constructTree(root: Scope, nodes: Node[]): void {
		const stack: Node[] = [];
		for (const thing of nodes.sort(this._compareByRange)) {
			while (true) {
				let parent = stack.pop() ?? root;
				if (containsRange(parent.range, thing.range)) {
					parent.appendChild(thing);
					stack.push(parent);
					stack.push(thing);
					break;
				}
				if (parent === root) {
					// impossible ?!
					break;
				}
			}
		}

		// remove helper usage-nodes
		stack.length = 0;
		stack.push(root);
		while (stack.length > 0) {
			let n = stack.pop()!;
			if (n instanceof Usage && n.isHelper) {
				n.remove();
			} else {
				stack.push(...n.children());
			}
		}
	}


	private static _compareCaptures(a: QueryCapture, b: QueryCapture) {
		return a.node.startIndex - b.node.startIndex;
	}

	private static _compareByRange<T extends { range: lsp.Range }>(a: T, b: T) {
		return compareRangeByStart(a.range, b.range);
	}

	private constructor(
		readonly document: TextDocument,
		readonly root: Scope
	) { }

	debugPrint() {
		console.log(this.root.toString());
	}


}

const enum NodeType {
	'Scope', 'Definition', 'Usage'
}

abstract class Node {

	protected _parent: Node | undefined;
	protected _children: Node[] = [];

	constructor(
		readonly range: lsp.Range,
		readonly type: NodeType
	) { }

	children(): readonly Node[] {
		return this._children;
	}

	remove(): boolean {
		if (!this._parent) {
			return false;
		}
		const idx = this._parent._children.indexOf(this);
		if (idx < 0) {
			return false;
		}
		this._parent._children.splice(idx, 1);
		return true;
	}

	appendChild(node: Node) {
		this._children.push(node);
		node._parent = this;
	}

	toString() {
		return `${this.type}@${this.range.start.line},${this.range.start.character}-${this.range.end.line},${this.range.end.character}`;
	}

}

export class Usage extends Node {
	constructor(
		readonly name: string,
		readonly range: lsp.Range,
		readonly isHelper: boolean,
	) {
		super(range, NodeType.Usage);
	}

	appendChild(_node: Node) {
		// console.log('ignored', node.toString());
	}

	toString() {
		return `use:${this.name}`;
	}
}

export class Definition extends Node {
	constructor(
		readonly name: string,
		readonly range: lsp.Range,
	) {
		super(range, NodeType.Definition);
	}

	appendChild(_node: Node) {
		// console.log('ignored', node.toString());
	}

	toString() {
		return `def:${this.name}`;
	}
}

export class Scope extends Node {

	constructor(range: lsp.Range) {
		super(range, NodeType.Scope);
	}

	*definitions() {
		for (let item of this._children) {
			if (item instanceof Definition) {
				yield item;
			}
		}
	}
	*usages() {
		for (let item of this._children) {
			if (item instanceof Usage) {
				yield item;
			}
		}
	}
	*scopes() {
		for (let item of this._children) {
			if (item instanceof Scope) {
				yield item;
			}
		}
	}

	findScope(position: lsp.Position): Scope {
		for (let scope of this.scopes()) {
			if (containsPosition(scope.range, position)) {
				return scope.findScope(position);
			}
		}
		return this;
	}

	findDefinitionOrUsage(position: lsp.Position): Definition | Usage | undefined {
		for (let child of this._children) {
			if ((child instanceof Definition || child instanceof Usage) && containsPosition(child.range, position)) {
				return child;
			}
		}
	}


	findDefinitions(text: string): Definition[] {
		const result: Definition[] = [];
		for (let child of this.definitions()) {
			if (child.name === text) {
				result.push(child);
			}
		}
		if (result.length > 0) {
			return result;
		}
		if (!(this._parent instanceof Scope)) {
			return [];
		}
		return this._parent.findDefinitions(text);
	}

	findUsages(text: string): Usage[] {
		const bucket: Usage[][] = [];

		// find higest scope defining
		let scope: Scope = this;
		while (!scope._defines(text)) {
			if (scope._parent instanceof Scope) {
				scope = scope._parent;
			} else {
				break;
			}
		}
		// find usages in all child scope (unless also defined there)
		scope._findUsagesDown(text, bucket);
		return bucket.flat();
	}

	private _findUsagesDown(text: string, bucket: Usage[][]): void {

		// usages in this scope
		const result: Usage[] = [];
		for (let child of this.usages()) {
			if (child.name === text) {
				result.push(child);
			}
		}
		bucket.push(result);

		// usages in child scope (unless also defined there)
		for (let child of this.scopes()) {
			if (!child._defines(text)) {
				child._findUsagesDown(text, bucket);
			}
		}
	}

	private _defines(text: string): boolean {
		for (let child of this.definitions()) {
			if (child.name === text) {
				return true;
			}
		}
		return false;
	}

	toString(depth: number = 0): string {


		let scopes: string[] = [];
		let parts: string[] = [];

		this._children.slice(0).forEach(child => {
			if (child instanceof Scope) {
				scopes.push(child.toString(depth + 2));
			} else {
				parts.push(child.toString());
			}
		});

		let indent = ' '.repeat(depth);
		let res = `${indent}Scope@${this.range.start.line},${this.range.start.character}-${this.range.end.line},${this.range.end.character}`;
		res += `\n${indent + indent}${parts.join(`, `)}`;
		res += `\n${indent}${scopes.join(`\n${indent}`)}`;

		return res;

	}
}
