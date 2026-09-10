import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Testing Library only registers its own cleanup when Vitest runs with
 * `globals: true`, which this project does not. Without it, every render stays
 * in the document and the second test in a file starts finding two of
 * everything.
 */
afterEach(cleanup);
