import { TLSchema, TLCombinator, TLField } from './types';

export interface TLValidationError {
    line: number;
    message: string;
    severity: 'error' | 'warning';
}

export function validateTLSchema(schema: TLSchema): TLValidationError[] {
    const errors: TLValidationError[] = [];

    validateTypeReferences(schema, errors);
    validatePolymorphicParams(schema, errors);
    validateConditionalFields(schema, errors);
    validateDuplicateConstructors(schema, errors);

    return errors;
}

function validateTypeReferences(schema: TLSchema, errors: TLValidationError[]): void {
    const knownTypes = new Set<string>([
        'int', 'long', 'double', 'string', 'bool', 'true', 'false', 'null',
        'Int', 'Long', 'Double', 'String', 'Bool', 'True', 'False', 'Null',
        'Object', 'Vector', 'vector', '#',
    ]);

    for (const type of schema.types.values()) {
        knownTypes.add(type.name);
    }

    for (const comb of schema.constructors.values()) {
        for (const field of comb.fields) {
            const bareType = field.type.replace(/^%/, '').replace(/^\(/, '').replace(/\)$/, '').trim();
            const baseType = extractBaseType(bareType);

            if (!knownTypes.has(baseType) && !baseType.startsWith('vector') && !baseType.startsWith('Vector')) {
                errors.push({
                    line: 0,
                    message: `Unknown type '${baseType}' in constructor '${comb.name}' field '${field.name}'`,
                    severity: 'warning',
                });
            }
        }
    }
}

function extractBaseType(type: string): string {
    const angleIdx = type.indexOf('<');
    if (angleIdx !== -1) {
        return type.substring(0, angleIdx).trim();
    }
    const parenIdx = type.indexOf('(');
    if (parenIdx !== -1) {
        return type.substring(0, parenIdx).trim();
    }
    return type.trim();
}

function validatePolymorphicParams(schema: TLSchema, errors: TLValidationError[]): void {
    for (const comb of schema.constructors.values()) {
        const genericNames = new Set(comb.genericParams.map(p => p.name));
        for (const field of comb.fields) {
            const typeStr = field.type;
            for (const name of genericNames) {
                if (typeStr.includes(name) && !comb.genericParams.some(p => p.name === name)) {
                    errors.push({
                        line: 0,
                        message: `Undefined generic parameter '${name}' used in constructor '${comb.name}'`,
                        severity: 'error',
                    });
                }
            }
        }
    }
}

function validateConditionalFields(schema: TLSchema, errors: TLValidationError[]): void {
    for (const comb of schema.constructors.values()) {
        const fieldNames = new Set(comb.fields.map(f => f.name));

        for (const field of comb.fields) {
            if (field.conditionalFlagsField !== undefined) {
                if (!fieldNames.has(field.conditionalFlagsField)) {
                    const flagsFieldExists = comb.fields.some(f =>
                        f.name === field.conditionalFlagsField && f.type === '#'
                    );
                    if (!flagsFieldExists) {
                        errors.push({
                            line: 0,
                            message: `Conditional field '${field.name}' references undefined flags field '${field.conditionalFlagsField}' in constructor '${comb.name}'`,
                            severity: 'error',
                        });
                    }
                }
            }
        }
    }
}

function validateDuplicateConstructors(schema: TLSchema, errors: TLValidationError[]): void {
    const seen = new Map<number, string>();
    for (const comb of schema.constructors.values()) {
        if (seen.has(comb.id)) {
            errors.push({
                line: 0,
                message: `Duplicate constructor ID 0x${comb.id.toString(16)}: '${comb.name}' and '${seen.get(comb.id)}'`,
                severity: 'error',
            });
        }
        seen.set(comb.id, comb.name);
    }
}
