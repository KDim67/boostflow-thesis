export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } =
      await import("@opentelemetry/exporter-trace-otlp-grpc");
    const resources = await import("@opentelemetry/resources");

    // Resolve the factory function cleanly across any ESM/CJS wrappers
    const resourceFromAttributes =
      (resources as any).resourceFromAttributes ??
      (resources as any).default?.resourceFromAttributes;

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        "service.name": "boostflow-app",
      }),
      traceExporter: new OTLPTraceExporter({
        url:
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
          "http://jaeger.monitoring.svc.cluster.local:4317",
      }),
    });

    sdk.start();
  }
}
