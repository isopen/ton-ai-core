export interface TLField {
    name: string;
    type: string;
    conditionalBit?: number;
    conditionalFlagsField?: string;
    isBare?: boolean;
    bang?: boolean;
    repetition?: { multiplicity: string; innerType: string };
}

export interface TLOptionalParam {
    name: string;
    type: string;
}

export interface TLCombinator {
    id: number;
    name: string;
    genericParams: TLOptionalParam[];
    fields: TLField[];
    resultType: string;
    resultSubexprs: string[];
    isFunction: boolean;
}

export interface TLType {
    name: string;
    constructors: TLCombinator[];
    isPolymorphic: boolean;
    genericParams: TLOptionalParam[];
}

export interface TLSchema {
    types: Map<string, TLType>;
    constructors: Map<number, TLCombinator>;
    functions: Map<number, TLCombinator>;
    allConstructors: TLCombinator[];
    raw: string;
}

export interface TLBuiltinType {
    bareName: string;
    boxedName: string;
    constructorId: number;
}

export const TL_BUILTINS: TLBuiltinType[] = [
    { bareName: 'int', boxedName: 'Int', constructorId: 0xa8509bda },
    { bareName: 'long', boxedName: 'Long', constructorId: 0x22076cba },
    { bareName: 'double', boxedName: 'Double', constructorId: 0x2210c154 },
    { bareName: 'string', boxedName: 'String', constructorId: 0xb5286e24 },
];

export const BOOL_TRUE_ID = 0x997275b5;
export const BOOL_FALSE_ID = 0xbc799737;
export const VECTOR_ID = 0x1cb5c415;

export const BOXED_BUILTINS = new Set(['Int', 'Long', 'Double', 'String', 'Bool', 'True', 'False', 'Null', 'Object']);
export const BARE_BUILTINS = new Set(['int', 'long', 'double', 'string', 'bool', 'true', 'false', 'null', 'object']);
