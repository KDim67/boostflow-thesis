/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
        },
      },
    ],
  },
  collectCoverageFrom: [
    "src/lib/api/authHelper.ts",
    "src/lib/api/uploadHelper.ts",
    "src/lib/utils/logger.ts",
    "src/proxy.ts",
  ],
  coverageProvider: "v8",
  coverageReporters: ["lcov", "text", "text-summary"],
  coverageDirectory: "coverage",
};

module.exports = config;
