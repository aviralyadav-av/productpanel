import Module from "node:module";

/**
 * Preload for the check scripts: turn `import "server-only"` into a no-op.
 *
 * `server-only` is a marker package whose default entry throws so a module
 * cannot be bundled into a Client Component. Under plain Node (tsx) there is
 * no bundler and no client, so the throw is noise. Node's `react-server`
 * export condition would silence it too, but it also swaps `react` for its
 * server build (no `createContext`), which breaks `lucide-react` behind the
 * content registry - hence this narrower stub.
 *
 * Usage: node --import tsx --import ./src/features/storefront/__checks__/stub-server-only.ts <script>
 */

type Loader = (request: string, ...rest: unknown[]) => unknown;
const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;

moduleWithLoad._load = function stubbedLoad(this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, ...rest);
};
