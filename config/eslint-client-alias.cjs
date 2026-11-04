const path = require('node:path');
const nodeResolver = require('eslint-import-resolver-node');

// Resolve exactly the existing Vite @/ -> client/src alias. This does not skip
// import validation: missing aliased files still return found:false.
exports.interfaceVersion = 2;
exports.resolve = (source, file) => {
  if (!source.startsWith('@/')) return { found: false };
  return nodeResolver.resolve(path.resolve(__dirname, '../client/src', source.slice(2)), file, {
    extensions: ['.js', '.jsx', '.json'],
  });
};
