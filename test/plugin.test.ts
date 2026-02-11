import { describe, it, expect } from "vitest";
import GitLabOidcAuth from "../src/plugin";

describe("GitLabOidcAuth", () => {
  describe("constructor", () => {
    it("throws when gitlab_url is missing", () => {
      const config = { audience: "https://npm.example.com" } as any;
      const options = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        config: {},
      } as any;

      expect(() => new GitLabOidcAuth(config, options)).toThrow(
        "gitlab_url",
      );
    });

    it("throws when audience is missing", () => {
      const config = { gitlab_url: "https://gitlab.example.com" } as any;
      const options = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        config: {},
      } as any;

      expect(() => new GitLabOidcAuth(config, options)).toThrow(
        "audience",
      );
    });
  });

  describe("authenticate", () => {
    it("passes through when username does not match ci_username", () => {
      const config = {
        gitlab_url: "https://gitlab.example.com",
        audience: "https://npm.example.com",
      } as any;
      const options = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        config: {},
      } as any;

      const plugin = new GitLabOidcAuth(config, options);

      return new Promise<void>((resolve) => {
        plugin.authenticate("regular-user", "password123", (err, groups) => {
          expect(err).toBeNull();
          expect(groups).toBe(false);
          resolve();
        });
      });
    });
  });
});
