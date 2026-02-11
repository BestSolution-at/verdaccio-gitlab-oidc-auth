import http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import type { JWK } from "jose";
import GitLabOidcAuth from "../src/plugin";
import type { GitLabJwtClaims } from "../src/types";

// ---------------------------------------------------------------------------
// Test infrastructure: in-memory JWKS server + JWT builder
// ---------------------------------------------------------------------------

let privateKey: CryptoKey;
let publicJwk: JWK;
let jwksServer: http.Server;
let jwksPort: number;

/** Base URL of the fake GitLab instance (e.g. http://127.0.0.1:12345). */
let gitlabUrl: string;

const AUDIENCE = "https://npm.example.com";

beforeAll(async () => {
  // Generate an RSA key pair for signing test JWTs
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey as CryptoKey;
  publicJwk = await exportJWK(kp.publicKey as CryptoKey);
  publicJwk.kid = "test-key-1";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  // Start a minimal HTTP server that serves JWKS at /oauth/discovery/keys
  jwksServer = http.createServer((req, res) => {
    if (req.url === "/oauth/discovery/keys") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    jwksServer.listen(0, "127.0.0.1", () => {
      const addr = jwksServer.address();
      if (addr && typeof addr === "object") {
        jwksPort = addr.port;
      }
      gitlabUrl = `http://127.0.0.1:${jwksPort}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

/** Build a signed JWT with the given claims (merged over sensible defaults). */
async function buildJwt(
  overrides: Partial<GitLabJwtClaims> = {},
  opts?: { expiresIn?: string; notBefore?: string },
): Promise<string> {
  const claims: GitLabJwtClaims = {
    iss: gitlabUrl,
    aud: AUDIENCE,
    exp: 0, // set by jose
    iat: 0, // set by jose
    sub: "project_123:ref_type:branch:ref:main",
    ref: "main",
    ref_type: "branch",
    ref_protected: "true",
    project_id: 123,
    project_path: "my-group/my-project",
    namespace_path: "my-group",
    user_login: "ci-bot",
    pipeline_source: "push",
    job_id: "98765",
    ...overrides,
  };

  let builder = new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuedAt()
    .setIssuer(claims.iss)
    .setAudience(claims.aud);

  if (opts?.expiresIn) {
    builder = builder.setExpirationTime(opts.expiresIn);
  } else {
    builder = builder.setExpirationTime("5m");
  }

  return builder.sign(privateKey);
}

/** Create a plugin instance pointing at the local JWKS server. */
function createPlugin(configOverrides: Record<string, unknown> = {}) {
  const config = {
    gitlab_url: gitlabUrl,
    audience: AUDIENCE,
    ...configOverrides,
  } as any;
  const options = {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
    },
    config: {},
  } as any;
  return new GitLabOidcAuth(config, options);
}

/** Promise wrapper around the callback-based authenticate(). */
function authenticate(
  plugin: GitLabOidcAuth,
  user: string,
  password: string,
): Promise<{ err: Error | null; groups: string[] | false }> {
  return new Promise((resolve) => {
    plugin.authenticate(user, password, (err, groups) => {
      resolve({
        err: err as Error | null,
        groups: groups as string[] | false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitLabOidcAuth", () => {
  describe("constructor", () => {
    it("throws when gitlab_url is missing", () => {
      expect(
        () => createPlugin({ gitlab_url: undefined }),
      ).toThrow("gitlab_url");
    });

    it("throws when audience is missing", () => {
      expect(
        () => createPlugin({ audience: undefined }),
      ).toThrow("audience");
    });

    it("strips trailing slashes from gitlab_url", () => {
      // Should not throw — verifies URL normalization doesn't break
      const plugin = createPlugin({ gitlab_url: gitlabUrl + "///" });
      expect(plugin).toBeDefined();
    });
  });

  describe("authenticate — pass-through", () => {
    it("returns false for non-CI username", async () => {
      const plugin = createPlugin();
      const result = await authenticate(plugin, "regular-user", "password123");
      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for empty username", async () => {
      const plugin = createPlugin();
      const result = await authenticate(plugin, "", "password123");
      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });
  });

  describe("authenticate — valid JWT", () => {
    it("returns groups for a valid token from a protected ref", async () => {
      const plugin = createPlugin();
      const token = await buildJwt({ ref_protected: "true" });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toEqual(["gitlab-ci", "gitlab-ci-protected"]);
    });

    it("returns only gitlab-ci for an unprotected ref", async () => {
      const plugin = createPlugin();
      const token = await buildJwt({ ref_protected: "false" });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toEqual(["gitlab-ci"]);
    });

    it("respects custom ci_username", async () => {
      const plugin = createPlugin({ ci_username: "my-ci-bot" });
      const token = await buildJwt();
      const result = await authenticate(plugin, "my-ci-bot", token);

      expect(result.err).toBeNull();
      expect(result.groups).toContain("gitlab-ci");
    });

    it("adds project groups when project_groups is enabled", async () => {
      const plugin = createPlugin({ project_groups: true });
      const token = await buildJwt({
        namespace_path: "my-group",
        project_path: "my-group/my-project",
      });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toContain("gitlab-ci");
      expect(result.groups).toContain("gitlab:my-group");
      expect(result.groups).toContain("gitlab:my-group/my-project");
    });

    it("omits project groups when project_groups is disabled (default)", async () => {
      const plugin = createPlugin();
      const token = await buildJwt({
        namespace_path: "my-group",
        project_path: "my-group/my-project",
      });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toEqual(["gitlab-ci", "gitlab-ci-protected"]);
    });
  });

  describe("authenticate — invalid JWT", () => {
    it("returns false for an expired token", async () => {
      const plugin = createPlugin();
      const token = await buildJwt({}, { expiresIn: "-1s" });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for wrong audience", async () => {
      const plugin = createPlugin();
      const token = await buildJwt({ aud: "https://wrong.example.com" } as any);
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for wrong issuer", async () => {
      const plugin = createPlugin();
      const token = await buildJwt({ iss: "https://evil.example.com" } as any);
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for a malformed token", async () => {
      const plugin = createPlugin();
      const result = await authenticate(plugin, "gitlab-oidc", "not-a-jwt");

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for an empty password", async () => {
      const plugin = createPlugin();
      const result = await authenticate(plugin, "gitlab-oidc", "");

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });
  });

  describe("adduser", () => {
    it("delegates to next plugin (returns false)", () => {
      const plugin = createPlugin();
      return new Promise<void>((resolve) => {
        plugin.adduser("anyone", "password", (err, ok) => {
          expect(err).toBeNull();
          expect(ok).toBe(false);
          resolve();
        });
      });
    });
  });
});
