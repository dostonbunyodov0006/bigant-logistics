/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;
config.resolver.unstable_enablePackageExports = true;

// One React for the whole bundle. In the monorepo the web app pulls React 18,
// and a hoisted dependency (use-sync-external-store) can resolve that copy —
// two Reacts means hooks see a null dispatcher and the app dies on render.
const singletons = ['react'];
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const root = singletons.find((m) => moduleName === m || moduleName.startsWith(`${m}/`));
  if (root) {
    const resolved = require.resolve(moduleName, { paths: [projectRoot] });
    return { type: 'sourceFile', filePath: resolved };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
