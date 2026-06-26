import { TLCombinator, TLField, TLOptionalParam, TLType, TLSchema } from './types';
import { crc32 } from './crc32';

interface ParseResult {
    types: Map<string, TLType>;
    constructors: Map<number, TLCombinator>;
    functions: Map<number, TLCombinator>;
    allConstructors: TLCombinator[];
}

export function parseTLSchema(schemaText: string): TLSchema {
    const cleaned = removeComments(schemaText);
    const sections = splitSections(cleaned);
    const result = parseDeclarations(sections.types, false);
    const funcResult = parseDeclarations(sections.functions, true);

    for (const [id, comb] of funcResult.functions) {
        result.functions.set(id, comb);
    }

    return {
        types: result.types,
        constructors: result.constructors,
        functions: result.functions,
        allConstructors: [...result.allConstructors, ...funcResult.allConstructors],
        raw: schemaText,
    };
}

function removeComments(text: string): string {
    let result = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
        } else if (text[i] === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i += 2;
        } else {
            result += text[i];
            i++;
        }
    }
    return result;
}

function splitSections(text: string): { types: string; functions: string } {
    const funcIdx = text.toLowerCase().indexOf('---functions---');
    const typesIdx = text.toLowerCase().indexOf('---types---');

    if (funcIdx === -1 && typesIdx === -1) {
        return { types: text, functions: '' };
    }

    if (funcIdx === -1) {
        return {
            types: text.substring(0, typesIdx),
            functions: text.substring(typesIdx + '---types---'.length),
        };
    }

    if (typesIdx === -1 || typesIdx < funcIdx) {
        return {
            types: text.substring(0, funcIdx),
            functions: text.substring(funcIdx + '---functions---'.length),
        };
    }

    const beforeFunc = text.substring(0, funcIdx);
    const funcSection = text.substring(funcIdx + '---functions---'.length, typesIdx);
    const afterTypes = text.substring(typesIdx + '---types---'.length);

    return {
        types: beforeFunc + afterTypes,
        functions: funcSection,
    };
}

function parseDeclarations(text: string, isFunction: boolean): ParseResult {
    const types = new Map<string, TLType>();
    const constructors = new Map<number, TLCombinator>();
    const functions = new Map<number, TLCombinator>();
    const allConstructors: TLCombinator[] = [];

    const declarations = splitDeclarations(text);

    for (const decl of declarations) {
        const trimmed = decl.trim();
        if (!trimmed || trimmed.startsWith('---')) continue;

        try {
            const comb = parseCombinator(trimmed, isFunction);
            if (comb.id === 0) {
                const { normalizeForCRC32 } = require('./schema-normalizer');
                const normalized = normalizeForCRC32(trimmed);
                comb.id = crc32(normalized);
            }

            allConstructors.push(comb);

            const targetMap = isFunction ? functions : constructors;
            targetMap.set(comb.id, comb);

            const typeName = comb.resultType;
            if (!types.has(typeName)) {
                types.set(typeName, {
                    name: typeName,
                    constructors: [],
                    isPolymorphic: comb.genericParams.length > 0,
                    genericParams: [],
                });
            }
            const tlType = types.get(typeName)!;
            tlType.constructors.push(comb);
            if (comb.genericParams.length > 0 && tlType.genericParams.length === 0) {
                tlType.genericParams = comb.genericParams;
            }
        } catch {
            continue;
        }
    }

    return { types, constructors, functions, allConstructors };
}

function lastIndexOfSemicolonOutsideStrings(text: string): number {
    let inString = false;
    for (let i = text.length - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '"' && text[i - 1] !== '\\') {
            inString = !inString;
        } else if (!inString && ch === ';') {
            return i;
        }
    }
    return -1;
}

function splitDeclarations(text: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && text[i - 1] !== '\\') {
            inString = !inString;
            current += ch;
        } else if (inString) {
            current += ch;
        } else if (ch === '(') {
            depth++;
            current += ch;
        } else if (ch === ')') {
            depth--;
            current += ch;
        } else if (ch === ';' && depth === 0) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) result.push(current);
    return result;
}

function parseCombinator(declaration: string, isFunction: boolean): TLCombinator {
    const semicolonIdx = lastIndexOfSemicolonOutsideStrings(declaration);
    const body = (semicolonIdx >= 0 ? declaration.substring(0, semicolonIdx) : declaration).trim();

    const hashMatch = body.match(/^(\S+?)#([0-9a-fA-F]{8})\s/);
    let combinatorName: string;
    let explicitId: number | undefined;

    if (hashMatch) {
        combinatorName = hashMatch[1];
        explicitId = parseInt(hashMatch[2], 16);
    } else {
        const nameMatch = body.match(/^(\S+)\s/);
        if (!nameMatch) throw new Error(`Invalid combinator: ${declaration}`);
        combinatorName = nameMatch[1];
    }

    let afterName = body;
    if (hashMatch) {
        afterName = body.substring(hashMatch[0].length);
    } else {
        const nameEnd = body.indexOf(' ');
        if (nameEnd === -1) throw new Error(`Invalid combinator: ${declaration}`);
        afterName = body.substring(nameEnd + 1);
    }

    const eqIdx = findEqualsSign(afterName);
    if (eqIdx === -1) throw new Error(`No '=' in combinator: ${declaration}`);

    const paramsPart = afterName.substring(0, eqIdx).trim();
    const resultPart = afterName.substring(eqIdx + 1).trim();

    const genericParams = parseGenericParams(paramsPart);
    const fieldsPart = stripGenericParams(paramsPart);
    const fields = parseFields(fieldsPart);
    const { resultType, resultSubexprs } = parseResultType(resultPart);

    const comb: TLCombinator = {
        id: explicitId ?? 0,
        name: combinatorName,
        genericParams,
        fields,
        resultType,
        resultSubexprs,
        isFunction,
    };

    if (explicitId !== undefined) {
        comb.id = explicitId;
    }

    return comb;
}

function findEqualsSign(text: string): number {
    let depth = 0;
    let inCurly = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') { inCurly = true; depth++; }
        else if (text[i] === '}') { depth--; if (depth === 0) inCurly = false; }
        else if (text[i] === '(' && !inCurly) { depth++; }
        else if (text[i] === ')' && !inCurly) { depth--; }
        else if (text[i] === '=' && depth === 0 && !inCurly) {
            return i;
        }
    }
    return -1;
}

function parseGenericParams(text: string): TLOptionalParam[] {
    const params: TLOptionalParam[] = [];
    const regex = /\{([^}]+)\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const inner = match[1].trim();
        const colonIdx = inner.indexOf(':');
        if (colonIdx === -1) continue;
        const namesPart = inner.substring(0, colonIdx).trim();
        const typePart = inner.substring(colonIdx + 1).trim();
        const names = namesPart.split(/\s+/).filter(n => n.length > 0);
        for (const name of names) {
            params.push({ name, type: typePart });
        }
    }
    return params;
}

function stripGenericParams(text: string): string {
    return text.replace(/\{[^}]+\}/g, '').trim();
}

function parseConditionalType(typeStr: string): { type: string; flagsField?: string; bit?: number } {
    const trimmed = typeStr.trim();

    let inner = trimmed;
    let bang = false;
    if (inner.startsWith('!')) {
        bang = true;
        inner = inner.substring(1).trim();
    }

    if (inner.startsWith('(') && inner.endsWith(')')) {
        inner = inner.substring(1, inner.length - 1).trim();
    }

    const condMatch = inner.match(/^(\w+)(?:\.(\d+))\?(.+)$/);
    if (condMatch) {
        return {
            type: condMatch[3].trim(),
            flagsField: condMatch[1],
            bit: parseInt(condMatch[2]),
        };
    }

    return { type: bang ? '!' + trimmed.substring(1) : trimmed };
}

export function parseFieldToken(token: string): TLField {
    const trimmed = token.trim();
    if (!trimmed) return { name: '_', type: '' };

    const namedMatch = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
    if (namedMatch) {
        const name = namedMatch[1];
        const rawType = namedMatch[2].trim();
        const { type, flagsField, bit } = parseConditionalType(rawType);

        if (flagsField !== undefined) {
            return {
                name,
                type,
                conditionalFlagsField: flagsField,
                conditionalBit: bit,
            };
        }

        return { name, type: rawType };
    }

    const { type, flagsField, bit } = parseConditionalType(trimmed);
    if (flagsField !== undefined) {
        return {
            name: '_',
            type,
            conditionalFlagsField: flagsField,
            conditionalBit: bit,
        };
    }

    return { name: '_', type: trimmed };
}

function parseFields(text: string): TLField[] {
    if (!text.trim()) return [];

    const fields: TLField[] = [];
    const fieldTexts = splitFieldDeclarations(text);

    for (const ft of fieldTexts) {
        const field = parseSingleField(ft);
        if (field) fields.push(field);
    }

    return fields;
}

function splitFieldDeclarations(text: string): string[] {
    const result: string[] = [];
    let current = '';
    let depth = 0;
    let curlyDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === '{') curlyDepth++;
        else if (ch === '}') curlyDepth--;
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;

        if (ch === ' ' && depth === 0 && curlyDepth === 0 && bracketDepth === 0) {
            const nextNonSpace = text.substring(i + 1).match(/^\S/)?.[0];
            const currentTrimmed = current.trim();
            const lastChar = currentTrimmed[currentTrimmed.length - 1];

            const isFieldBoundary = nextNonSpace && /^[a-zA-Z_]/.test(nextNonSpace) &&
                nextNonSpace !== ':' && nextNonSpace !== '*' && nextNonSpace !== '[' && nextNonSpace !== ']' &&
                lastChar !== ':' && lastChar !== '*';

            if (isFieldBoundary && currentTrimmed) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        } else {
            current += ch;
        }
    }
    if (current.trim()) result.push(current);
    return result;
}

function parseSingleField(text: string): TLField | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const colonIdx = findColonOutsideBrackets(trimmed);
    if (colonIdx !== -1) {
        const name = trimmed.substring(0, colonIdx).trim();
        const typeStr = trimmed.substring(colonIdx + 1).trim();

        const repMatch = typeStr.match(/^(\w+)\s*\*\s*(.+)$/);
        if (repMatch) {
            const [, multiplicity, innerType] = repMatch;
            return { name, type: `repetition:${multiplicity}*${innerType.trim()}` };
        }

        const parenRepMatch = typeStr.match(/^\((\w+)\s*\*\s*(.+)\)$/);
        if (parenRepMatch) {
            const [, multiplicity, innerType] = parenRepMatch;
            return { name, type: `repetition:${multiplicity}*${innerType.trim()}` };
        }

        const { type, flagsField, bit } = parseConditionalType(typeStr);
        if (flagsField !== undefined) {
            return { name, type, conditionalFlagsField: flagsField, conditionalBit: bit };
        }

        return { name, type: typeStr };
    }

    const repMatch = trimmed.match(/^(\w+)\s*\*\s*(.+)$/);
    if (repMatch) {
        const [, multiplicity, innerType] = repMatch;
        return { name: '_', type: `repetition:${multiplicity}*${innerType.trim()}` };
    }

    const parenRepMatch = trimmed.match(/^\((\w+)\s*\*\s*(.+)\)$/);
    if (parenRepMatch) {
        const [, multiplicity, innerType] = parenRepMatch;
        return { name: '_', type: `repetition:${multiplicity}*${innerType.trim()}` };
    }

    const { type, flagsField, bit } = parseConditionalType(trimmed);
    if (flagsField !== undefined) {
        return { name: '_', type, conditionalFlagsField: flagsField, conditionalBit: bit };
    }

    return { name: '_', type: trimmed };
}

function findColonOutsideBrackets(text: string): number {
    let depth = 0;
    let bracketDepth = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (text[i] === '[') bracketDepth++;
        else if (text[i] === ']') bracketDepth--;
        else if (text[i] === ':' && depth === 0 && bracketDepth === 0) return i;
    }
    return -1;
}

export function splitTopLevel(text: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let depth = 0;
    let curlyDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === '{') curlyDepth++;
        else if (ch === '}') curlyDepth--;
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;

        if (ch === ' ' && depth === 0 && curlyDepth === 0 && bracketDepth === 0) {
            if (current.trim()) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current.trim()) tokens.push(current);
    return tokens;
}

export function tokenizeFields(text: string): string[] {
    const rawTokens: string[] = [];
    let current = '';
    let depth = 0;
    let curlyDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === '{') curlyDepth++;
        else if (ch === '}') curlyDepth--;
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth--;

        if (ch === ' ' && depth === 0 && curlyDepth === 0 && bracketDepth === 0) {
            if (current.trim()) {
                rawTokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current.trim()) rawTokens.push(current);

    const tokens: string[] = [];
    for (let i = 0; i < rawTokens.length; i++) {
        if (rawTokens[i] === '*' && tokens.length > 0) {
            tokens[tokens.length - 1] = tokens[tokens.length - 1] + ' *' + (rawTokens[i + 1] || '');
            if (i + 1 < rawTokens.length) i++;
        } else {
            tokens.push(rawTokens[i]);
        }
    }
    return tokens;
}

function parseResultType(text: string): { resultType: string; resultSubexprs: string[] } {
    const trimmed = text.trim();
    const subexprs: string[] = [];

    if (trimmed === '_') {
        return { resultType: '_', resultSubexprs: [] };
    }

    const angleIdx = trimmed.indexOf('<');
    if (angleIdx !== -1 && trimmed.endsWith('>')) {
        const inner = trimmed.substring(angleIdx + 1, trimmed.length - 1);
        const base = trimmed.substring(0, angleIdx).trim();
        const parts = splitAngleArgs(inner);
        subexprs.push(...parts);
        return { resultType: base, resultSubexprs: subexprs };
    }

    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx !== -1) {
        const base = trimmed.substring(0, spaceIdx).trim();
        const rest = trimmed.substring(spaceIdx + 1).trim();
        if (rest) subexprs.push(rest);
        return { resultType: base, resultSubexprs: subexprs };
    }

    return { resultType: trimmed, resultSubexprs: subexprs };
}

function splitAngleArgs(text: string): string[] {
    const args: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<') depth++;
        else if (ch === '>') depth--;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;

        if (ch === ',' && depth === 0) {
            args.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) args.push(current.trim());
    return args;
}
