import { NextResponse } from "next/server";
import minioClient, { BUCKETS } from "@/lib/minio/client";

export async function streamDocumentToResponse(
  document: Record<string, unknown>
): Promise<NextResponse> {
  const fileStream = await minioClient.getObject(
    BUCKETS.PROJECT_DOCUMENTS,
    document.fileName as string
  );

  const chunks: Buffer[] = [];
  for await (const chunk of fileStream) {
    chunks.push(chunk);
  }
  const fileBuffer = Buffer.concat(chunks);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        (document.mimeType as string) || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${(document.originalName as string) || (document.fileName as string)}"`,
      "Cache-Control": "private, no-cache",
      "Content-Length": fileBuffer.length.toString(),
    },
  });
}
