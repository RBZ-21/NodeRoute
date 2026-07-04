#!/usr/bin/env node
'use strict';

// Generates TypeScript type declarations from backend Zod schemas so the
// frontend can consume request/response shapes without hand-transcribing
// them. Run via `npm run codegen:types` from the repo root. Do not hand-edit
// the generated output files — re-run this script instead.
//
// NOTE on zod-to-ts API: this repo pins zod@^4.4.1. Only zod-to-ts@^2.0.0
// declares (and actually implements) Zod v4 support; earlier 0.x/1.x
// versions target Zod v3's internal schema representation and will not work
// here. The v2 API also differs from older zod-to-ts versions: `zodToTs`
// takes an options object (not a bare identifier string) and requires an
// explicit `auxiliaryTypeStore`; naming the resulting type alias is a
// separate `createTypeAlias` call. See https://github.com/sachinraja/zod-to-ts

const fs = require('fs');
const path = require('path');
const { zodToTs, createTypeAlias, printNode, createAuxiliaryTypeStore } = require('zod-to-ts');
const schemas = require('../lib/schemas');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'frontend-v2', 'src', 'types', 'generated');

function generateTypeAliasSource(schema, exportedTypeName) {
  const auxiliaryTypeStore = createAuxiliaryTypeStore();
  const { node } = zodToTs(schema, { auxiliaryTypeStore, unrepresentable: 'any' });
  const typeAlias = createTypeAlias(node, exportedTypeName);
  return printNode(typeAlias);
}

function writeGeneratedFile(outputFileName, entries) {
  const header =
    '// GENERATED FILE — do not edit by hand.\n' +
    `// Source: backend/lib/schemas.js (${entries.map((e) => e.schemaName).join(', ')})\n` +
    '// Regenerate with: npm run codegen:types\n\n';

  const body = entries
    .map(({ schemaName, exportedTypeName }) => {
      const schema = schemas[schemaName];
      if (!schema) throw new Error(`Schema "${schemaName}" not found in backend/lib/schemas.js`);
      return `export ${generateTypeAliasSource(schema, exportedTypeName)}\n`;
    })
    .join('\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, outputFileName), header + body);
  console.log(`Wrote ${path.join('frontend-v2/src/types/generated', outputFileName)}`);
}

writeGeneratedFile('order.generated.ts', [
  { schemaName: 'orderCreateSchema', exportedTypeName: 'GeneratedOrderCreateInput' },
  { schemaName: 'orderUpdateSchema', exportedTypeName: 'GeneratedOrderUpdateInput' },
]);

console.log('Type generation complete.');
