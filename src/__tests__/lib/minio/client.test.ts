import {
  generateFileName,
  extractFileNameFromUrl,
  parseExternalEndpoint,
} from "@/lib/minio/client";

describe("generateFileName", () => {
  it("returns consistent profile filename for profile type", () => {
    const result = generateFileName("photo.jpg", "user123", "profile");
    expect(result).toBe("user123/profile.jpg");
  });

  it("returns consistent logo filename for logo type", () => {
    const result = generateFileName("image.png", "org-abc", "logo");
    expect(result).toBe("org-abc/logo.png");
  });

  it("returns timestamped filename for generic uploads", () => {
    const before = Date.now();
    const result = generateFileName("report.pdf", "user456");
    const after = Date.now();

    const parts = result.split("/");
    expect(parts[0]).toBe("user456");

    const filePart = parts[1];
    const timestamp = parseInt(filePart.split("-")[0], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
    expect(filePart.endsWith(".pdf")).toBe(true);
  });

  it("preserves the original file extension", () => {
    const result = generateFileName("document.xlsx", "user789", "profile");
    expect(result).toBe("user789/profile.xlsx");
  });
});

describe("parseExternalEndpoint", () => {
  it("parses https endpoint correctly", () => {
    const result = parseExternalEndpoint("https://minio.example.com:9443");
    expect(result.endPoint).toBe("minio.example.com");
    expect(result.port).toBe(9443);
    expect(result.useSSL).toBe(true);
  });

  it("parses https endpoint without port, defaults to 443", () => {
    const result = parseExternalEndpoint("https://minio.example.com");
    expect(result.endPoint).toBe("minio.example.com");
    expect(result.port).toBe(443);
    expect(result.useSSL).toBe(true);
  });

  it("parses http endpoint correctly", () => {
    const result = parseExternalEndpoint("http://localhost:9000");
    expect(result.endPoint).toBe("localhost");
    expect(result.port).toBe(9000);
    expect(result.useSSL).toBe(false);
  });

  it("parses http endpoint without port, defaults to 80", () => {
    const result = parseExternalEndpoint("http://storage.internal");
    expect(result.endPoint).toBe("storage.internal");
    expect(result.port).toBe(80);
    expect(result.useSSL).toBe(false);
  });

  it("parses plain domain (no protocol) as SSL when it contains a dot", () => {
    const result = parseExternalEndpoint("minio.example.com:9000");
    expect(result.endPoint).toBe("minio.example.com");
    expect(result.port).toBe(9000);
    expect(result.useSSL).toBe(true);
  });

  it("parses plain localhost (no dot) as non-SSL", () => {
    const result = parseExternalEndpoint("localhost:9000");
    expect(result.endPoint).toBe("localhost");
    expect(result.port).toBe(9000);
    expect(result.useSSL).toBe(false);
  });
});

describe("extractFileNameFromUrl", () => {
  it("extracts filename from direct MinIO URL format", () => {
    const url = "http://localhost:9000/project-documents/org1/proj1/file.pdf";
    const result = extractFileNameFromUrl(url);
    expect(result).toBe("org1/proj1/file.pdf");
  });

  it("extracts filename from nginx proxy format with /minio/ prefix", () => {
    const url =
      "https://example.com/minio/project-documents/org1/proj1/file.pdf";
    const result = extractFileNameFromUrl(url);
    expect(result).toBe("org1/proj1/file.pdf");
  });

  it("strips cache-busting query parameters before extracting", () => {
    const url =
      "http://localhost:9000/project-documents/org1/proj1/file.pdf?t=1234567890";
    const result = extractFileNameFromUrl(url);
    expect(result).toBe("org1/proj1/file.pdf");
  });

  it("decodes URL-encoded characters in the filename", () => {
    const url =
      "http://localhost:9000/project-documents/org1/proj1/my%20file.pdf";
    const result = extractFileNameFromUrl(url);
    expect(result).toBe("org1/proj1/my file.pdf");
  });

  it("returns null for a malformed URL", () => {
    const result = extractFileNameFromUrl("not-a-valid-url");
    expect(result).toBeNull();
  });

  it("returns null when path has only one segment (no file)", () => {
    const result = extractFileNameFromUrl("http://localhost:9000/bucket-only");
    expect(result).toBeNull();
  });
});
