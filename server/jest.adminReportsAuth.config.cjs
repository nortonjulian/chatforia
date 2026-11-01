const base = require('./jest.config.cjs');

const moduleNameMapper = { ...base.moduleNameMapper };

for (const pattern of Object.keys(moduleNameMapper)) {
  if (
    pattern.includes('middleware/auth') ||
    pattern.includes('middleware\\/auth')
  ) {
    delete moduleNameMapper[pattern];
  }
}

module.exports = {
  ...base,
  moduleNameMapper,
  testMatch: [
    '**/__tests__/adminReports.authorization.test.js',
  ],
};
