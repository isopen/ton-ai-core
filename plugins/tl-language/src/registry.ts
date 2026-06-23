import { TLSchema, TLCombinator, TLType } from './types';
import { parseTLSchema } from './parser';

export class SchemaRegistry {
    private schema: TLSchema;

    private constructorsById: Map<number, TLCombinator>;
    private functionsById: Map<number, TLCombinator>;
    private typesByName: Map<string, TLType>;
    private constructorsByName: Map<string, TLCombinator[]>;
    private functionsByName: Map<string, TLCombinator[]>;

    constructor(schemaText: string) {
        this.schema = parseTLSchema(schemaText);
        this.constructorsById = this.schema.constructors;
        this.functionsById = this.schema.functions;
        this.typesByName = this.schema.types;
        this.constructorsByName = new Map();
        this.functionsByName = new Map();

        for (const comb of this.constructorsById.values()) {
            const list = this.constructorsByName.get(comb.name) || [];
            list.push(comb);
            this.constructorsByName.set(comb.name, list);
        }

        for (const comb of this.functionsById.values()) {
            const list = this.functionsByName.get(comb.name) || [];
            list.push(comb);
            this.functionsByName.set(comb.name, list);
        }
    }

    static fromText(schemaText: string): SchemaRegistry {
        return new SchemaRegistry(schemaText);
    }

    getConstructorById(id: number): TLCombinator | undefined {
        return this.constructorsById.get(id);
    }

    getFunctionById(id: number): TLCombinator | undefined {
        return this.functionsById.get(id);
    }

    getCombinatorById(id: number): TLCombinator | undefined {
        return this.constructorsById.get(id) || this.functionsById.get(id);
    }

    getConstructorsByName(name: string): TLCombinator[] {
        return this.constructorsByName.get(name) || [];
    }

    getFunctionsByName(name: string): TLCombinator[] {
        return this.functionsByName.get(name) || [];
    }

    getType(name: string): TLType | undefined {
        return this.typesByName.get(name);
    }

    getAllTypes(): TLType[] {
        return Array.from(this.typesByName.values());
    }

    getAllConstructors(): TLCombinator[] {
        return Array.from(this.constructorsById.values());
    }

    getAllFunctions(): TLCombinator[] {
        return Array.from(this.functionsById.values());
    }

    getConstructorsForType(typeName: string): TLCombinator[] {
        const type = this.typesByName.get(typeName);
        return type ? type.constructors : [];
    }

    findConstructorByName(name: string): TLCombinator | undefined {
        const list = this.constructorsByName.get(name);
        return list && list.length > 0 ? list[0] : undefined;
    }

    findFunctionByName(name: string): TLCombinator | undefined {
        const list = this.functionsByName.get(name);
        return list && list.length > 0 ? list[0] : undefined;
    }

    hasConstructor(id: number): boolean {
        return this.constructorsById.has(id);
    }

    hasFunction(id: number): boolean {
        return this.functionsById.has(id);
    }

    get raw(): string {
        return this.schema.raw;
    }

    get constructorCount(): number {
        return this.constructorsById.size;
    }

    get functionCount(): number {
        return this.functionsById.size;
    }

    get typeCount(): number {
        return this.typesByName.size;
    }
}
