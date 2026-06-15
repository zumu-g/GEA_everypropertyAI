// Vitest global setup. Registers @testing-library/jest-dom matchers (toBeInTheDocument,
// toHaveAttribute, etc.) on `expect`. Importing the matchers is harmless for the default
// node-environment tests — it only extends the matcher registry; DOM-dependent matchers are
// exercised only by tests that opt into the jsdom environment via a `// @vitest-environment jsdom`
// docblock at the top of the file.
import '@testing-library/jest-dom/vitest';
