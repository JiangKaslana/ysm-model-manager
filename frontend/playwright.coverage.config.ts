import base from "./playwright.config";

export default {
  ...base,
  testIgnore: undefined,
  testMatch: /coverage-breadth\.spec\.ts/,
};
