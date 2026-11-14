// Isolated route tests use mocked providers and never initialize a database.
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/server/__tests__/messages-expiration-history.test.js',
    '<rootDir>/server/__tests__/privateMediaHttp.test.js',
    '<rootDir>/server/__tests__/privateMediaR2Http.test.js',
  ],
  transform: { '^.+\\.jsx?$': 'babel-jest' },
  collectCoverage: false,
};
