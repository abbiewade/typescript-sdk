import { HandlerMetadata, Prompt, Resource, Tool } from '../types.js';
import { z } from "zod";

/**
 * Symbol used to store handler metadata on decorated methods
 * @internal
 */
const METADATA_SYMBOL = Symbol('handlerMetadata');
interface MetadataStorage {
    [METADATA_SYMBOL]?: HandlerMetadata;
}
declare global {
    interface Function extends MetadataStorage {
        [METADATA_SYMBOL]?: HandlerMetadata;
    }
}

/**
 * Symbol used to store parameter validation metadata
 * @internal
 */
const PARAM_METADATA_SYMBOL = Symbol('parameterMetadata');

interface Constructor {
    prototype: {
        [PARAM_METADATA_SYMBOL]?: Map<string, Map<number, z.ZodType>>;
    };
}

interface ValidatedParameter {
    name: string;
    schema: z.ZodType;
    required: boolean;
}

interface ParamInfo {
    name: string;
    schema: z.ZodType;
}

type ParamMapEntry = [number, z.ZodType];

/**
 * Decorator for defining parameter validation constraints using Zod schemas
 * @param schema - The Zod schema to validate the parameter against
 * @throws {Error} If the parameter fails validation at runtime
 * @example
 * class Example {
 *   async process(
 *     @param(z.string().min(1)) required: string,
 *     @param(z.number().optional()) optional?: number
 *   ) {
 *     return `${required}: ${optional ?? 'no value'}`;
 *   }
 * }
 */
export function param(schema: z.ZodType): ParameterDecorator {
    return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number): void => {
        if (propertyKey === undefined) return;

        const proto = (target.constructor as Constructor).prototype;
        if (!proto[PARAM_METADATA_SYMBOL]) {
            proto[PARAM_METADATA_SYMBOL] = new Map<string, Map<number, z.ZodType>>();
        }

        const key = String(propertyKey);
        if (!proto[PARAM_METADATA_SYMBOL].has(key)) {
            proto[PARAM_METADATA_SYMBOL].set(key, new Map());
        }
        const map = proto[PARAM_METADATA_SYMBOL].get(key)!;

        // Handle optional parameters correctly
        let finalSchema = schema;
        if (target instanceof Function && target.length <= parameterIndex) {
            finalSchema = schema.optional();
        }

        const existingSchema = map.get(parameterIndex);
        if (existingSchema) {
            map.set(parameterIndex, z.intersection(existingSchema, finalSchema));
        } else {
            map.set(parameterIndex, finalSchema);
        }
    };
}

function isZodObject(schema: z.ZodType): boolean {
    const def = schema._def as any; // We need to use any here as Zod's internal types are not fully exposed

    if (def.typeName === 'ZodObject') return true;

    // Check for nested object in ZodOptional or ZodDefault
    if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
        const innerDef = def.innerType?._def;
        return innerDef?.typeName === 'ZodObject';
    }

    // Check if schema has shape property (ZodObject schemas have this)
    if (def.shape && typeof def.shape === 'object') {
        // Cast to ZodType to ensure proper type checking
        return Object.values(def.shape)
            .some((prop: any) => prop?._def?.typeName === 'ZodObject');
    }

    return false;
}

function applyValidation(target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') return;

    const capturedMetadata = originalMethod[METADATA_SYMBOL];

    descriptor.value = async function(...args: any[]) {
        if (!capturedMetadata) {
            throw new Error(`Method ${String(propertyKey)} is not properly decorated with @tool, @prompt, or @resource`);
        }

        let paramValues = args;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && 'arguments' in args[0]) {
            const params = args[0].arguments as Record<string, unknown>;
            const parameters = Array.from(capturedMetadata.parameters.entries()) as Array<[number, { name: string; schema: z.ZodType; required: boolean }]>;
            paramValues = parameters.map(([_, param]) => params[param.name]);
        }

        for (const [index, paramMetadata] of capturedMetadata.parameters.entries()) {
            const value = paramValues[index];

            if (paramMetadata.required && (value === undefined || value === null)) {
                throw new Error(`Parameter ${paramMetadata.name} is required`);
            }

            // Only validate if value is provided or parameter is required
            if (value !== undefined) {
                const schema = paramMetadata.schema;
                const def = (schema._def as any);

                // Check for number schema
                const isNumberSchema = def.typeName === 'ZodNumber' ||
                    (def.typeName === 'ZodOptional' && def.innerType?._def?.typeName === 'ZodNumber') ||
                    (def.typeName === 'ZodDefault' && def.innerType?._def?.typeName === 'ZodNumber');

                // Check for object schema using our helper
                const needsJsonParse = typeof value === 'string' && isZodObject(schema);

                // Prepare value for validation
                let valueToValidate = value;
                if (isNumberSchema && typeof value === 'string') {
                    valueToValidate = Number(value);
                } else if (needsJsonParse) {
                    try {
                        valueToValidate = JSON.parse(value);
                    } catch (e: unknown) {
                        if (e instanceof Error) {
                            throw new Error(`Parameter '${paramMetadata.name}' contains invalid JSON: ${e.message}`);
                        } else {
                            throw new Error(`Parameter '${paramMetadata.name}' contains invalid JSON`);
                        }
                    }
                }

                const result = paramMetadata.schema.safeParse(valueToValidate);
                if (!result.success) {
                    throw new Error(`Parameter '${paramMetadata.name}' validation failed for ${String(propertyKey)}: ${JSON.stringify(result.error.errors)}`);
                }

                // Update the value in paramValues with the parsed value
                if (valueToValidate !== value) {
                    paramValues[index] = valueToValidate;
                }
            }
        }

        return originalMethod.apply(this, paramValues);
    };

    descriptor.value[METADATA_SYMBOL] = capturedMetadata;
}

/**
 * Decorator for defining a tool handler
 * @param options - Configuration options for the tool
 * @param options.name - Optional custom name for the tool. If not provided, the method name will be used.
 * @param options.description - Optional description of what the tool does
 * @param options.inputSchema - Optional custom input schema. If not provided, will be generated from parameter decorators.
 * @throws {Error} If decorator is applied to a non-method or if required metadata is missing
 * @example
 * class MyTools {
 *   @tool({
 *     name: 'calculate',
 *     description: 'Performs a calculation'
 *   })
 *   async calculate(@param(z.number()) value: number) {
 *     return { result: value * 2 };
 *   }
 * }
 */
export function tool(options: Partial<Omit<Tool, 'name' | 'description' | 'inputSchema'>> & {
    name?: string;
    description?: string;
} = {}): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
        // Check if it's a getter/setter
        if (descriptor.get || descriptor.set) {
            throw new Error('@tool decorator cannot be applied to getters or setters');
        }

        const method = descriptor.value;
        if (typeof method !== 'function') {
            throw new Error(`@tool decorator can only be applied to methods, not to ${typeof method}`);
        }

        const proto = target.constructor.prototype;
        const paramMap = proto[PARAM_METADATA_SYMBOL]?.get(String(propertyKey)) || new Map();
        const paramNames = getParameterNames(method);

        const orderedParams: ParamInfo[] = Array.from(paramMap.entries() as IterableIterator<ParamMapEntry>)
            .sort((a: ParamMapEntry, b: ParamMapEntry) => a[0] - b[0])
            .map(([index, schema]: ParamMapEntry) => ({
                name: paramNames[index] || `param${index}`,
                schema
            }));

        const metadata: HandlerMetadata = {
            type: 'tool',
            metadata: {
                name: options.name ?? String(propertyKey),
                description: options.description,
                inputSchema: {
                    type: "object",
                    properties: Object.fromEntries(
                        orderedParams.map((param: ParamInfo) => [
                            param.name,
                            param.schema
                        ])
                    ),
                    required: orderedParams
                        .filter(param => !param.schema.isOptional())
                        .map(param => param.name)
                }
            },
            parameters: new Map(
                orderedParams.map((param: ParamInfo, index) => [
                    index,
                    {
                        name: param.name,
                        schema: param.schema,
                        required: !param.schema.isOptional()
                    }
                ])
            )
        };

        descriptor.value[METADATA_SYMBOL] = metadata;
        applyValidation(target, propertyKey, descriptor);
    };
}

/**
 * Decorator for defining a prompt handler
 * @param options - Configuration options for the prompt
 * @param options.name - Optional custom name for the prompt
 * @example
 * class MyPrompts {
 *   @prompt({
 *     name: 'greet',
 *     description: 'Creates a greeting message'
 *   })
 *   async createGreeting(
 *     @param(z.string().min(1)) name: string,
 *     @param(z.string().optional()) title?: string
 *   ): Promise<unknown> {
 *     return { messages: [`Hello ${title ? title + ' ' : ''}${name}!`] };
 *   }
 * }
 */
export function prompt(options: Partial<Omit<Prompt, 'name'>> & {
    name?: string;
    description?: string;
} = {}): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
        if (descriptor.get || descriptor.set) {
            throw new Error('@prompt decorator cannot be applied to getters or setters');
        }

        const method = descriptor.value;
        if (typeof method !== 'function') {
            throw new Error(`@prompt decorator can only be applied to methods, not to ${typeof method}`);
        }

        // Rest of the implementation...
        const proto = target.constructor.prototype;
        const paramMap = proto[PARAM_METADATA_SYMBOL]?.get(String(propertyKey)) || new Map();
        const paramNames = getParameterNames(method);

        const entries = Array.from(paramMap.entries());
        const args = entries.map((entry): {
            type: "string" | "number" | "boolean" | "object" | "array";
            name: string;
            required: boolean;
            description?: string;
        } => {
            const [index, schema] = entry as [number, z.ZodType];
            const paramName = paramNames[index] || `param${index}`;

            const def = (schema._def as any);
            let type: "string" | "number" | "boolean" | "object" | "array" = "object";

            if (def.typeName === 'ZodString') type = "string";
            else if (def.typeName === 'ZodNumber') type = "number";
            else if (def.typeName === 'ZodBoolean') type = "boolean";
            else if (def.typeName === 'ZodArray') type = "array";
            else if (def.typeName === 'ZodOptional') {
                const innerDef = def.innerType._def;
                if (innerDef.typeName === 'ZodString') type = "string";
                else if (innerDef.typeName === 'ZodNumber') type = "number";
                else if (innerDef.typeName === 'ZodBoolean') type = "boolean";
                else if (innerDef.typeName === 'ZodArray') type = "array";
            }

            return {
                name: paramName,
                description: options.description,
                required: !schema.isOptional(),
                type
            };
        });

        const parameters = new Map(
            entries.map((entry) => {
                const [index, schema] = entry as [number, z.ZodType];
                const paramName = paramNames[index] || `param${index}`;
                return [
                    index,
                    {
                        name: paramName,
                        schema,
                        required: !schema.isOptional()
                    }
                ] as const;
            })
        );

        const metadata = {
            type: 'prompt' as const,
            metadata: {
                name: options.name ?? String(propertyKey),
                description: options.description,
                arguments: args
            },
            parameters
        };

        descriptor.value = async function(...args: unknown[]) {
            validateArgs(args, metadata);
            const result = await method.apply(this, args);
            return {
                messages: Array.isArray(result) ? result : [result],
                ...result
            };
        };
        descriptor.value[METADATA_SYMBOL] = metadata;
    };
}

/**
 * Decorator for defining a resource handler
 * @param options - Resource configuration options
 * @example
 * class MyResources {
 *   @resource({
 *     uri: 'file:///path/to/resource.md',
 *     name: 'Documentation',
 *     description: 'Project documentation',
 *     mimeType: 'text/markdown'
 *   })
 *   async getDocumentation(): Promise<unknown> {
 *     return { text: '# Documentation\n\nContent here...' };
 *   }
 * }
 */
export function resource(options: Resource): MethodDecorator {
    return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
        const method = descriptor.value;
        if (typeof method !== 'function') return;

        const proto = target.constructor.prototype;
        const paramMap = proto[PARAM_METADATA_SYMBOL]?.get(String(propertyKey)) || new Map();
        const paramNames = getParameterNames(method);

        const orderedParams: ParamInfo[] = Array.from(paramMap.entries() as IterableIterator<ParamMapEntry>)
            .sort((a: ParamMapEntry, b: ParamMapEntry) => a[0] - b[0])
            .map(([index, schema]: ParamMapEntry) => ({
                name: paramNames[index] || `param${index}`,
                schema
            }));

        descriptor.value[METADATA_SYMBOL] = {
            type: 'resource',
            metadata: options,
            parameters: new Map(
                orderedParams.map((param: ParamInfo, index) => [
                    index,
                    {
                        name: param.name,
                        schema: param.schema,
                        required: !param.schema.isOptional()
                    }
                ])
            )
        };
        applyValidation(target, propertyKey, descriptor);
    };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getParameterNames(func: Function): string[] {
    try {
        const fnStr = func.toString();
        const match = fnStr.match(/(?:async\s+)?[\w]+\s*\((.*?)\)/);
        if (!match) return [];

        return match[1].split(',')
            .map(param => param.trim())
            .filter(Boolean)
            .map(param => {
                // Updated regex to handle default values
                const nameMatch = param.match(/^_?([\w]+)(?:\s*=.*?)?(?=\s*(?:,|$|\s*:))/);
                return nameMatch ? nameMatch[1] : '';
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Gets the handler type of a decorated method
 * @param method - The method to check
 * @returns The handler type if decorated, undefined otherwise
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getHandlerType(method: Function | null | undefined): 'resource' | 'prompt' | 'tool' | undefined {
    if (!method) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const metadata = (method as MetadataStorage)[METADATA_SYMBOL];
    if (!metadata) return undefined;
    return metadata.type;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getResourceMetadata(method: Function): Resource | undefined {
    const metadata = method[METADATA_SYMBOL];
    if (!metadata || metadata.type !== 'resource') return undefined;
    return metadata.metadata as Resource;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getPromptMetadata(method: Function): Prompt | undefined {
    const metadata = method[METADATA_SYMBOL];
    if (!metadata || metadata.type !== 'prompt') return undefined;
    return metadata.metadata as Prompt;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getToolMetadata(method: Function): Tool | undefined {
    const metadata = method[METADATA_SYMBOL];
    if (!metadata || metadata.type !== 'tool') return undefined;
    return metadata.metadata as Tool;
}

function validateArgs(args: unknown[], metadata: HandlerMetadata) {
    if (!metadata.parameters) {
        throw new Error(`No parameter metadata found`);
    }

    // Convert args if it's a single object with an arguments property
    let paramValues = args;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        const firstArg = args[0] as any;
        if ('arguments' in firstArg) {
            paramValues = Array.from(metadata.parameters.values()).map(param => {
                return firstArg.arguments?.[param.name];
            });
        }
    }

    for (const [index, paramMetadata] of metadata.parameters.entries()) {
        const value = paramValues[index];
        if (paramMetadata.required && (value === undefined || value === null)) {
            throw new Error(`Parameter ${paramMetadata.name} is required`);
        }

        if (value !== undefined) {
            const result = paramMetadata.schema.safeParse(value);
            if (!result.success) {
                throw new Error(`Parameter '${paramMetadata.name}' validation failed: ${JSON.stringify(result.error.errors)}`);
            }
        }
    }
}
