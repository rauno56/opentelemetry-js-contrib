'use strict';

const opentelemetry = require('@opentelemetry/api');

const { diag, DiagConsoleLogger, DiagLogLevel } = opentelemetry;
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.VERBOSE);

const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { NodeTracerProvider } = require('@opentelemetry/node');
const { SimpleSpanProcessor, ConsoleSpanExporter } = require('@opentelemetry/tracing');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');
const { ZipkinExporter } = require('@opentelemetry/exporter-zipkin');

const { RestifyInstrumentation: Instrumentation } = require('../../plugins/node/opentelemetry-instrumentation-restify');
const { HttpInstrumentation } = require('../../../opentelemetry-js/packages/opentelemetry-instrumentation-http');

const Exporter = ((exporterParam) => {
  if (typeof exporterParam === 'string') {
    const exporterString = exporterParam.toLowerCase();
    if (exporterString.startsWith('z')) {
      return ZipkinExporter;
    }
    if (exporterString.startsWith('j')) {
      return JaegerExporter;
    }
  }
  return ConsoleSpanExporter;
})(process.env.EXPORTER);

module.exports = (serviceName) => {
  const provider = new NodeTracerProvider();
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      HttpInstrumentation,
      Instrumentation,
    ],
  });

  const exporter = new Exporter({
    serviceName,
  });

  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

  // Initialize the OpenTelemetry APIs to use the NodeTracerProvider bindings
  provider.register();

  return opentelemetry.trace.getTracer('restify-example');
};
