/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const symbols = `
(struct_specifier
	name: (type_identifier) @struct.name
) @struct

(union_specifier
	name: (type_identifier) @struct.name
) @struct

(enum_specifier
	name: (type_identifier) @enum.name
) @enum

(enumerator
	name: (identifier) @enumMember.name
) @enumMember

(function_definition
	declarator: (function_declarator
		declarator: (identifier) @function.name
	)
) @function

(pointer_declarator
	declarator: (function_declarator
		declarator: (identifier) @function.name
	) @function
)

(type_definition
	type: (_)
	declarator: (type_identifier) @struct.name
) @struct

(linkage_specification
	value: (string_literal) @struct.name
) @struct

(field_declaration_list
	(field_declaration
		[
			declarator: (field_identifier) @field.name
			(array_declarator
				declarator: (field_identifier) @field.name
			)
		]
	) @field
)`;