import { NextResponse } from "next/server";

export async function GET() {
  try {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    const metrics =
      [
        `# HELP process_uptime_seconds Uptime of Next.js process`,
        `# TYPE process_uptime_seconds gauge`,
        `process_uptime_seconds ${uptime}`,
        `# HELP process_memory_rss_bytes Resident set size in bytes`,
        `# TYPE process_memory_rss_bytes gauge`,
        `process_memory_rss_bytes ${memory.rss}`,
        `# HELP process_memory_heap_used_bytes Heap used in bytes`,
        `# TYPE process_memory_heap_used_bytes gauge`,
        `process_memory_heap_used_bytes ${memory.heapUsed}`,
        `# HELP process_memory_heap_total_bytes Heap total in bytes`,
        `# TYPE process_memory_heap_total_bytes gauge`,
        `process_memory_heap_total_bytes ${memory.heapTotal}`,
      ].join("\n") + "\n";

    return new NextResponse(metrics, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  } catch (error) {
    return new NextResponse(`error_getting_metrics 1\n`, {
      status: 500,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  }
}
