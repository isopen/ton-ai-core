interface SchemaParam {
    name: string;
    type: string;
    repr?: string;
}

interface SchemaConstructor {
    id?: string;
    predicate: string;
    params: SchemaParam[];
    type: string;
}

interface SchemaMethod {
    id?: string;
    method: string;
    params: SchemaParam[];
    type: string;
}

export interface TelegramSchema {
    constructors: SchemaConstructor[];
    methods: SchemaMethod[];
}

function signedDecimalToHex(signed: string): string {
    const num = parseInt(signed, 10);
    return (num >>> 0).toString(16).padStart(8, '0');
}

function formatId(id: string | undefined): string {
    return id === undefined ? '' : `#${signedDecimalToHex(id)}`;
}

function formatParams(params: SchemaParam[]): string {
    return params.map(p => `${p.name}:${p.repr || p.type}`).join(' ');
}

export function convertJsonSchemaToTL(json: TelegramSchema): string {
    const lines: string[] = [];

    lines.push('---types---');
    for (const c of json.constructors) {
        const paramsStr = formatParams(c.params);
        const line = paramsStr
            ? `${c.predicate}${formatId(c.id)} ${paramsStr} = ${c.type};`
            : `${c.predicate}${formatId(c.id)} = ${c.type};`;
        lines.push(line);
    }

    lines.push('');
    lines.push('---functions---');
    for (const m of json.methods) {
        const paramsStr = formatParams(m.params);
        const line = paramsStr
            ? `${m.method}${formatId(m.id)} ${paramsStr} = ${m.type};`
            : `${m.method}${formatId(m.id)} = ${m.type};`;
        lines.push(line);
    }

    return lines.join('\n');
}
