export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } =
      await import("@opentelemetry/exporter-trace-otlp-grpc");
    const resources = await import("@opentelemetry/resources");

    // Handle any ES/CJS module interoperability wrappers cleanly
    const Resource =
      (resources as any).Resource || (resources as any).default?.Resource;

    const sdk = new NodeSDK({
      resource: new Resource({
        "service.name": "boostflow-app",
      }),
      traceExporter: new OTLPTraceExporter({
        url:
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
          "http://jaeger.monitoring.svc.cluster.local:4317",
      }),
    });

    sdk.start();
  }
}
