import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(name);
    else if (/\.(ts|tsx)$/.test(name)) files.push(name);
  }
}
walk(root);
const errors = [];
const graph = new Map();
function resolveImport(from, specifier) {
  const base = specifier.startsWith('@/')
    ? path.resolve('src/renderer', specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  return (
    [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ].find((candidate) => files.includes(candidate)) ?? null
  );
}
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = source.statements.filter(ts.isImportDeclaration);
  if (relative.startsWith('renderer/') && relative !== 'renderer/shared/ui/Textarea.tsx') {
    const checkTextarea = (node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === 'textarea'
      )
        errors.push(`${relative}: use the shared Textarea component`);
      ts.forEachChild(node, checkTextarea);
    };
    checkTextarea(source);
  }
  const dependencies = [];
  for (const declaration of imports) {
    const name = declaration.moduleSpecifier.text;
    const target = resolveImport(file, name);
    if (target && !declaration.importClause?.isTypeOnly) dependencies.push(target);
    const targetRelative = target ? path.relative(root, target).replaceAll('\\', '/') : '';
    if (
      relative.startsWith('renderer/') &&
      (name === 'electron' || name.startsWith('node:') || /^(main|preload)\//.test(targetRelative))
    )
      errors.push(`${relative}: privileged import ${name}`);
    if (relative.startsWith('main/') && targetRelative.startsWith('renderer/'))
      errors.push(`${relative}: main depends on renderer`);
    if (relative.startsWith('shared/') && targetRelative && !targetRelative.startsWith('shared/'))
      errors.push(`${relative}: cross-process contracts depend on ${targetRelative}`);
    if (
      relative.startsWith('renderer/shared/') &&
      /^renderer\/(features|app|fixtures)\//.test(targetRelative)
    )
      errors.push(`${relative}: shared code depends on ${targetRelative}`);
    if (
      relative.startsWith('renderer/entities/') &&
      /^renderer\/(features|app|fixtures)\//.test(targetRelative)
    )
      errors.push(`${relative}: entity depends on ${targetRelative}`);
  }
  graph.set(file, dependencies);
}
const visiting = new Set(),
  visited = new Set();
function visit(file, trail = []) {
  if (visiting.has(file)) {
    errors.push(`Import cycle: ${[...trail, file].map((f) => path.relative(root, f)).join(' → ')}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture checked: ${files.length} modules; no runtime import cycles or process/layer boundary violations.`,
  );
