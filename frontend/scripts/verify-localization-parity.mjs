import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const appRoot = path.resolve("frontend/app");
const failures = [];
let dictionariesChecked = 0;
let translationsChecked = 0;
const sharedLatinTerms = new Set(["BRICK CHAMBER ERP", "GSTIN", "HSN / SAC", "PAN", "UPI"]);

function unwrap(node) {
  return ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;
}

function propertyName(node, sourceFile) {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
    return node.name.text;
  }
  return node.name.getText(sourceFile);
}

function objectProperty(node, name, sourceFile) {
  return node.properties.find((property) => propertyName(property, sourceFile) === name);
}

function flattenStrings(node, prefix, sourceFile, result) {
  node = unwrap(node);
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property, sourceFile);
      if (name === null) continue;
      flattenStrings(property.initializer, prefix ? `${prefix}.${name}` : name, sourceFile, result);
    }
    return;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) result.set(prefix, node.text);
}

function relative(file) {
  return path.relative(process.cwd(), file).replaceAll(path.sep, "/");
}

function scanDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(file);
      continue;
    }
    if (!file.endsWith(".tsx")) continue;

    const source = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    if (sourceFile.parseDiagnostics.length) {
      failures.push(`${relative(file)}: TypeScript could not parse the file.`);
      continue;
    }

    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const value = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(value)) {
          const english = objectProperty(value, "en", sourceFile);
          const tamil = objectProperty(value, "ta", sourceFile);
          if (english && tamil && ts.isObjectLiteralExpression(unwrap(english.initializer))
            && ts.isObjectLiteralExpression(unwrap(tamil.initializer))) {
            dictionariesChecked += 1;
            const englishStrings = new Map();
            const tamilStrings = new Map();
            flattenStrings(english.initializer, "", sourceFile, englishStrings);
            flattenStrings(tamil.initializer, "", sourceFile, tamilStrings);
            translationsChecked += englishStrings.size;

            for (const key of englishStrings.keys()) {
              if (!tamilStrings.has(key)) failures.push(`${relative(file)}:${node.name.getText(sourceFile)} missing Tamil key "${key}".`);
            }
            for (const key of tamilStrings.keys()) {
              if (!englishStrings.has(key)) failures.push(`${relative(file)}:${node.name.getText(sourceFile)} has extra Tamil key "${key}".`);
            }
            for (const [key, englishValue] of englishStrings) {
              if (tamilStrings.get(key) === englishValue && /[A-Za-z]{3}/.test(englishValue) && !sharedLatinTerms.has(englishValue)) {
                failures.push(`${relative(file)}:${node.name.getText(sourceFile)} Tamil value for "${key}" duplicates English text "${englishValue}".`);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
}

scanDirectory(appRoot);
if (failures.length) {
  console.error(`Localization key parity failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Verified English/Tamil parity for ${translationsChecked} strings across ${dictionariesChecked} dictionaries; identical Latin strings are limited to the company brand and shared terms (${[...sharedLatinTerms].join(", ")}).`);
}
