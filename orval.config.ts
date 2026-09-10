import { defineConfig } from "orval";

export default defineConfig({
  fusion: {
    input: "./openapi/openapi.json",
    output: {
      mode: "tags-split",
      target: "./frontend/src/api/generated/endpoints",
      schemas: "./frontend/src/api/generated/models",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      prettier: false,
      override: {
        query: { version: 5 },
        mutator: {
          path: "./frontend/src/api/fetch-client.ts",
          name: "fusionFetch"
        }
      }
    }
  },
  fusionZod: {
    input: "./openapi/openapi.json",
    output: {
      mode: "tags-split",
      target: "./frontend/src/api/generated/validation",
      client: "zod",
      clean: false,
      prettier: false,
      fileExtension: ".zod.ts"
    }
  }
});
