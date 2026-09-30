import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      // `shared/` holds rules both runtimes depend on. They are exercised
      // through the server tests, but a rule that decides whether a request is
      // retried has branches no router reaches, and it needs its own.
      "shared/**/*.test.ts",
      // The cache helpers are client code with no server router to exercise
      // them, and the key matching they rely on is worth asserting directly.
      "client/src/**/*.test.ts",
    ],
  },
});
