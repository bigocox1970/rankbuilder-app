module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Neutralize `import.meta` so libraries built for Vite/ESM (e.g. zustand's
    // `import.meta.env.MODE` dev checks) don't crash Metro's web bundle with
    // "Cannot use 'import.meta' outside a module" — which throws at module load,
    // before anything renders (a silent white screen). Metro/Hermes has no
    // import.meta; this rewrites it so `import.meta.env` is undefined, not a crash.
    plugins: ['babel-plugin-transform-import-meta'],
  };
};
