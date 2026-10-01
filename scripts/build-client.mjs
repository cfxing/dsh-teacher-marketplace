import ts from 'typescript'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [panelSource, clientSource, css] = await Promise.all([
  readFile(resolve(root, 'src/main-panel-compat.ts'), 'utf8'),
  readFile(resolve(root, 'src/client.tsx'), 'utf8'),
  readFile(resolve(root, 'src/client.css'), 'utf8'),
])

const source = `
import React, { useEffect, useMemo, useState } from 'react'
const clientCss = ${JSON.stringify(css)}
${withoutImports(panelSource)}
${withoutImports(clientSource)}
`

const result = ts.transpileModule(source, {
  fileName: 'client.tsx',
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
})

const errors = (result.diagnostics ?? [])
  .filter(item => item.category === ts.DiagnosticCategory.Error)

if (errors.length) {
  throw new Error(
    ts.formatDiagnostics(errors, {
      getCanonicalFileName: value => value,
      getCurrentDirectory: () => root,
      getNewLine: () => '\\n',
    }),
  )
}

const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-teacher-marketplace",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${indent(result.outputText, 4)}
    return module.exports;
  },
});
`

await mkdir(resolve(root, 'lib'), { recursive: true })
await writeFile(resolve(root, 'lib/client.js'), wrapped, 'utf8')

function withoutImports(value) {
  return value.replace(/^import[^\\n]*\\n/gm, '')
}

function indent(value, size) {
  const prefix = ' '.repeat(size)
  return value.split('\\n').map(line => prefix + line).join('\\n')
}
