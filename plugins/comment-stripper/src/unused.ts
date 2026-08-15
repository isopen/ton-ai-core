import * as ts from 'typescript';
import { UnusedTextResult } from './types';

interface Candidate {
    name: string;
    decl: ts.VariableDeclaration;
    stmt: ts.VariableStatement;
    list: ts.VariableDeclarationList;
}

function lineStart(text: string, pos: number): number {
    return text.lastIndexOf('\n', pos - 1) + 1;
}

function isBindingIdentifier(id: ts.Identifier): boolean {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
    if (ts.isPropertyAssignment(p) && p.name === id) return true;
    if (ts.isPropertySignature(p) && p.name === id) return true;
    if (ts.isPropertyDeclaration(p) && p.name === id) return true;
    if (ts.isMethodDeclaration(p) && p.name === id) return true;
    if (ts.isMethodSignature(p) && p.name === id) return true;
    if (ts.isGetAccessorDeclaration(p) && p.name === id) return true;
    if (ts.isSetAccessorDeclaration(p) && p.name === id) return true;
    if (ts.isEnumMember(p) && p.name === id) return true;
    if (ts.isQualifiedName(p) && p.right === id) return true;
    if (ts.isLabeledStatement(p) && p.label === id) return true;
    if (ts.isBreakOrContinueStatement(p) && p.label === id) return true;
    if (ts.isImportSpecifier(p) && p.name === id) return true;
    if (ts.isNamespaceImport(p)) return true;
    if (ts.isImportClause(p)) return true;
    if (ts.isImportEqualsDeclaration(p) && p.name === id) return true;
    if (ts.isParameter(p) && p.name === id) return true;
    if (ts.isTypeParameterDeclaration(p) && p.name === id) return true;
    if (ts.isBindingElement(p) && p.name === id) return true;
    if (ts.isFunctionDeclaration(p) && p.name === id) return true;
    if (ts.isClassDeclaration(p) && p.name === id) return true;
    if (ts.isEnumDeclaration(p) && p.name === id) return true;
    if (ts.isModuleDeclaration(p) && p.name === id) return true;
    if (ts.isTypeAliasDeclaration(p) && p.name === id) return true;
    if (ts.isInterfaceDeclaration(p) && p.name === id) return true;
    return false;
}

export function collapseBlanks(text: string): string {
    const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    const cleaned: string[] = [];
    let pendingBlank = false;
    for (const l of lines) {
        if (l.trim() === '') {
            pendingBlank = true;
            continue;
        }
        if (pendingBlank && cleaned.length > 0) cleaned.push('');
        cleaned.push(l);
        pendingBlank = false;
    }
    const final: string[] = [];
    const endsOpen = (s: string) => /[{(\[:]\s*$/.test(s);
    const startsClose = (s: string) => /^\s*[})]/.test(s);
    for (let i = 0; i < cleaned.length; i++) {
        const l = cleaned[i];
        const prev = final.length ? final[final.length - 1] : '';
        const next = cleaned[i + 1] ?? '';
        if (l.trim() === '' && (endsOpen(prev) || startsClose(next))) continue;
        final.push(l);
    }
    return final.join('\n') + '\n';
}

function hasSideEffects(expr: ts.Expression): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
            found = true;
            return;
        }
        if (ts.isBinaryExpression(n)) {
            const op = n.operatorToken.kind;
            if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) {
                found = true;
                return;
            }
        }
        if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
            found = true;
            return;
        }
        ts.forEachChild(n, visit);
    };
    visit(expr);
    return found;
}

function findComma(text: string, from: number, to: number): number {
    const slice = text.slice(from, to);
    const idx = slice.indexOf(',');
    return idx < 0 ? -1 : from + idx;
}

function wholeLineRange(text: string, stmt: ts.Node): { from: number; to: number } {
    const start = stmt.getStart();
    const ls = lineStart(text, start);
    const end = stmt.getEnd();
    const lineEnd = text.indexOf('\n', end);
    const after = lineEnd === -1 ? text.slice(end) : text.slice(end, lineEnd);
    const safe = after.trim() === '' || after.trim().startsWith('//');
    if (!safe) return { from: start, to: end };
    return {
        from: /^\s*$/.test(text.slice(ls, start)) ? ls : start,
        to: lineEnd === -1 ? text.length : lineEnd + 1
    };
}

interface SpecInfo {
    node: ts.Node;
    localName: string;
}

function buildImportRemovals(text: string, sourceFile: ts.SourceFile, counts: Map<string, number>): { removals: { from: number; to: number }[]; removed: number } {
    const removals: { from: number; to: number }[] = [];
    let removed = 0;
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            if (clause) {
                const specs: SpecInfo[] = [];
                if (clause.name) specs.push({ node: clause.name, localName: clause.name.text });
                let named: ts.NodeArray<ts.ImportSpecifier> | null = null;
                if (clause.namedBindings) {
                    if (ts.isNamespaceImport(clause.namedBindings)) {
                        specs.push({ node: clause.namedBindings, localName: clause.namedBindings.name.text });
                    } else {
                        named = clause.namedBindings.elements;
                        for (const el of named) specs.push({ node: el, localName: el.name.text });
                    }
                }
                const unused = specs.filter((s) => (counts.get(s.localName) || 0) === 0);
                if (unused.length === 0) return;
                removed += unused.length;
                if (unused.length === specs.length) {
                    removals.push(wholeLineRange(text, node));
                    return;
                }
                const unusedNamed = unused.filter((s) => ts.isImportSpecifier(s.node));
                if (named && unusedNamed.length > 0) {
                    const usedNamed = named.filter((el) => !unusedNamed.some((s) => s.node === el));
                    if (usedNamed.length === 0) {
                        const from = findComma(text, clause.name!.getEnd(), clause.namedBindings!.getFullStart());
                        if (from >= 0) removals.push({ from, to: clause.namedBindings!.getEnd() });
                    } else {
                        for (const s of unusedNamed) {
                            const el = s.node as ts.ImportSpecifier;
                            const idx = named.indexOf(el);
                            if (idx === 0) {
                                let from = el.getStart();
                                while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--;
                                const comma = findComma(text, el.getEnd(), named[1].getFullStart());
                                if (comma >= 0) removals.push({ from, to: comma + 1 });
                            } else {
                                const comma = findComma(text, named[idx - 1].getEnd(), el.getFullStart());
                                if (comma >= 0) removals.push({ from: comma, to: el.getEnd() });
                            }
                        }
                    }
                }
                const unusedDefault = unused.filter((s) => !ts.isImportSpecifier(s.node) && !ts.isNamespaceImport(s.node));
                for (const s of unusedDefault) {
                    let from = s.node.getStart();
                    while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--;
                    const to = clause.namedBindings ? clause.namedBindings.getFullStart() : text.length;
                    const comma = findComma(text, s.node.getEnd(), to);
                    if (comma >= 0) removals.push({ from, to: comma + 1 });
                }
            }
            return;
        }
        if (ts.isImportEqualsDeclaration(node)) {
            if ((counts.get(node.name.text) || 0) === 0) {
                removals.push(wholeLineRange(text, node));
                removed++;
            }
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return { removals, removed };
}

export function scriptKindFor(lang: string, filename: string): ts.ScriptKind {
    if (/\.tsx$/.test(filename)) return ts.ScriptKind.TSX;
    if (/\.jsx$/.test(filename)) return ts.ScriptKind.JSX;
    return lang === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

export function stripUnusedVars(text: string, lang: 'TS' | 'JS', scriptKind?: ts.ScriptKind): UnusedTextResult {
    const kind = scriptKind ?? (lang === 'TS' ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const sourceFile = ts.createSourceFile('f.' + (lang === 'TS' ? 'ts' : 'js'), text, ts.ScriptTarget.Latest, true, kind);

    const candidates: Candidate[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isVariableStatement(node)) {
            const mods = node.modifiers;
            if (mods && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DeclareKeyword)) {
                ts.forEachChild(node, visit);
                return;
            }
            for (const decl of node.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && !(decl.initializer && hasSideEffects(decl.initializer))) {
                    candidates.push({ name: decl.name.text, decl, stmt: node, list: node.declarationList });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const counts = new Map<string, number>();
    const countVisit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            if (!isBindingIdentifier(node)) {
                counts.set(node.text, (counts.get(node.text) || 0) + 1);
            }
        }
        ts.forEachChild(node, countVisit);
    };
    countVisit(sourceFile);

    let hasJsx = false;
    const jsxCheck = (node: ts.Node): void => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
            hasJsx = true;
            return;
        }
        ts.forEachChild(node, jsxCheck);
    };
    jsxCheck(sourceFile);

    const removals: { from: number; to: number }[] = [];
    let removed = 0;
    for (const c of candidates) {
        if ((counts.get(c.name) || 0) > 1) continue;
        const decls = c.list.declarations;
        if (decls.length === 1) {
            removals.push(wholeLineRange(text, c.stmt));
        } else {
            const idx = decls.indexOf(c.decl);
            if (idx === 0) {
                const comma = findComma(text, c.decl.getEnd(), decls[1].getFullStart());
                if (comma >= 0) {
                    let from = c.decl.getStart();
                    while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--;
                    removals.push({ from, to: comma + 1 });
                }
            } else {
                const comma = findComma(text, decls[idx - 1].getEnd(), c.decl.getFullStart());
                if (comma >= 0) removals.push({ from: comma, to: c.decl.getEnd() });
            }
        }
        removed++;
    }

    const imports = hasJsx ? { removals: [], removed: 0 } : buildImportRemovals(text, sourceFile, counts);
    removals.push(...imports.removals);
    removed += imports.removed;

    if (removals.length === 0) return { text, removed: 0 };
    removals.sort((a, b) => b.from - a.from);
    let out = text;
    for (const r of removals) {
        out = out.slice(0, r.from) + out.slice(r.to);
    }
    return { text: out, removed };
}