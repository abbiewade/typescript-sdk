import {ResourceRegistry, PromptRegistry, ToolRegistry, BaseRegistry} from './registry.js';
import { Tool, Resource, Prompt, CallToolResult, GetPromptResult, ReadResourceResult } from '../types.js';

// Test the base registry functionality using a simple implementation
describe('BaseRegistry', () => {
    // Create a simple concrete implementation for testing base functionality
    interface TestMetadata {
        name: string;
        description: string;
    }

    interface TestParams {
        id: string;
    }

    interface TestResult {
        value: string;
    }

    class TestRegistry extends BaseRegistry<TestMetadata, TestParams, TestResult> {}

    let registry: TestRegistry;

    beforeEach(() => {
        registry = new TestRegistry();
    });

    test('should add and retrieve items', () => {
        const metadata: TestMetadata = {
            name: 'test',
            description: 'test description'
        };

        const handler = async (params: TestParams) => ({ value: params.id });

        registry.add('test-key', metadata, handler);

        const item = registry.get('test-key');
        expect(item).toBeDefined();
        expect(item?.metadata).toEqual(metadata);
    });

    test('should return all metadata', () => {
        const items = [
            { name: 'item1', description: 'desc1' },
            { name: 'item2', description: 'desc2' }
        ];

        items.forEach((metadata, i) => {
            registry.add(`key${i}`, metadata, async () => ({ value: 'test' }));
        });

        const allMetadata = registry.getAllMetadata();
        expect(allMetadata).toHaveLength(2);
        expect(allMetadata).toEqual(expect.arrayContaining(items));
    });

    test('should execute handler with params', async () => {
        const handler = async (params: TestParams) => ({ value: `processed-${params.id}` });

        registry.add('test', { name: 'test', description: 'test' }, handler);

        const item = registry.get('test');
        const result = await item?.handler({ id: '123' });

        expect(result).toEqual({ value: 'processed-123' });
    });

    test('should handle adding duplicate items', () => {
        const registry = new TestRegistry();
        const originalMetadata: TestMetadata = {
            name: 'test',
            description: 'original description'
        };
        const originalHandler = async (_params: TestParams) => ({ value: 'original' });

        const newMetadata: TestMetadata = {
            name: 'test',
            description: 'new description'
        };
        const newHandler = async (_params: TestParams) => ({ value: 'new' });

        registry.add('key', originalMetadata, originalHandler);
        registry.add('key', newMetadata, newHandler);

        const item = registry.get('key');
        expect(item?.metadata).toEqual(newMetadata); // Should override with new values
    });

    test('should handle invalid metadata', () => {
        const registry = new TestRegistry();
        const invalidMetadata = null;
        const handler = async (_params: TestParams) => ({ value: 'test' });

        expect(() =>
            registry.add('key', invalidMetadata as any, handler)
        ).toThrow();
    });

    test('should handle concurrent access', async () => {
        const registry = new TestRegistry();
        const testMetadata: TestMetadata = {
            name: 'test',
            description: 'test'
        };

        const handler1 = async (_params: TestParams) => ({ value: 'test1' });
        const handler2 = async (_params: TestParams) => ({ value: 'test2' });

        await Promise.all([
            registry.add('key1', testMetadata, handler1),
            registry.add('key2', testMetadata, handler2),
            registry.get('key1'),
            registry.get('key2')
        ]);

        // Verify both items were added successfully
        expect(registry.get('key1')).toBeDefined();
        expect(registry.get('key2')).toBeDefined();
    });
});

describe('ResourceRegistry', () => {
    let registry: ResourceRegistry;

    beforeEach(() => {
        registry = new ResourceRegistry();
    });

    test('should add and retrieve resources', () => {
        const resourceMetadata: Resource = {
            uri: 'test://resource',
            name: 'Test Resource',
            description: 'Test Description',
            mimeType: 'text/plain'
        };

        const handler = async () => ({
            contents: [{
                type: 'text',
                text: 'test content',
                uri: 'test://resource'
            }]
        } as ReadResourceResult);

        registry.add('test://resource', resourceMetadata, handler);

        const item = registry.get('test://resource');
        expect(item).toBeDefined();
        expect(item?.metadata).toEqual(resourceMetadata);
    });

    test('should return all registered resource metadata', () => {
        const resources: Resource[] = [
            {
                uri: 'test://resource1',
                name: 'Resource 1',
                description: 'Description 1',
                mimeType: 'text/plain'
            },
            {
                uri: 'test://resource2',
                name: 'Resource 2',
                description: 'Description 2',
                mimeType: 'text/markdown'
            }
        ];

        resources.forEach(resource => {
            registry.add(
                resource.uri,
                resource,
                async () => ({
                    contents: [{
                        type: 'text',
                        text: 'content',
                        uri: resource.uri
                    }]
                })
            );
        });

        const allMetadata = registry.getAllMetadata();
        expect(allMetadata).toHaveLength(2);
        expect(allMetadata).toEqual(expect.arrayContaining(resources));
    });

    test('should execute resource handler', async () => {
        const handler = async () => ({
            contents: [{
                type: 'text',
                text: 'test content',
                uri: 'test://resource'
            }]
        }) as ReadResourceResult;

        registry.add('test://resource', {
            uri: 'test://resource',
            name: 'Test',
            description: 'Test',
            mimeType: 'text/plain'
        }, handler);

        const item = registry.get('test://resource');
        const result = await item?.handler({ uri: 'test://resource' });

        expect(result?.contents[0].text).toBe('test content');
    });

    test('should validate resource URIs', () => {
        const registry = new ResourceRegistry();
        const testMetadata: Resource = {
            uri: 'invalid-uri',
            name: 'Test Resource'
        };
        const handler = async (params: { uri: string }) => ({
            contents: [{
                type: 'text' as const,
                text: 'test',
                uri: params.uri
            }]
        });

        expect(() =>
            registry.add('invalid-uri', testMetadata, handler)
        ).toThrow();
    });

    test('should handle binary resources', async () => {
        const registry = new ResourceRegistry();
        const testMetadata: Resource = {
            uri: 'binary://test',
            name: 'Binary Resource',
            mimeType: 'application/octet-stream'
        };

        const binaryHandler = async (params: { uri: string }): Promise<ReadResourceResult> => ({
            contents: [{
                type: 'blob' as const,
                uri: params.uri,
                blob: Buffer.from('test').toString('base64'), // Use 'blob' instead of 'data'
                mimeType: 'application/octet-stream'
            }]
        });

        registry.add('binary://test', testMetadata, binaryHandler);
        const result = await registry.get('binary://test')?.handler({ uri: 'binary://test' });
        expect(result).toBeDefined();
        expect(result?.contents[0].type).toBe('blob');
    });
});

describe('PromptRegistry', () => {
    let registry: PromptRegistry;

    beforeEach(() => {
        registry = new PromptRegistry();
    });

    test('should add and retrieve prompts', () => {
        const promptMetadata: Prompt = {
            name: 'testPrompt',
            description: 'Test Prompt',
            arguments: [{
                name: 'input',
                type: 'string', // Changed from schema to type
                required: true
            }]
        };

        const handler = async () => ({
            messages: [{
                role: 'assistant',
                content: {
                    type: 'text',
                    text: 'test response'
                }
            }]
        }) as GetPromptResult;

        registry.add('testPrompt', promptMetadata, handler);

        const item = registry.get('testPrompt');
        expect(item).toBeDefined();
        expect(item?.metadata).toEqual(promptMetadata);
    });

    test('should execute prompt handler', async () => {
        const handler = async () => ({
            messages: [{
                role: 'assistant' as const,
                content: {
                    type: 'text' as const,
                    text: 'test response'
                }
            }]
        }) as GetPromptResult;

        registry.add('testPrompt', {
            name: 'testPrompt',
            description: 'Test',
            arguments: []
        }, handler);

        const item = registry.get('testPrompt');
        const result = await item?.handler({ name: 'testPrompt' });

        expect(result?.messages[0].content.text).toBe('test response');
    });

    test('should validate prompt arguments schema', () => {
        const registry = new PromptRegistry();
        const invalidSchema = {
            arguments: [{ type: 'invalid' }]
        };
        const testHandler = async (_params: { name: string; arguments?: unknown }): Promise<GetPromptResult> => ({
            messages: [{
                role: 'assistant' as const,  // Must be strictly typed as "user" | "assistant"
                content: {
                    type: 'text' as const,  // Must be strictly typed
                    text: 'test'
                }
            }]
        });

        expect(() =>
            registry.add('test', invalidSchema as any, testHandler)
        ).toThrow();
    });

    test('should reject prompt without name', () => {
        const invalidPrompt = {} as Prompt;
        expect(() =>
            registry.add('test', invalidPrompt, async () => ({ messages: [] }))
        ).toThrow('Prompt must have a name');
    });

    test('should validate argument types', () => {
        const invalidPrompt: Prompt = {
            name: 'test',
            arguments: [{
                name: 'test',
                type: 'invalid' as any,
                required: true
            }]
        };

        expect(() =>
            registry.add('test', invalidPrompt, async () => ({ messages: [] }))
        ).toThrow('Invalid type "invalid" for prompt argument "test"');
    });

    test('should validate argument names', () => {
        const invalidPrompt: Prompt = {
            name: 'test',
            arguments: [{
                name: '',  // Empty name should fail
                type: 'string',  // Provide a valid type
                required: true
            }]
        };

        expect(() =>
            registry.add('test', invalidPrompt, async () => ({ messages: [] }))
        ).toThrow('Prompt argument at index 0 must have a name');
    });
});

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    test('should add and retrieve tools', () => {
        const toolMetadata: Tool = {
            name: 'testTool',
            description: 'Test Tool',
            inputSchema: {
                type: 'object',
                properties: {
                    input: { type: 'string' }
                }
            }
        };

        const handler = async () => ({
            content: [{
                type: 'text' as const,
                text: 'result'
            }]
        }) as CallToolResult;

        registry.add('testTool', toolMetadata, handler);

        const item = registry.get('testTool');
        expect(item).toBeDefined();
        expect(item?.metadata).toEqual(toolMetadata);
    });

    test('should execute tool handler', async () => {
        const handler = async () => ({
            content: [{
                type: 'text' as const,
                text: 'test result'
            }]
        }) as CallToolResult;

        registry.add('testTool', {
            name: 'testTool',
            description: 'Test',
            inputSchema: { type: 'object', properties: {} }
        }, handler);

        const item = registry.get('testTool');
        const result = await item?.handler({ name: 'testTool' });

        expect(result?.content[0].text).toBe('test result');
    });

    test('should reject tool without name', () => {
        const invalidTool = {} as Tool;
        expect(() =>
            registry.add('test', invalidTool, async () => ({ content: [] }))
        ).toThrow('Tool must have a name');
    });

    test('should validate input schema', () => {
        const invalidTool: Tool = {
            name: 'test',
            inputSchema: {} as any
        };

        expect(() =>
            registry.add('test', invalidTool, async () => ({ content: [] }))
        ).toThrow('Tool input schema must be of type "object"');
    });

    test('should validate required properties exist', () => {
        const invalidTool: Tool = {
            name: 'test',
            inputSchema: {
                type: 'object',
                properties: {},
                required: ['nonexistent']
            }
        };

        expect(() =>
            registry.add('test', invalidTool, async () => ({ content: [] }))
        ).toThrow('Required property "nonexistent" not found in input schema properties');
    });
});