/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as restify from 'restify';
import { context, setSpan } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/node';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/tracing';
// import {
//   ExceptionAttribute,
//   ExceptionEventName,
//   HttpAttribute,
// } from '@opentelemetry/semantic-conventions';

import { RestifyInstrumentation } from '../src';
const plugin = new RestifyInstrumentation();

import { strict as assert } from 'assert';
import * as http from 'http';
import { AddressInfo } from 'net';

const httpRequest = {
  get: (options: http.ClientRequestArgs | string) => {
    return new Promise((resolve, reject) => {
      return http.get(options, resp => {
        let data = '';
        resp.on('data', chunk => {
          data += chunk;
        });
        resp.on('end', () => {
          resolve(data);
        });
        resp.on('error', err => {
          reject(err);
        });
      });
    });
  },
};

const createServer = async (setupRoutes?: Function) => {
  const server = restify.createServer();

  if (typeof setupRoutes === 'function') {
    setupRoutes(server);
  } else {
    server.pre((req, res, next) => {
      // this will be run before routing
      next();
    });

    server.use((req, res, next) => {
      // this will be run only if route was found
      next();
    });

    server.get('/route/:param', (req, res, next) => {
      res.send({ route: req?.params?.param });
    });

    server.get('/failing', (req, res, next) => {
      throw new Error('NOK');
    });
  }

  await new Promise<void>(resolve => server.listen(0, resolve));
  return server;
};

describe('Restify Instrumentation', () => {
  const provider = new NodeTracerProvider();
  const memoryExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(memoryExporter);
  provider.addSpanProcessor(spanProcessor);
  plugin.setTracerProvider(provider);
  const tracer = provider.getTracer('default');
  let contextManager: AsyncHooksContextManager;
  let server: restify.Server;
  let port: number;

  before(() => {
    plugin.enable();
  });

  after(() => {
    plugin.disable();
  });

  beforeEach(async () => {
    contextManager = new AsyncHooksContextManager();
    context.setGlobalContextManager(contextManager.enable());

    server = await createServer();
    port = (server.address() as AddressInfo).port;
    assert.strictEqual(memoryExporter.getFinishedSpans().length, 0);
  });

  afterEach(() => {
    memoryExporter.reset();
    context.disable();
    server.close();
  });

  describe('Instrumenting core middleware calls', () => {
    it('should create a span for each handler', async () => {
      const rootSpan = tracer.startSpan('clientSpan');

      await context.with(setSpan(context.active(), rootSpan), async () => {
        await httpRequest.get(`http://localhost:${port}/route/foo`);
        rootSpan.end();
        assert.deepStrictEqual(memoryExporter.getFinishedSpans().length, 4);

        {
          // span from pre
          const span = memoryExporter
            .getFinishedSpans()[0];
          assert.notEqual(span, undefined);
          assert.equal(span.attributes['http.route'], undefined);
          assert.equal(span.attributes['restify.method'], 'pre');
          assert.equal(span.attributes['restify.type'], 'middleware');
          assert.equal(span.attributes['restify.version'], 'n/a');
        }
        {
          // span from use
          const span = memoryExporter
            .getFinishedSpans()[1];
          assert.notEqual(span, undefined);
          assert.equal(span.attributes['http.route'], '/route/:param');
          assert.equal(span.attributes['restify.method'], 'use');
          assert.equal(span.attributes['restify.type'], 'middleware');
          assert.equal(span.attributes['restify.version'], 'n/a');
        }
        {
          // span from get
          const span = memoryExporter
            .getFinishedSpans()[2];
          assert.notEqual(span, undefined);
          assert.equal(span.attributes['http.route'], '/route/:param');
          assert.equal(span.attributes['restify.method'], 'get');
          assert.equal(span.attributes['restify.type'], 'request_handler');
          assert.equal(span.attributes['restify.version'], 'n/a');
        }
      });
    });

    it('should lack `http.route` but still have `restify.version` if route was 404', async () => {
      const rootSpan = tracer.startSpan('rootSpan');

      await context.with(setSpan(context.active(), rootSpan), async () => {
        const res = await httpRequest.get(`http://localhost:${port}/not-found`);
        rootSpan.end();
        assert.deepStrictEqual(memoryExporter.getFinishedSpans().length, 2);

        {
          // span from pre
          const span = memoryExporter
            .getFinishedSpans()[0];
          assert.notEqual(span, undefined);
          assert.equal(span.attributes['http.route'], undefined);
          assert.equal(span.attributes['restify.method'], 'pre');
          assert.equal(span.attributes['restify.type'], 'middleware');
          assert.equal(span.attributes['restify.version'], 'n/a');
        }
        assert.strictEqual(res, '{"code":"ResourceNotFound","message":"/not-found does not exist"}');
      });
    });

    it('should create spans even if there is no parent', async () => {
      const res = await httpRequest.get(`http://localhost:${port}/route/bar`);
      assert.strictEqual(memoryExporter.getFinishedSpans().length, 3);
      assert.strictEqual(res, '{"route":"bar"}');
    });
  });

  describe('Disabling restify instrumentation', () => {
    it('should not create new spans', async () => {
      plugin.disable();
      const rootSpan = tracer.startSpan('rootSpan');

      await context.with(setSpan(context.active(), rootSpan), async () => {
        assert.strictEqual(await httpRequest.get(`http://localhost:${port}/route/foo`), '{"route":"foo"}');
        rootSpan.end();
        assert.deepStrictEqual(memoryExporter.getFinishedSpans().length, 1);
        assert.notStrictEqual(memoryExporter.getFinishedSpans()[0], undefined);
      });
    });
  });
});
