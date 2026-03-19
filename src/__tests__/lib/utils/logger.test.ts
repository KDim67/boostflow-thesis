import { Logger, LogLevel, createLogger } from "@/lib/utils/logger";

describe("Logger", () => {
  let consoleSpy: {
    debug: jest.SpyInstance;
    info: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
      info: jest.spyOn(console, "info").mockImplementation(() => {}),
      warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs debug messages via console.debug", () => {
    const logger = new Logger("TestService");
    logger.debug("debug message");
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
    expect(consoleSpy.debug).toHaveBeenCalledWith(
      expect.objectContaining({ service: "TestService", msg: "debug message" })
    );
  });

  it("logs info messages via console.info", () => {
    const logger = new Logger("TestService");
    logger.info("info message");
    expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "info message" })
    );
  });

  it("logs warn messages via console.warn", () => {
    const logger = new Logger("TestService");
    logger.warn("warning message");
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "warning message" })
    );
  });

  it("logs error messages via console.error", () => {
    const logger = new Logger("TestService");
    logger.error("error message");
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "error message" })
    );
  });

  it("includes error details when an Error object is passed", () => {
    const logger = new Logger("TestService");
    const err = new Error("something went wrong");
    logger.error("operation failed", err);
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "operation failed",
        error: expect.objectContaining({ message: "something went wrong" }),
      })
    );
  });

  it("includes context object when provided to info", () => {
    const logger = new Logger("TestService");
    logger.info("with context", { userId: "abc123" });
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "abc123" })
    );
  });

  it("handles null context without throwing", () => {
    const logger = new Logger("TestService");
    expect(() =>
      logger.debug("null context", null as unknown as undefined)
    ).not.toThrow();
  });

  it("handles primitive context values", () => {
    const logger = new Logger("TestService");
    expect(() =>
      logger.info("primitive", 42 as unknown as undefined)
    ).not.toThrow();
  });

  it("includes the service name in every log entry", () => {
    const logger = new Logger("MyService");
    logger.warn("check service");
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ service: "MyService" })
    );
  });
});

describe("createLogger", () => {
  it("returns a Logger instance", () => {
    const logger = createLogger("Factory");
    expect(logger).toBeInstanceOf(Logger);
  });

  it("created logger uses the provided service name", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger("FactoryService");
    logger.warn("test");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ service: "FactoryService" })
    );
    warnSpy.mockRestore();
  });
});

describe("LogLevel enum", () => {
  it("has the expected string values", () => {
    expect(LogLevel.DEBUG).toBe("debug");
    expect(LogLevel.INFO).toBe("info");
    expect(LogLevel.WARN).toBe("warn");
    expect(LogLevel.ERROR).toBe("error");
  });
});
