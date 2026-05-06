// vite-env.d.ts — Ambient module declarations for Vite-specific imports.
// This file is intentionally a "script" (no top-level imports/exports), so
// `declare module` here applies globally rather than as a local augmentation.

declare module '*?worker' {
    const workerConstructor: new (options?: { name?: string }) => Worker;
    export default workerConstructor;
}

declare module '*?worker&inline' {
    const workerConstructor: new (options?: { name?: string }) => Worker;
    export default workerConstructor;
}

declare module '*?url' {
    const url: string;
    export default url;
}

declare module '*?raw' {
    const content: string;
    export default content;
}
