/*
 * DBZS – Division By Zeros
 * Datei: typescript_chunker.mjs
 * Bereich: Backend / Repository-RAG
 *
 * Zweck: Symbolbasierte TypeScript-/JavaScript-Chunks über den echten TypeScript-AST.
 * Input: JSON auf stdin mit absoluten Dateipfaden und Workspace-Root.
 * Output: JSON mit Symbol, Art, Zeilenbereich und Inhalt pro Datei.
 * Hinweise: Keine Dateien werden verändert; Fehler einzelner Dateien werden isoliert gemeldet.
 */
import fs from "node:fs";
import ts from "typescript";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const output = {};

function kindFor(node) {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isFunctionDeclaration(node)) return "function";
  return "constant";
}

for (const filePath of input.files) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const chunks = [];
    const visit = (node) => {
      let name = null;
      if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
        name = node.name.getText(source);
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        name = node.name.text;
      }
      if (name) {
        const startPos = node.getStart(source);
        const endPos = node.getEnd();
        chunks.push({
          symbol: name,
          kind: kindFor(node),
          start: source.getLineAndCharacterOfPosition(startPos).line + 1,
          end: source.getLineAndCharacterOfPosition(endPos).line + 1,
          content: content.slice(startPos, endPos)
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    output[filePath] = chunks;
  } catch (error) {
    output[filePath] = { error: error instanceof Error ? error.message : String(error) };
  }
}

process.stdout.write(JSON.stringify(output));
