import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

// Unit tests for the pure logic in lib/ (loan date-math, recommender scoring).
// Node environment — these functions never touch the DOM. The "@/…" alias mirrors
// tsconfig so tests can import app modules if they ever need to.
const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": root },
  },
})
