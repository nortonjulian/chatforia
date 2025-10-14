export const toast = {
  info: (...args) => { if (process.env.NODE_ENV !== 'test') console.info(...args); },
  err:  (...args) => { if (process.env.NODE_ENV !== 'test') console.error(...args); },
  ok:   (...args) => { if (process.env.NODE_ENV !== 'test') console.log(...args); },
};
