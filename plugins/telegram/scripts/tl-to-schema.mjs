#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function usage(message) {
    if (message) console.error(`error: ${message}\n`);
    console.error(
        'usage: tl-to-schema.mjs --telegram <telegram_api.tl> [--mtproto <mtproto_api.tl>] ' +
        '--layer <number> --out <telegram-schema.json>'
    );
    process.exit(2);
}

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) usage(`unexpected argument: ${arg}`);
        const key = arg.slice(2);
        const value = argv[++i];
        if (value === undefined) usage(`missing value for --${key}`);
        args[key] = value;
    }
    if (!args.telegram) usage('--telegram is required');
    if (!args.layer) usage('--layer is required');
    if (!args.out) usage('--out is required');
    return args;
}

function toSignedInt32(hex) {
    const unsigned = parseInt(hex, 16) >>> 0;
    return unsigned >= 0x80000000 ? unsigned - 0x100000000 : unsigned;
}

function parseDeclaration(line, isMethod) {
    let body = line.trim();
    if (body.endsWith(';')) body = body.slice(0, -1).trim();

    let name;
    let id;
    let rest;

    const withParams = body.match(/^(\S+?)(?:#([0-9a-fA-F]{1,8}))?\s/);
    if (withParams) {
        name = withParams[1];
        id = withParams[2] ? String(toSignedInt32(withParams[2])) : undefined;
        rest = body.slice(withParams[0].length);
    } else {
        const noParams = body.match(/^(\S+?)(?:#([0-9a-fA-F]{1,8}))?\s*=/);
        if (!noParams) throw new Error(`cannot parse declaration: ${line}`);
        name = noParams[1];
        id = noParams[2] ? String(toSignedInt32(noParams[2])) : undefined;
        rest = body.slice(noParams[0].length - 1);
    }

    const eq = rest.indexOf('=');
    if (eq < 0) throw new Error(`missing '=' in declaration: ${line}`);

    const paramsText = rest.slice(0, eq).trim();
    const type = rest.slice(eq + 1).trim();
    const params = [];

    for (const token of paramsText.split(/\s+/).filter(Boolean)) {
        const colon = token.indexOf(':');
        if (colon < 0) continue;

        const paramName = token.slice(0, colon);
        const repr = token.slice(colon + 1);
        let baseType = repr;
        let optional;
        let flag;

        const conditional = repr.match(/^([A-Za-z0-9_]+)\.(\d+)\?(.+)$/);
        if (conditional) {
            optional = true;
            flag = { field: conditional[1], bit: Number(conditional[2]) };
            baseType = conditional[3];
        }

        const param = { name: paramName, type: baseType, repr };
        if (optional) param.optional = true;
        if (flag) param.flag = flag;
        params.push(param);
    }

    if (isMethod) {
        const method = { params, type };
        if (id !== undefined) method.id = id;
        method.method = name;
        return method;
    }

    const constructor = { params, type };
    if (id !== undefined) constructor.id = id;
    constructor.predicate = name;
    return constructor;
}

function parseTl(text) {
    const constructors = [];
    const methods = [];
    let section = 'types';

    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        if (line === '---types---') {
            section = 'types';
            continue;
        }
        if (line === '---functions---') {
            section = 'functions';
            continue;
        }
        if (section === 'types') constructors.push(parseDeclaration(line, false));
        else methods.push(parseDeclaration(line, true));
    }

    return { constructors, methods };
}

function findNullConstructor(mtprotoText) {
    for (const rawLine of mtprotoText.split('\n')) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line.startsWith('null#')) continue;
        return parseDeclaration(line, false);
    }
    return null;
}

const args = parseArgs(process.argv);
const telegramText = fs.readFileSync(args.telegram, 'utf8');
const schema = parseTl(telegramText);

const layer = Number(args.layer);
if (!Number.isInteger(layer) || layer <= 0) usage(`invalid --layer: ${args.layer}`);

if (!schema.constructors.some(c => c.predicate === 'null')) {
    const fromMtproto = args.mtproto
        ? findNullConstructor(fs.readFileSync(args.mtproto, 'utf8'))
        : null;
    schema.constructors.push(
        fromMtproto ?? { id: '1450380236', params: [], type: 'Null', predicate: 'null' }
    );
}

schema.layer = layer;
schema.version = layer;

const outPath = path.resolve(args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`);

console.log(
    `wrote ${outPath}: layer ${layer}, ` +
    `${schema.constructors.length} constructors, ${schema.methods.length} methods`
);
