/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-binary-expression */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { Server } from "./index.js";
import { z } from "zod";
import {
  RequestSchema,
  NotificationSchema,
  ResultSchema,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  CreateMessageRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  SetLevelRequestSchema,
  ErrorCode,
  ReadResourceResult,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema, GetPromptResultSchema, CallToolResultSchema, ReadResourceResultSchema,
} from "../types.js";
import { Transport } from "../shared/transport.js";
import { InMemoryTransport } from "../inMemory.js";
import { Client } from "../client/index.js";
import {
  tool,
  prompt,
  resource, param,
} from './decorator.js';

test("should accept latest protocol version", async () => {
  let sendPromiseResolve: (value: unknown) => void;
  const sendPromise = new Promise((resolve) => {
    sendPromiseResolve = resolve;
  });

  const serverTransport: Transport = {
    start: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation((message) => {
      if (message.id === 1 && message.result) {
        expect(message.result).toEqual({
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: expect.any(Object),
          serverInfo: {
            name: "test server",
            version: "1.0",
          },
        });
        sendPromiseResolve(undefined);
      }
      return Promise.resolve();
    }),
  };

  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
      },
    },
  );

  await server.connect(serverTransport);

  // Simulate initialize request with latest version
  serverTransport.onmessage?.({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "test client",
        version: "1.0",
      },
    },
  });

  await expect(sendPromise).resolves.toBeUndefined();
});

test("should accept supported older protocol version", async () => {
  const OLD_VERSION = SUPPORTED_PROTOCOL_VERSIONS[1];
  let sendPromiseResolve: (value: unknown) => void;
  const sendPromise = new Promise((resolve) => {
    sendPromiseResolve = resolve;
  });

  const serverTransport: Transport = {
    start: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation((message) => {
      if (message.id === 1 && message.result) {
        expect(message.result).toEqual({
          protocolVersion: OLD_VERSION,
          capabilities: expect.any(Object),
          serverInfo: {
            name: "test server",
            version: "1.0",
          },
        });
        sendPromiseResolve(undefined);
      }
      return Promise.resolve();
    }),
  };

  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
      },
    },
  );

  await server.connect(serverTransport);

  // Simulate initialize request with older version
  serverTransport.onmessage?.({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: OLD_VERSION,
      capabilities: {},
      clientInfo: {
        name: "test client",
        version: "1.0",
      },
    },
  });

  await expect(sendPromise).resolves.toBeUndefined();
});

test("should handle unsupported protocol version", async () => {
  let sendPromiseResolve: (value: unknown) => void;
  const sendPromise = new Promise((resolve) => {
    sendPromiseResolve = resolve;
  });

  const serverTransport: Transport = {
    start: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockImplementation((message) => {
      if (message.id === 1 && message.result) {
        expect(message.result).toEqual({
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: expect.any(Object),
          serverInfo: {
            name: "test server",
            version: "1.0",
          },
        });
        sendPromiseResolve(undefined);
      }
      return Promise.resolve();
    }),
  };

  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
      },
    },
  );

  await server.connect(serverTransport);

  // Simulate initialize request with unsupported version
  serverTransport.onmessage?.({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "invalid-version",
      capabilities: {},
      clientInfo: {
        name: "test client",
        version: "1.0",
      },
    },
  });

  await expect(sendPromise).resolves.toBeUndefined();
});

test("should respect client capabilities", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
      },
      enforceStrictCapabilities: true,
    },
  );

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  // Implement request handler for sampling/createMessage
  client.setRequestHandler(CreateMessageRequestSchema, async (_request) => {
    // Mock implementation of createMessage
    return {
      model: "test-model",
      role: "assistant",
      content: {
        type: "text",
        text: "This is a test response",
      },
    };
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  expect(server.getClientCapabilities()).toEqual({ sampling: {} });

  // This should work because sampling is supported by the client
  await expect(
    server.createMessage({
      messages: [],
      maxTokens: 10,
    }),
  ).resolves.not.toThrow();

  // This should still throw because roots are not supported by the client
  await expect(server.listRoots()).rejects.toThrow(/^Client does not support/);
});

test("should respect server notification capabilities", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        logging: {},
      },
      enforceStrictCapabilities: true,
    },
  );

  const [_clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  // This should work because logging is supported by the server
  await expect(
    server.sendLoggingMessage({
      level: "info",
      data: "Test log message",
    }),
  ).resolves.not.toThrow();

  // This should throw because resource notificaitons are not supported by the server
  await expect(
    server.sendResourceUpdated({ uri: "test://resource" }),
  ).rejects.toThrow(/^Server does not support/);
});

test("should only allow setRequestHandler for declared capabilities", () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
      },
    },
  );

  // These should work because the capabilities are declared
  expect(() => {
    server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: [] }));
  }).not.toThrow();

  expect(() => {
    server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: [],
    }));
  }).not.toThrow();

  // These should throw because the capabilities are not declared
  expect(() => {
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  }).toThrow(/^Server does not support tools/);

  expect(() => {
    server.setRequestHandler(SetLevelRequestSchema, () => ({}));
  }).toThrow(/^Server does not support logging/);
});

/*
  Test that custom request/notification/result schemas can be used with the Server class.
  */
test("should typecheck", () => {
  const GetWeatherRequestSchema = RequestSchema.extend({
    method: z.literal("weather/get"),
    params: z.object({
      city: z.string(),
    }),
  });

  const GetForecastRequestSchema = RequestSchema.extend({
    method: z.literal("weather/forecast"),
    params: z.object({
      city: z.string(),
      days: z.number(),
    }),
  });

  const WeatherForecastNotificationSchema = NotificationSchema.extend({
    method: z.literal("weather/alert"),
    params: z.object({
      severity: z.enum(["warning", "watch"]),
      message: z.string(),
    }),
  });

  const WeatherRequestSchema = GetWeatherRequestSchema.or(
    GetForecastRequestSchema,
  );
  const WeatherNotificationSchema = WeatherForecastNotificationSchema;
  const WeatherResultSchema = ResultSchema.extend({
    temperature: z.number(),
    conditions: z.string(),
  });

  type WeatherRequest = z.infer<typeof WeatherRequestSchema>;
  type WeatherNotification = z.infer<typeof WeatherNotificationSchema>;
  type WeatherResult = z.infer<typeof WeatherResultSchema>;

  // Create a typed Server for weather data
  const weatherServer = new Server<
    WeatherRequest,
    WeatherNotification,
    WeatherResult
  >(
    {
      name: "WeatherServer",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
        logging: {},
      },
    },
  );

  // Typecheck that only valid weather requests/notifications/results are allowed
  weatherServer.setRequestHandler(GetWeatherRequestSchema, (_request) => {
    return {
      temperature: 72,
      conditions: "sunny",
    };
  });

  weatherServer.setNotificationHandler(
    WeatherForecastNotificationSchema,
    (notification) => {
      console.log(`Weather alert: ${notification.params.message}`);
    },
  );
});

test("should handle server cancelling a request", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  // Set up client to delay responding to createMessage
  client.setRequestHandler(
    CreateMessageRequestSchema,
    async (_request, _extra) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return {
        model: "test",
        role: "assistant",
        content: {
          type: "text",
          text: "Test response",
        },
      };
    },
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Set up abort controller
  const controller = new AbortController();

  // Issue request but cancel it immediately
  const createMessagePromise = server.createMessage(
    {
      messages: [],
      maxTokens: 10,
    },
    {
      signal: controller.signal,
    },
  );
  controller.abort("Cancelled by test");

  // Request should be rejected
  await expect(createMessagePromise).rejects.toBe("Cancelled by test");
});
test("should handle request timeout", async () => {
  const server = new Server(
    {
      name: "test server",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  // Set up client that delays responses
  const client = new Client(
    {
      name: "test client",
      version: "1.0",
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  );

  client.setRequestHandler(
    CreateMessageRequestSchema,
    async (_request, extra) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 100);
        extra.signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(extra.signal.reason);
        });
      });

      return {
        model: "test",
        role: "assistant",
        content: {
          type: "text",
          text: "Test response",
        },
      };
    },
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Request with 0 msec timeout should fail immediately
  await expect(
    server.createMessage(
      {
        messages: [],
        maxTokens: 10,
      },
      { timeout: 0 },
    ),
  ).rejects.toMatchObject({
    code: ErrorCode.RequestTimeout,
  });
});

describe('Server Registry Integration', () => {

  let server: Server;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Initialize server with all capabilities
    server = new Server(
        { name: 'test-server', version: '1.0' },
        {
          capabilities: {
            resources: {},
            prompts: {},
            tools: {}
          },
          enforceStrictCapabilities: true
        }
    );

    // Initialize client with matching capabilities
    client = new Client(
        { name: 'test-client', version: '1.0' },
        {
          capabilities: {
            resources: {},
            prompts: {},
            tools: {}
          }
        }
    );

    // Connect both client and server
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport)
    ]);
  });


  test('should list decorator-registered resources', async () => {
    // Register a decorated class
    class TestHandlers {
      @resource({
        uri: 'file:///test.txt',
        name: 'Test Resource',
        description: 'Test resource',
        mimeType: 'text/plain'
      })
      async getResource(): Promise<ReadResourceResult> {
        return {
          contents: [{
            type: 'text',
            text: 'Test content',
            uri: 'file:///test.txt'
          }]
        };
      }
    }

    server.register(new TestHandlers());

    const response = await client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema
    );

    expect(response.resources).toHaveLength(1);
    expect(response.resources[0]).toMatchObject({
      uri: 'file:///test.txt',
      name: 'Test Resource',
      mimeType: 'text/plain'
    });
  });

  test('should handle both decorator and manual registration', async () => {
    // Register with decorator
    class TestHandlers {
      @resource({
        uri: 'file:///decorator.txt',
        name: 'Decorator Resource',
        description: 'Test resource',
        mimeType: 'text/plain'
      })
      async getResource(): Promise<ReadResourceResult> {
        return {
          contents: [{
            type: 'text',
            text: 'Decorator content',
            uri: 'file:///decorator.txt'
          }]
        };
      }
    }
    server.register(new TestHandlers());

    // Register manual handler
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [{
        uri: 'file:///manual.txt',
        name: 'Manual Resource',
        description: 'Test resource',
        mimeType: 'text/plain'
      }]
    }));

    const response = await client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema
    );

    // Should get both resources
    expect(response.resources).toHaveLength(2);
    expect(response.resources).toContainEqual({
      uri: 'file:///decorator.txt',
      name: 'Decorator Resource',
      description: 'Test resource',
      mimeType: 'text/plain'
    });
    expect(response.resources).toContainEqual({
      uri: 'file:///manual.txt',
      name: 'Manual Resource',
      description: 'Test resource',
      mimeType: 'text/plain'
    });
  });

  test("should validate handler schema", () => {
    // Create server with required options
    const server = new Server(
        { name: "test", version: "1.0" },
        {
          capabilities: {
            prompts: {},
            resources: {},
            tools: {},
          }
        }
    );

    // Create an invalid schema missing required properties
    const invalidSchema = {
      // Missing method literal and other required properties
      params: z.object({})
    };

    const handler = async () => ({ result: "test" });

    // Attempting to set handler with invalid schema should throw
    expect(() =>
        server.setRequestHandler(invalidSchema as any, handler)
    ).toThrow();
  });

  test('should throw error when registering null', () => {
    expect(() => {
      server.register(null as any);
    }).toThrow('Must provide either a class constructor or class instance');
  });

  test('should throw error when registering undefined', () => {
    expect(() => {
      server.register(undefined as any);
    }).toThrow('Must provide either a class constructor or class instance');
  });

  test('should throw error when registering primitive values', () => {
    expect(() => {
      server.register(42 as any);
    }).toThrow('Must provide either a class constructor or class instance');

    expect(() => {
      server.register('string' as any);
    }).toThrow('Must provide either a class constructor or class instance');
  });

  test('should handle multiple decorators on same class', async () => {
    class MultiHandler {
      @resource({
        uri: 'file:///multi.txt',
        name: 'Multi Resource',
        mimeType: 'text/plain'
      })
      async getResource(): Promise<any> {
        return {
          contents: [{
            uri: 'file:///multi.txt',
            text: 'Resource content'
          }]
        };
      }

      @prompt({
        name: 'multi-prompt',
        description: 'Multi prompt'
      })
      async getPrompt(): Promise<any> {
        return {
          template: 'Multi prompt template'
        };
      }

      @tool({
        name: 'multi-tool',
        description: 'Multi tool'
      })
      async executeTool(): Promise<any> {
        return { result: 'Tool result' };
      }
    }

    server.register(new MultiHandler());

    const resourcesResponse = await client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema
    );
    const promptsResponse = await client.request(
        { method: 'prompts/list' },
        ListPromptsResultSchema
    );
    const toolsResponse = await client.request(
        { method: 'tools/list' },
        ListToolsResultSchema
    );

    expect(resourcesResponse.resources).toHaveLength(1);
    expect(promptsResponse.prompts).toHaveLength(1);
    expect(toolsResponse.tools).toHaveLength(1);
  });

  test('should not register decorators when capabilities are disabled', async () => {
    // Create server with no capabilities
    const limitedServer = new Server(
        { name: 'limited-server', version: '1.0' },
        {
          capabilities: {},
          enforceStrictCapabilities: true
        }
    );

    const [_clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    class TestHandlers {
      @resource({
        uri: 'file:///test.txt',
        name: 'Test Resource',
        mimeType: 'text/plain'
      })
      async getResource() {
        return {
          contents: [{ uri: 'file:///test.txt', text: 'content' }]
        };
      }

      @prompt({
        name: 'test-prompt',
        description: 'Test prompt'
      })
      async getPrompt() {
        return {
          messages: [{
            role: 'user',
            content: { type: 'text', text: 'test' }
          }],
          template: 'prompt'
        };
      }

      @tool({
        name: 'test-tool',
        description: 'Test tool'
      })
      async executeTool() {
        return { result: 'tool' };
      }
    }

    // Should not throw, but also should not register the handlers
    limitedServer.register(new TestHandlers());

    // Connect server to transport
    await limitedServer.connect(serverTransport);

    // Modified assertions to verify that capability errors are thrown when handlers are called
    await expect(async () => {
      await limitedServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: []
      }));
    }).rejects.toThrow(/Server does not support resources/);

    await expect(async () => {
      await limitedServer.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: []
      }));
    }).rejects.toThrow(/Server does not support prompts/);

    await expect(async () => {
      await limitedServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: []
      }));
    }).rejects.toThrow(/Server does not support tools/);
  });

  test('should handle errors in decorated handlers gracefully', async () => {
    const spy = jest.spyOn(console, 'error');
    spy.mockImplementation(() => {});

    class ErrorHandlers {
      @resource({
        uri: 'file:///error.txt',
        name: 'Error Resource',
        mimeType: 'text/plain'
      })
      async getResource() {
        throw new Error('Expected Resource error');
      }

      @prompt({
        name: 'error-prompt',
        description: 'Error prompt'
      })
      async getPrompt() {
        throw new Error('Expected Prompt error');
      }

      @tool({
        name: 'error-tool',
        description: 'Error tool'
      })
      async executeTool() {
        throw new Error('Expected Tool error');
      }
    }

    server.register(new ErrorHandlers());

    // Resources should still be listed even if their handlers throw
    const resourcesResponse = await client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema
    );
    expect(resourcesResponse.resources).toHaveLength(1);

    // Reading the resource should fail gracefully
    await expect(
        client.request({
              method: 'resources/read',
              params: { uri: 'file:///error.txt' }
            },
            ReadResourceResultSchema)
    ).rejects.toThrow();

    // Prompts should still be listed
    const promptsResponse = await client.request(
        { method: 'prompts/list' },
        ListPromptsResultSchema
    );
    expect(promptsResponse.prompts).toHaveLength(1);

    // Executing the prompt should fail gracefully
    await expect(
        client.request({
              method: 'prompts/get',
              params: { name: 'error-prompt', arguments: {} }
            },
            GetPromptResultSchema)
    ).rejects.toThrow();

    // Tools should still be listed
    const toolsResponse = await client.request(
        { method: 'tools/list' },
        ListToolsResultSchema
    );
    expect(toolsResponse.tools).toHaveLength(1);

    // Executing the tool should fail gracefully
    await expect(
        client.request({
              method: 'tools/call',
              params: { name: 'error-tool', arguments: {} }
            },
            CallToolResultSchema)
    ).rejects.toThrow();

    spy.mockRestore();
  });
});
