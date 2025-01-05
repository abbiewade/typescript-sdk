import {z} from 'zod';
import {Prompt, Resource, Tool} from '../types.js';
import {
    getHandlerType,
    getParameterNames,
    getPromptMetadata,
    getResourceMetadata,
    getToolMetadata,
    param,
    prompt,
    resource,
    tool,
} from './decorator.js';

function numberRange(min: number, max: number): ParameterDecorator {
    return param(z.number()
        .min(min, `Value must be at least ${min}`)
        .max(max, `Value cannot exceed ${max}`));
}

function positiveNumber(): ParameterDecorator {
    return param(z.number().positive('Value must be positive'));
}

function nonEmptyString(): ParameterDecorator {
    return param(z.string().min(1, 'String cannot be empty'));
}

class ToolTest {
    @tool({description: 'Simple tool'})
    async simpleTool(
        @param(z.string().min(1)) _input: string
    ): Promise<unknown> {
        return {content: []};
    }

    @tool({
        name: 'custom-tool-name',
        description: 'Tool with custom name'
    })
    async toolWithCustomName(
        @param(z.string().min(1)) _input: string
    ): Promise<unknown> {
        return {content: []};
    }

    @tool({description: 'Tool with complex object validation'})
    async complexObject(
        @param(z.object({
            id: z.number(),
            tags: z.array(z.string()).min(1),
            meta: z.record(z.string(), z.string())
        })) _config: Record<string, unknown>
    ): Promise<unknown> {
        return {content: []};
    }

    @tool()
    async minimalTool(
        @param(z.string()) _input: string
    ): Promise<unknown> {
        return {content: []};
    }

    @tool({description: 'Tool with optional params'})
    async toolWithOptional(
        @param(z.string().min(1)) _required: string,
        @param(z.number().optional()) _optional1?: number,
        @param(z.string().optional().default("default value")) _optional2?: string
    ): Promise<unknown> {
        return {messages: []};
    }

    @tool({description: 'Tool with custom number validation'})
    async numberValidation(
        @positiveNumber() value: number,
        @numberRange(0, 10) weight: number,
        @nonEmptyString() _label: string
    ): Promise<unknown> {
        return {result: value * weight};
    }
}

class PromptTest {
    @prompt({description: 'Test prompt'})
    async testPrompt(
        @param(z.string().min(1)) _name: string
    ): Promise<unknown> {
        return {messages: []};
    }

    @prompt()
    async basicPrompt(
        @param(z.string().min(1)) _name: string
    ): Promise<unknown> {
        return {messages: []};
    }

    @prompt({description: 'Complex object validation'})
    async complexPrompt(
        @param(z.object({
            id: z.number(),
            tags: z.array(z.string()).min(1),
            meta: z.record(z.string(), z.string())
        }))
        _config: Record<string, unknown>
    ): Promise<unknown> {
        return {messages: ['Processed']};
    }

    @prompt({description: 'Custom validation'})
    async customValidationPrompt(
        @positiveNumber() value: number,
        @numberRange(0, 10) weight: number,
        @nonEmptyString() label: string
    ): Promise<unknown> {
        return {messages: [`${label}: ${value * weight}`]};
    }
}

class ResourceTest {
    @resource({
        uri: 'file:///test/example.md',
        name: 'Test Resource',
        description: 'Test resource description',
        mimeType: 'text/markdown'
    })
    async completeResource(): Promise<unknown> {
        return {text: '# Test'};
    }
}

class BaseClass {
    @tool({description: 'Base class tool'})
    async baseTool(
        @param(z.string()) value: string
    ): Promise<{ value: string }> {
        return {value: value.toUpperCase()};
    }
}

class DerivedClass extends BaseClass {
    @tool({description: 'Override of base tool'})
    async baseTool(
        @param(z.string().min(1)) value: string
    ): Promise<{ value: string; modified: boolean }> {
        const result = await super.baseTool(value) as { value: string };
        return {value: result.value, modified: true};
    }
}

describe('Tool Decorator', () => {
    let instance: ToolTest;

    beforeEach(() => {
        instance = new ToolTest();
    });

    test('should handle minimal tool configuration', () => {
        const metadata = getToolMetadata(instance.minimalTool);
        expect(metadata).toBeDefined();
        expect(metadata?.name).toBe('minimalTool');
        expect(metadata?.description).toBeUndefined();
    });

    test('should respect custom tool name', () => {
        const metadata = getToolMetadata(instance.toolWithCustomName);
        expect(metadata?.name).toBe('custom-tool-name');
    });

    test('should handle complex object schema', async () => {
        const metadata = getToolMetadata(instance.complexObject) as Tool;
        expect(metadata).toBeDefined();

        const validInput = {
            id: 123,
            tags: ['test'],
            meta: {key: 'value'}
        };
        expect(instance.complexObject(validInput)).resolves.toBeDefined();

        const invalidInput = {
            id: '123',
            tags: [],
            meta: {key: 123}
        };
        expect(instance.complexObject(invalidInput)).rejects.toThrow();
    });

    test('should handle optional parameters', async () => {
        await expect(instance.toolWithOptional('required', 42, 'custom')).resolves.toBeDefined();
        await expect(instance.toolWithOptional('required')).resolves.toBeDefined();
        await expect(instance.toolWithOptional('')).rejects.toThrow();
    });

    test('should validate parameters correctly', async () => {
        await expect(instance.numberValidation(5, 5, 'test')).resolves.toBeDefined();
        await expect(instance.numberValidation(0, 5, 'test')).rejects.toThrow();
        await expect(instance.numberValidation(5, 11, 'test')).rejects.toThrow();
        await expect(instance.numberValidation(5, 5, '')).rejects.toThrow();
    });


    test('should handle concurrent metadata access', async () => {
        const instance = new ToolTest();
        await Promise.all([
            instance.numberValidation(1, 5, 'test1'),
            instance.numberValidation(2, 5, 'test2'),
            instance.numberValidation(3, 5, 'test3')
        ]);
    });
});

describe('Prompt Decorator', () => {
    let instance: PromptTest;

    beforeEach(() => {
        instance = new PromptTest();
    });

    test('should properly decorate prompt method', () => {
        const metadata = getPromptMetadata(instance.testPrompt) as Prompt;
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe('testPrompt');
        expect(metadata.description).toBe('Test prompt');
        expect(metadata.arguments).toBeDefined();
        expect(metadata.arguments?.length).toBeGreaterThan(0);
        const firstArg = metadata.arguments?.[0];
        expect(firstArg?.required).toBe(true);
    });

    test('should validate parameters', async () => {
        await expect(instance.testPrompt('test')).resolves.toBeDefined();
        await expect(instance.testPrompt('')).rejects.toThrow();
    });

    test('should handle complex object validation', async () => {
        const validInput = {
            id: 123,
            tags: ['test'],
            meta: {key: 'value'}
        };

        await expect(instance.complexPrompt(validInput)).resolves.toBeDefined();

        const invalidInput = {
            id: '123',
            tags: [],
            meta: {key: 123}
        };

        await expect(instance.complexPrompt(invalidInput)).rejects.toThrow();
    });

    test('should support custom validation decorators', async () => {
        await expect(instance.customValidationPrompt(5, 5, 'test'))
            .resolves.toEqual({messages: ['test: 25']});

        await expect(instance.customValidationPrompt(0, 5, 'test'))
            .rejects.toThrow('Value must be positive');

        await expect(instance.customValidationPrompt(5, 11, 'test'))
            .rejects.toThrow('Value cannot exceed 10');

        await expect(instance.customValidationPrompt(5, 5, ''))
            .rejects.toThrow('String cannot be empty');
    });

    test('should properly propagate parameter descriptions in prompts', () => {
        class TestClass {
            @prompt({
                description: 'Test prompt description'
            })
            async testPrompt(
                @param(z.string().min(1)) input1: string,
                @param(z.number()) input2: number
            ): Promise<unknown> {
                return {messages: [`${input1}: ${input2}`]};
            }
        }

        const instance = new TestClass();
        const metadata = getPromptMetadata(instance.testPrompt);

        expect(metadata).toBeDefined();
        expect(metadata?.description).toBe('Test prompt description');
    });
});

describe('Resource Decorator', () => {
    let instance: ResourceTest;

    beforeEach(() => {
        instance = new ResourceTest();
    });

    test('should handle complete resource configuration', () => {
        const metadata = getResourceMetadata(instance.completeResource) as Resource;
        expect(metadata).toEqual({
            uri: 'file:///test/example.md',
            name: 'Test Resource',
            description: 'Test resource description',
            mimeType: 'text/markdown'
        });
    });

    test('should validate resource handler execution', async () => {
        class TestResource {
            @resource({
                uri: 'file:///test.md',
                name: 'Test Resource',
                description: 'Test resource with validation',
                mimeType: 'text/markdown'
            })
            async getData(
                @param(z.string().min(1)) input: string,
                @param(z.number().optional()) count?: number
            ): Promise<unknown> {
                return {
                    text: input,
                    count: count ?? 1
                };
            }
        }

        const instance = new TestResource();

        await expect(instance.getData('valid input')).resolves.toEqual({
            text: 'valid input',
            count: 1
        });

        await expect(instance.getData('valid input', 5)).resolves.toEqual({
            text: 'valid input',
            count: 5
        });

        await expect(instance.getData('')).rejects.toThrow();

        const metadata = getResourceMetadata(instance.getData);
        expect(metadata).toEqual({
            uri: 'file:///test.md',
            name: 'Test Resource',
            description: 'Test resource with validation',
            mimeType: 'text/markdown'
        });
    });
});

describe('Parameter Decorator Composition', () => {
    class CompositionTest {
        @tool({description: 'Tests multiple parameter decorators'})
        async multiDecorator(
            @param(z.string().min(1))
            @param(z.string().max(10))
            value: string
        ): Promise<unknown> {
            return {value};
        }

        @tool({description: 'Tests nested object validation'})
        async nestedValidation(
            @param(z.object({
                outer: z.object({
                    inner: z.string().min(1)
                }).strict()
            }))
            config: { outer: { inner: string } }
        ): Promise<unknown> {
            return {config};
        }
    }

    let instance: CompositionTest;

    beforeEach(() => {
        instance = new CompositionTest();
    });

    test('should properly combine multiple parameter decorators', () => {
        class TestClass {
            @tool()
            async multipleDecorators(
                @param(z.string().min(3))
                @param(z.string().max(10))
                value: string
            ): Promise<unknown> {
                return {value};
            }
        }

        const instance = new TestClass();

        expect(instance.multipleDecorators('test')).resolves.toEqual({value: 'test'});
        expect(instance.multipleDecorators('ab')).rejects.toThrow();
        expect(instance.multipleDecorators('this is too long')).rejects.toThrow();
    });

    test('should handle multiple parameter decorators', async () => {
        await expect(instance.multiDecorator('valid')).resolves.toEqual({value: 'valid'});
        await expect(instance.multiDecorator('')).rejects.toThrow();
        await expect(instance.multiDecorator('this is too long')).rejects.toThrow();
    });

    test('should validate nested objects', async () => {
        await expect(instance.nestedValidation({
            outer: {inner: 'valid'}
        })).resolves.toBeDefined();

        await expect(instance.nestedValidation({
            outer: {inner: ''}
        })).rejects.toThrow();

        await expect(instance.nestedValidation({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            outer: {inner: 'valid', extra: 'property'} as any
        })).rejects.toThrow();
    });
});

test('should handle inheritance correctly', async () => {
    const baseInstance = new BaseClass();
    const derivedInstance = new DerivedClass();

    await expect(baseInstance.baseTool('')).resolves.toEqual({value: ''});
    await expect(derivedInstance.baseTool('')).rejects.toThrow();
    await expect(derivedInstance.baseTool('valid')).resolves.toEqual({
        value: 'VALID',
        modified: true
    });
});

test('should handle parallel execution', async () => {
    const instance = new PromptTest();
    const validCalls = [
        instance.customValidationPrompt(5, 5, 'test1'),
        instance.customValidationPrompt(1, 1, 'test2'),
        instance.customValidationPrompt(10, 10, 'test3')
    ];

    await expect(Promise.all(validCalls)).resolves.toBeDefined();

    const invalidCalls = Promise.all([
        instance.customValidationPrompt(-1, 5, 'test'),
        instance.customValidationPrompt(5, 15, 'test'),
        instance.customValidationPrompt(5, 5, '')
    ]);

    await expect(invalidCalls).rejects.toThrow();
});

test('should correctly identify all handler types', () => {
    const toolInstance = new ToolTest();
    const promptInstance = new PromptTest();
    const resourceInstance = new ResourceTest();

    expect(getHandlerType(toolInstance.simpleTool)).toBe('tool');
    expect(getHandlerType(promptInstance.basicPrompt)).toBe('prompt');
    expect(getHandlerType(resourceInstance.completeResource)).toBe('resource');
});

test('should handle non-decorated methods', () => {
    class Plain {
        method(): void {
        }
    }

    const plain = new Plain();
    expect(getHandlerType(plain.method)).toBeUndefined();
});

test('should handle edge cases in type detection', () => {
    class TestClass {
        @tool()
        methodWithMetadata(
            @param(z.string()) input: string
        ): void {
            console.log(input);
        }

        normalMethod(): void {
            // No decorator
        }
    }

    const instance = new TestClass();

    expect(getHandlerType(instance.normalMethod)).toBeUndefined();
    expect(getHandlerType(instance.methodWithMetadata)).toBe('tool');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getHandlerType(null as any)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getHandlerType(undefined as any)).toBeUndefined();
});

test('should validate parameters correctly', async () => {
    const instance = new ToolTest();
    await expect(instance.numberValidation(5, 5, 'test')).resolves.toEqual({result: 25});
    await expect(instance.numberValidation(0, 5, 'test'))
        .rejects
        .toThrow('Value must be positive');
    await expect(instance.numberValidation(5, 11, 'test'))
        .rejects
        .toThrow('Value cannot exceed 10');
    await expect(instance.numberValidation(5, 5, ''))
        .rejects
        .toThrow('String cannot be empty');
});

test('should handle parallel execution correctly', async () => {
    const instance = new ToolTest();
    const validCalls = [
        instance.numberValidation(5, 5, 'test1'),
        instance.numberValidation(1, 1, 'test2'),
        instance.numberValidation(10, 10, 'test3')
    ];

    const results = await Promise.all(validCalls);
    expect(results).toEqual([
        {result: 25},
        {result: 1},
        {result: 100}
    ]);

    const invalidCalls = Promise.all([
        instance.numberValidation(-1, 5, 'test'),
        instance.numberValidation(5, 15, 'test'),
        instance.numberValidation(5, 5, '')
    ]);

    await expect(invalidCalls).rejects.toThrow();
});

test('should throw on invalid parameter types', async () => {
    const instance = new ToolTest();
    // @ts-expect-error Testing runtime type checking
    await expect(instance.simpleTool(123)).rejects.toThrow();
    // @ts-expect-error Testing runtime type checking
    await expect(instance.numberValidation('not a number', 5, 'test')).rejects.toThrow();
});

test('should throw on missing required parameters', async () => {
    const instance = new ToolTest();
    // @ts-expect-error Testing missing parameters
    await expect(instance.simpleTool()).rejects.toThrow();
    // @ts-expect-error Testing missing parameters
    await expect(instance.numberValidation(5, 5)).rejects.toThrow();
});

test('should extract parameter names for tool schema', () => {
    class TestTool {
        @tool()
        async process(
            @param(z.number()) aNumber: number,
            @param(z.string()) _aString: string
        ) {
            return {result: aNumber};
        }
    }

    const instance = new TestTool();
    const metadata = getToolMetadata(instance.process);
    const properties = metadata?.inputSchema.properties;

    expect(properties).toBeDefined();
    const paramNames = Object.keys(properties!);
    expect(paramNames).toEqual(['aNumber', 'aString']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aValueSchema = (properties as any)['aNumber'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bLabelSchema = (properties as any)['aString'];

    expect(aValueSchema._def.typeName).toBe('ZodNumber');
    expect(bLabelSchema._def.typeName).toBe('ZodString');
});

test('should maintain separate metadata for each method', () => {
    class IsolationTest {
        @tool({description: 'First tool'})
        async firstTool(
            @param(z.string()) value: string
        ): Promise<unknown> {
            return {value};
        }

        @tool({description: 'Second tool'})
        async secondTool(
            @param(z.number()) value: number
        ): Promise<unknown> {
            return {value};
        }
    }

    const instance = new IsolationTest();

    const firstMetadata = getToolMetadata(instance.firstTool);
    const secondMetadata = getToolMetadata(instance.secondTool);

    expect(firstMetadata?.inputSchema?.properties).toBeDefined();
    expect(secondMetadata?.inputSchema?.properties).toBeDefined();

    if (!firstMetadata?.inputSchema?.properties || !secondMetadata?.inputSchema?.properties) {
        fail('Metadata properties should be defined');
    }

    const firstParam = firstMetadata.inputSchema.properties['value'] as z.ZodString;
    const secondParam = secondMetadata.inputSchema.properties['value'] as z.ZodNumber;

    expect(firstParam._def.typeName).toBe('ZodString');
    expect(secondParam._def.typeName).toBe('ZodNumber');
});

test('should throw when decorating getters', () => {
    expect(() => {
        class TestClass {
        }

        const descriptor = {
            configurable: true,
            enumerable: true,
            get: () => true,
            set: undefined
        };

        tool()(TestClass.prototype, 'computed', descriptor);
    }).toThrow();
});

test('should throw when decorating non-methods', () => {
    expect(() => {
        class TestClass {
        }

        const descriptor = {
            configurable: true,
            enumerable: true,
            value: "not a function",
            writable: true
        };

        tool()(TestClass.prototype, 'notAMethod', descriptor);
    }).toThrow();
});

test('should handle empty parameter lists', () => {
    function noParams() {
    }

    expect(getParameterNames(noParams)).toEqual([]);
});

test('should handle async functions', () => {
    async function asyncFn(_a: string, _b: number) {
    }

    expect(getParameterNames(asyncFn)).toEqual(['a', 'b']);
});

test('should handle parameters with default values', () => {
    function defaultParams(_a = 'default', _b = 123) {
    }

    expect(getParameterNames(defaultParams)).toEqual(['a', 'b']);
});

test('should return empty array on parsing failure', () => {
    const malformedFunction = {toString: () => 'not a function'};
    expect(getParameterNames(malformedFunction as Function)).toEqual([]);
});


