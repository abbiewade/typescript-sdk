import {
  CallToolResult,
  GetPromptResult, Prompt,
  ReadResourceResult, Resource, Tool
} from "../types.js";

interface RegistryItem<TMeta, TResult> {
  metadata: TMeta;
  handler: (params: any) => Promise<TResult>;
}

/**
 * Base registry implementation for MCP capabilities.
 * Provides common functionality for storing and retrieving items with metadata.
 *
 * @template TMeta - Type of metadata stored with each item
 * @template TParams - Type of parameters accepted by handlers
 * @template TResult - Type of results returned by handlers
 *
 * @example
 * class CustomRegistry extends BaseRegistry<CustomMeta, CustomParams, CustomResult> {
 *   // Additional custom implementation
 * }
 */
export class BaseRegistry<TMeta, TParams, TResult> {
  /**
   * Internal storage for registry items
   * @internal
   */
  protected items = new Map<string, RegistryItem<TMeta, TResult>>();

  /**
   * Adds a new item to the registry
   * @param key - Unique identifier for the item
   * @param metadata - Metadata associated with the item
   * @param handler - Function to handle item execution
   * @throws {Error} If key already exists or metadata/handler are invalid
   */
  add(key: string, metadata: TMeta, handler: (params: TParams) => Promise<TResult>): void {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }

    if (!metadata || typeof metadata !== 'object') {
      throw new Error('Metadata must be a valid object');
    }

    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    this.items.set(key, { metadata, handler });
  }

  /**
   * Gets a registry item by its key.
   * @param key - Unique identifier for the item
   * @returns The registry item if found, undefined otherwise
   * @example
   * const item = registry.get('my-tool');
   * if (item) {
   *   const result = await item.handler(params);
   * }
   */
  get(key: string): RegistryItem<TMeta, TResult> | undefined {
    return this.items.get(key);
  }

  /**
   * Retrieves metadata for all items in the registry.
   * @returns Array of metadata objects for all registered items
   * @example
   * const allTools = registry.getAllMetadata();
   * console.log(`Registry contains ${allTools.length} items`);
   */
  getAllMetadata(): TMeta[] {
    return Array.from(this.items.values()).map(item => item.metadata);
  }
}

/**
 * Registry for MCP resources.
 * Handles storage and retrieval of resources with their associated metadata and content handlers.
 *
 * @implements {BaseRegistry<Resource, {uri: string}, ReadResourceResult>}
 *
 * @example
 * const registry = new ResourceRegistry();
 * registry.add('file:///example.txt', {
 *   uri: 'file:///example.txt',
 *   name: 'Example File',
 *   mimeType: 'text/plain'
 * }, async () => ({
 *   contents: [{type: 'text', text: 'Hello World'}]
 * }));
 */
export class ResourceRegistry extends BaseRegistry<
    Resource,
    { uri: string },
    ReadResourceResult
> {
  add(key: string, metadata: Resource, handler: (params: { uri: string }) => Promise<ReadResourceResult>): void {
    if (!metadata.uri) {
      throw new Error('Resource must have a valid URI');
    }

    try {
      new URL(metadata.uri);
    } catch (e) {
      throw new Error('Resource must have a valid URI format');
    }

    super.add(key, metadata, handler);
  }
}

/**
 * Specialized registry for MCP prompts.
 * Manages prompt templates and their execution handlers.
 * @extends BaseRegistry<Prompt, {name: string; arguments?: unknown}, GetPromptResult>
 *
 * @example
 * const promptRegistry = new PromptRegistry();
 * promptRegistry.add('greeting', {
 *   name: 'greeting',
 *   description: 'Generates a personalized greeting',
 *   arguments: [{
 *     name: 'name',
 *     type: 'string',
 *     required: true
 *   }]
 * }, async (params) => ({
 *   messages: [{
 *     role: 'assistant',
 *     content: { type: 'text', text: `Hello ${params.arguments.name}!` }
 *   }]
 * }));
 */
export class PromptRegistry extends BaseRegistry<
    Prompt,
    { name: string; arguments?: Record<string, unknown> },
    GetPromptResult
> {
  add(
      key: string,
      metadata: Prompt,
      handler: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<GetPromptResult>
  ): void {
    // Validate prompt-specific requirements
    if (!metadata.name) {
      throw new Error('Prompt must have a name');
    }

    if (metadata.arguments) {
      if (!Array.isArray(metadata.arguments)) {
        throw new Error('Prompt arguments must be an array');
      }

      metadata.arguments.forEach((arg, index) => {
        if (!arg.name) {
          throw new Error(`Prompt argument at index ${index} must have a name`);
        }

        const validTypes = ['string', 'number', 'boolean', 'object', 'array'] as const;
        type ValidType = typeof validTypes[number];

        if (!arg.type || !validTypes.includes(arg.type as ValidType)) {
          throw new Error(`Invalid type "${arg.type}" for prompt argument "${arg.name}". Must be one of: ${validTypes.join(', ')}`);
        }
      });
    }

    super.add(key, metadata, handler);
  }
}

/**
 * Specialized registry for MCP tools.
 * Handles storage and execution of tool definitions with their associated handlers.
 * @extends BaseRegistry<Tool, {name: string; arguments?: unknown}, CallToolResult>
 *
 * @example
 * const toolRegistry = new ToolRegistry();
 * toolRegistry.add('calculator', {
 *   name: 'calculator',
 *   description: 'Performs basic math',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       a: { type: 'number' },
 *       b: { type: 'number' }
 *     }
 *   }
 * }, async (params) => ({
 *   content: [{ type: 'text', text: `Result: ${params.a + params.b}` }]
 * }));
 */
export class ToolRegistry extends BaseRegistry<Tool, { name: string; arguments?: unknown }, CallToolResult> {
  add(key: string, metadata: Tool, handler: (params: { name: string; arguments?: unknown }) => Promise<CallToolResult>): void {
    // Validate tool-specific requirements
    if (!metadata.name) {
      throw new Error('Tool must have a name');
    }

    if (!metadata.inputSchema) {
      throw new Error('Tool must have an input schema');
    }

    // Validate input schema structure
    if (!metadata.inputSchema.type || metadata.inputSchema.type !== 'object') {
      throw new Error('Tool input schema must be of type "object"');
    }

    if (!metadata.inputSchema.properties || typeof metadata.inputSchema.properties !== 'object') {
      throw new Error('Tool input schema must have properties defined');
    }

    // Validate that all required properties exist in properties
    if (metadata.inputSchema.required) {
      if (!Array.isArray(metadata.inputSchema.required)) {
        throw new Error('Tool input schema required must be an array');
      }

      const properties = metadata.inputSchema.properties as Record<string, unknown>;

      metadata.inputSchema.required.forEach(prop => {
        if (!(prop in properties)) {
          throw new Error(`Required property "${prop}" not found in input schema properties`);
        }
      });
    }

    super.add(key, metadata, handler);
  }
}
