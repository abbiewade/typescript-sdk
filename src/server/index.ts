import {
  Protocol,
  ProtocolOptions,
  RequestHandlerExtra,
  RequestOptions,
} from "../shared/protocol.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ClientCapabilities,
  CreateMessageRequest,
  CreateMessageResultSchema,
  EmptyResultSchema,
  ErrorCode,
  GetPromptRequestSchema,
  GetPromptResult,
  Implementation,
  InitializedNotificationSchema,
  InitializeRequest,
  InitializeRequestSchema,
  InitializeResult,
  LATEST_PROTOCOL_VERSION,
  ListPromptsRequestSchema,
  ListPromptsResult,
  ListResourcesRequestSchema,
  ListResourcesResult,
  ListRootsRequest,
  ListRootsResultSchema,
  ListToolsRequestSchema,
  ListToolsResult,
  LoggingMessageNotification,
  McpError,
  Notification,
  ReadResourceRequestSchema,
  ReadResourceResult,
  Request,
  ResourceUpdatedNotification,
  Result,
  ServerCapabilities,
  ServerNotification,
  ServerRequest,
  ServerResult,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../types.js";
import { getHandlerType, getPromptMetadata, getResourceMetadata, getToolMetadata } from "./decorator.js";
import { z, ZodLiteral, ZodObject } from "zod";
import { PromptRegistry, ResourceRegistry, ToolRegistry } from "./registry.js";

export type ServerOptions = ProtocolOptions & {
  /**
   * Capabilities to advertise as being supported by this server.
   */
  capabilities: ServerCapabilities;
};

/**
 * Represents any class constructor
 * @template T The type of instance the constructor creates
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Constructor<T = any> { new (...args: any[]): T; }

/**
 * An MCP server on top of a pluggable transport.
 *
 * This server will automatically respond to the initialization flow as initiated from the client.
 *
 * To use with custom types, extend the base Request/Notification/Result types and pass them as type parameters:
 *
 * ```typescript
 * // Custom schemas
 * const CustomRequestSchema = RequestSchema.extend({...})
 * const CustomNotificationSchema = NotificationSchema.extend({...})
 * const CustomResultSchema = ResultSchema.extend({...})
 *
 * // Type aliases
 * type CustomRequest = z.infer<typeof CustomRequestSchema>
 * type CustomNotification = z.infer<typeof CustomNotificationSchema>
 * type CustomResult = z.infer<typeof CustomResultSchema>
 *
 * // Create typed server
 * const server = new Server<CustomRequest, CustomNotification, CustomResult>({
 *   name: "CustomServer",
 *   version: "1.0.0"
 * })
 * ```
 */
export class Server<
  RequestT extends Request = Request,
  NotificationT extends Notification = Notification,
  ResultT extends Result = Result,
> extends Protocol<
  ServerRequest | RequestT,
  ServerNotification | NotificationT,
  ServerResult | ResultT
> {
  private _clientCapabilities?: ClientCapabilities;
  private _clientVersion?: Implementation;
  private _capabilities: ServerCapabilities;

  private readonly _toolRegistry : ToolRegistry;
  private readonly _promptRegistry: PromptRegistry;
  private readonly _resourceRegistry: ResourceRegistry;

  /**
   * Callback for when initialization has fully completed (i.e., the client has sent an `initialized` notification).
   */
  oninitialized?: () => void;

  /**
   * Initializes this server with the given name and version information.
   */
  constructor(
    private _serverInfo: Implementation,
    options: ServerOptions,
  ) {
    super(options);
    this._capabilities = options.capabilities;

    this.setRequestHandler(InitializeRequestSchema, (request) =>
      this._oninitialize(request),
    );
    this.setNotificationHandler(InitializedNotificationSchema, () =>
      this.oninitialized?.(),
    );

    this._toolRegistry = new ToolRegistry()
    this._promptRegistry = new PromptRegistry();
    this. _resourceRegistry = new ResourceRegistry();
    this._initializeDefaultHandlers();
  }

  private _initializeDefaultHandlers(): void {
    if (this._capabilities.resources) {
      this.setRequestHandler(ListResourcesRequestSchema, async () => {
        const result: ListResourcesResult = {
          resources: this._resourceRegistry.getAllMetadata()
        };
        return result as ListResourcesResult & ResultT;  // Changed here
      });

      this.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const item = this._resourceRegistry.get(request.params.uri);
        if (!item) {
          throw new McpError(
              ErrorCode.InvalidRequest,
              `Resource not found: ${request.params.uri}`
          );
        }
        const result = await item.handler(request.params);
        return result as ReadResourceResult & ResultT;
      });
    }

    if (this._capabilities.prompts) {
      this.setRequestHandler(ListPromptsRequestSchema, async () => {
        const result: ListPromptsResult = {
          prompts: this._promptRegistry.getAllMetadata()
        };
        return result as ListPromptsResult & ResultT;
      });

      this.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const item = this._promptRegistry.get(request.params.name);
        if (!item) {
          throw new McpError(
              ErrorCode.InvalidRequest,
              `Prompt not found: ${request.params.name}`
          );
        }
          const result = await item.handler(request.params);
          return result as GetPromptResult & ResultT;
      });
    }

    if (this._capabilities.tools) {
      this.setRequestHandler(ListToolsRequestSchema, async () => {
        const result: ListToolsResult = {
          tools: this._toolRegistry.getAllMetadata()
        };
        return result as ListToolsResult & ResultT;
      });

      this.setRequestHandler(CallToolRequestSchema, async (request) => {
        const item = this._toolRegistry.get(request.params.name);
        if (!item) {
          throw new McpError(
              ErrorCode.InvalidRequest,
              `Tool not found: ${request.params.name}`
          );
        }
        const result = await item.handler(request.params);
        return result as CallToolResult & ResultT;
      });
    }
}

  protected assertCapabilityForMethod(method: RequestT["method"]): void {
    switch (method as ServerRequest["method"]) {
      case "sampling/createMessage":
        if (!this._clientCapabilities?.sampling) {
          throw new Error(
            `Client does not support sampling (required for ${method})`,
          );
        }
        break;

      case "roots/list":
        if (!this._clientCapabilities?.roots) {
          throw new Error(
            `Client does not support listing roots (required for ${method})`,
          );
        }
        break;

      case "ping":
        // No specific capability required for ping
        break;
    }
  }

  protected assertNotificationCapability(
    method: (ServerNotification | NotificationT)["method"],
  ): void {
    switch (method as ServerNotification["method"]) {
      case "notifications/message":
        if (!this._capabilities.logging) {
          throw new Error(
            `Server does not support logging (required for ${method})`,
          );
        }
        break;

      case "notifications/resources/updated":
      case "notifications/resources/list_changed":
        if (!this._capabilities.resources) {
          throw new Error(
            `Server does not support notifying about resources (required for ${method})`,
          );
        }
        break;

      case "notifications/tools/list_changed":
        if (!this._capabilities.tools) {
          throw new Error(
            `Server does not support notifying of tool list changes (required for ${method})`,
          );
        }
        break;

      case "notifications/prompts/list_changed":
        if (!this._capabilities.prompts) {
          throw new Error(
            `Server does not support notifying of prompt list changes (required for ${method})`,
          );
        }
        break;

      case "notifications/cancelled":
        // Cancellation notifications are always allowed
        break;

      case "notifications/progress":
        // Progress notifications are always allowed
        break;
    }
  }

  protected assertRequestHandlerCapability(method: string): void {
    switch (method) {
      case "sampling/createMessage":
        if (!this._capabilities.sampling) {
          throw new Error(
            `Server does not support sampling (required for ${method})`,
          );
        }
        break;

      case "logging/setLevel":
        if (!this._capabilities.logging) {
          throw new Error(
            `Server does not support logging (required for ${method})`,
          );
        }
        break;

      case "prompts/get":
      case "prompts/list":
        if (!this._capabilities.prompts) {
          throw new Error(
            `Server does not support prompts (required for ${method})`,
          );
        }
        break;

      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
        if (!this._capabilities.resources) {
          throw new Error(
            `Server does not support resources (required for ${method})`,
          );
        }
        break;

      case "tools/call":
      case "tools/list":
        if (!this._capabilities.tools) {
          throw new Error(
            `Server does not support tools (required for ${method})`,
          );
        }
        break;

      case "ping":
      case "initialize":
        // No specific capability required for these methods
        break;
    }
  }

  private async _oninitialize(
      request: InitializeRequest,
  ): Promise<InitializeResult & ResultT> {
    const requestedVersion = request.params.protocolVersion;

    this._clientCapabilities = request.params.capabilities;
    this._clientVersion = request.params.clientInfo;

    const result: InitializeResult = {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
          ? requestedVersion
          : LATEST_PROTOCOL_VERSION,
      capabilities: this.getCapabilities(),
      serverInfo: this._serverInfo,
    };

    // Since we know InitializeResult extends Result, this assertion is safe
    return result as InitializeResult & ResultT;
  }

  /**
   * After initialization has completed, this will be populated with the client's reported capabilities.
   */
  getClientCapabilities(): ClientCapabilities | undefined {
    return this._clientCapabilities;
  }

  /**
   * After initialization has completed, this will be populated with information about the client's name and version.
   */
  getClientVersion(): Implementation | undefined {
    return this._clientVersion;
  }

  private getCapabilities(): ServerCapabilities {
    return this._capabilities;
  }

  async ping() {
    return this.request({ method: "ping" }, EmptyResultSchema);
  }

  async createMessage(
    params: CreateMessageRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      { method: "sampling/createMessage", params },
      CreateMessageResultSchema,
      options,
    );
  }

  async listRoots(
    params?: ListRootsRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      { method: "roots/list", params },
      ListRootsResultSchema,
      options,
    );
  }

  async sendLoggingMessage(params: LoggingMessageNotification["params"]) {
    return this.notification({ method: "notifications/message", params });
  }

  async sendResourceUpdated(params: ResourceUpdatedNotification["params"]) {
    return this.notification({
      method: "notifications/resources/updated",
      params,
    });
  }

  async sendResourceListChanged() {
    return this.notification({
      method: "notifications/resources/list_changed",
    });
  }

  async sendToolListChanged() {
    return this.notification({ method: "notifications/tools/list_changed" });
  }

  async sendPromptListChanged() {
    return this.notification({ method: "notifications/prompts/list_changed" });
  }

  /**
   * Sets a handler for a specific request type.
   *
   * @template T - Schema type for the request
   * @param requestSchema - Zod schema defining the request format
   * @param handler - Function to handle the request
   * @throws {Error} If handler already exists for this schema
   * @throws {Error} If schema is invalid
   * @throws {Error} If required capability is not enabled
   *
   * @example
   * server.setRequestHandler(ListToolsRequestSchema, async (request) => ({
   *   tools: [{
   *     name: 'example',
   *     description: 'An example tool'
   *   }]
   * }));
   */
  setRequestHandler<T extends ZodObject<{
    method: ZodLiteral<string>;
  }>>(
      requestSchema: T,
      handler: (
          request: z.infer<T>,
          extra: RequestHandlerExtra,
      ) => ResultT | Promise<ResultT>,
  ): void {
    const originalHandler = handler;
    const method = requestSchema.shape.method.value;

    let wrappedHandler: typeof handler = handler;

    switch (method) {
      case 'resources/list': {
        wrappedHandler = async (request, extra) => {
          const baseResult = await originalHandler(request, extra) as unknown as ListResourcesResult;
          const registryResources = this._resourceRegistry.getAllMetadata();

          const existingUris = new Set(baseResult?.resources?.map(r => r.uri) || []);
          const newResources = registryResources.filter(r => !existingUris.has(r.uri));

          const result: ListResourcesResult = {
            resources: [
              ...(baseResult?.resources || []),
              ...newResources
            ]
          };
          return result as unknown as ResultT;
        };
        break;
      }

      case 'prompts/list': {
        wrappedHandler = async (request, extra) => {
          const baseResult = await originalHandler(request, extra) as unknown as ListPromptsResult;
          const registryPrompts = this._promptRegistry.getAllMetadata();

          const existingNames = new Set(baseResult?.prompts?.map(p => p.name) || []);
          const newPrompts = registryPrompts.filter(p => !existingNames.has(p.name));

          const result: ListPromptsResult = {
            prompts: [
              ...(baseResult?.prompts || []),
              ...newPrompts
            ]
          };
          return result as unknown as ResultT;
        };
        break;
      }

      case 'tools/list': {
        wrappedHandler = async (request, extra) => {
          const baseResult = await originalHandler(request, extra) as unknown as ListToolsResult;
          const registryTools = this._toolRegistry.getAllMetadata();

          const existingNames = new Set(baseResult?.tools?.map(t => t.name) || []);
          const newTools = registryTools.filter(t => !existingNames.has(t.name));

          const result: ListToolsResult = {
            tools: [
              ...(baseResult?.tools || []),
              ...newTools
            ]
          };
          return result as unknown as ResultT;
        };
        break;
      }

      case 'resources/read': {
        wrappedHandler = async (request, extra) => {
          const params = (request as any).params;
          const item = this._resourceRegistry.get(params.uri);
          if (item) {
            try {
              const handlerResult = await item.handler(params);
              return handlerResult as unknown as ResultT;
            } catch (e) {
              // Fall through to manual handler
            }
          }
          return originalHandler(request, extra);
        };
        break;
      }

      case 'prompts/get': {
        wrappedHandler = async (request, extra) => {
          const params = (request as any).params;
          const item = this._promptRegistry.get(params.name);
          if (item) {
            try {
              const handlerResult = await item.handler({
                name: params.name,
                arguments: params.arguments
              });
              return handlerResult as unknown as ResultT;
            } catch (e) {
              throw e;
            }
          }
          return originalHandler(request, extra);
        };
        break;
      }

      case 'tools/call': {
        wrappedHandler = async (request, extra) => {
          const params = (request as any).params;
          const item = this._toolRegistry.get(params.name);
          if (item) {
            try {
              const properties = item.metadata.inputSchema?.properties || {};
              const parameterNames = Object.keys(properties);

              const handler = item.handler as (...args: any[]) => Promise<unknown>;
              // Extract arguments in order of parameters
              const args = parameterNames.map(name => {
                const value = params.arguments[name];
                return value === undefined ? undefined : value;
              });

              // Call handler with spread array of args
              const handlerResult = await handler.apply(item, args);
              return handlerResult as unknown as ResultT;
            } catch (e) {
              // Fall through to manual handler
            }
          }
          return originalHandler(request, extra);
        };
        break;
      }

    }

    super.setRequestHandler(requestSchema, wrappedHandler);
  }

  /**
   * Register a class containing decorated methods
   * @param constructor The class constructor
   */
  private _registerClass(constructor: Constructor): void {
    if (!constructor.prototype) {
      throw new Error('Invalid class constructor provided');
    }
    this._registerInstance(new constructor());
  }

  /**
   * Register an instance containing decorated methods
   * @param instance The instance to register
   */
  private _registerInstance(instance: object): void {
    if (!instance || typeof instance !== 'object') {
      throw new Error('Invalid instance provided');
    }

    const prototype = Object.getPrototypeOf(instance);
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => typeof instance[name as keyof typeof instance] === 'function' && name !== 'constructor');

    for (const methodName of methodNames) {
      const method = instance[methodName as keyof typeof instance] as Function;
      if (typeof method !== 'function') continue;

      const handlerType = getHandlerType(method);
      if (!handlerType) continue;

      switch (handlerType) {
        case 'resource': {
          if (!this._capabilities.resources) continue;
          const metadata = getResourceMetadata(method);
          if (!metadata) continue;

          this._resourceRegistry.add(
            metadata.uri,
            metadata,
            async () => method.call(instance)
          );
          break;
        }
        case 'prompt': {
          if (!this._capabilities.prompts) continue;
          const metadata = getPromptMetadata(method);
          if (!metadata) continue;

          this._promptRegistry.add(
              metadata.name,
              metadata,
              async (params: { name: string; arguments?: Record<string, unknown> }) => {
                // If we have arguments metadata, extract values in order
                const args = metadata.arguments?.map(argDef =>
                    params.arguments?.[argDef.name]
                ) || [];
                return method.apply(instance, args);
              }
          );
          break;
        }
        case 'tool': {
          if (!this._capabilities.tools) continue;
          const metadata = getToolMetadata(method);
          if (!metadata) continue;

          this._toolRegistry.add(
              metadata.name,
              metadata,
              async (...args: unknown[]) => {
                return method.apply(instance, args);
              }
          );
          break;
        }
      }
    }
  }

  /**
   * Register either a class or instance
   * @param classOrInstance The class or instance to register
   */
  register(classOrInstance: Constructor | object): void {
    if (typeof classOrInstance === 'function' &&
        'prototype' in classOrInstance &&
        classOrInstance.prototype.constructor === classOrInstance) {
      this._registerClass(classOrInstance as Constructor);
    } else if (classOrInstance && typeof classOrInstance === 'object') {
      this._registerInstance(classOrInstance);
    } else {
      throw new Error('Must provide either a class constructor or class instance');
    }
  }

}
