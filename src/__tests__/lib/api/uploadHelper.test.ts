import { validateImageFile, fileToBuffer } from "@/lib/api/uploadHelper";
import { NextResponse } from "next/server";

function makeFile(type: string, size: number): File {
  const blob = new Blob(["x".repeat(size)], { type });
  return new File([blob], "test-file", { type });
}

describe("validateImageFile", () => {
  it("returns null for a valid JPEG within size limit", () => {
    const file = makeFile("image/jpeg", 1024);
    expect(validateImageFile(file)).toBeNull();
  });

  it("returns null for a valid PNG within size limit", () => {
    const file = makeFile("image/png", 1024);
    expect(validateImageFile(file)).toBeNull();
  });

  it("returns null for a valid GIF within size limit", () => {
    const file = makeFile("image/gif", 1024);
    expect(validateImageFile(file)).toBeNull();
  });

  it("returns null for a valid WebP within size limit", () => {
    const file = makeFile("image/webp", 1024);
    expect(validateImageFile(file)).toBeNull();
  });

  it("returns 400 response for an invalid file type", async () => {
    const file = makeFile("application/pdf", 1024);
    const result = validateImageFile(file);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toContain("Invalid file type");
    expect((result as NextResponse).status).toBe(400);
  });

  it("returns 400 response for a text/plain file type", async () => {
    const file = makeFile("text/plain", 1024);
    const result = validateImageFile(file);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toContain("Invalid file type");
  });

  it("returns 400 response when file exceeds 5MB", async () => {
    const file = makeFile("image/jpeg", 6 * 1024 * 1024);
    const result = validateImageFile(file);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toContain("File too large");
    expect((result as NextResponse).status).toBe(400);
  });

  it("returns null for a file exactly at the 5MB limit", () => {
    const file = makeFile("image/png", 5 * 1024 * 1024);
    expect(validateImageFile(file)).toBeNull();
  });
});

describe("fileToBuffer", () => {
  it("converts a File to a Buffer", async () => {
    const content = "hello world";
    const file = new File([content], "test.txt", { type: "text/plain" });
    const buffer = await fileToBuffer(file);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe(content);
  });

  it("produces a buffer with the correct byte length", async () => {
    const file = makeFile("image/jpeg", 512);
    const buffer = await fileToBuffer(file);
    expect(buffer.length).toBe(512);
  });
});
