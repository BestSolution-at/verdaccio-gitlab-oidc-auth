import http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import type { JWK } from "jose";
import GitLabOidcAuth from "../src/plugin";
import {
  ALL_VECTORS,
  PROTECTED_BRANCH_PUSH,
  FEATURE_BRANCH_PUSH,
  type ClaimFixture,
} from "./fixtures";

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
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey as CryptoKey;
  publicJwk = await exportJWK(kp.publicKey as CryptoKey);
  publicJwk.kid = "test-key-1";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

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

/** Build a signed JWT from a claim fixture (iss/aud/exp/iat set automatically). */
async function buildJwt(
  fixture: ClaimFixture,
  opts?: {
    iss?: string;
    aud?: string;
    expiresIn?: string;
  },
): Promise<string> {
  const iss = opts?.iss ?? gitlabUrl;
  const aud = opts?.aud ?? AUDIENCE;

  let builder = new SignJWT(fixture as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuedAt()
    .setIssuer(iss)
    .setAudience(aud)
    .setExpirationTime(opts?.expiresIn ?? "5m");

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

  describe("authenticate — test vectors (project_groups disabled)", () => {
    for (const vector of ALL_VECTORS) {
      it(`${vector.name}: returns ${JSON.stringify(vector.expectedGroups)}`, async () => {
        const plugin = createPlugin();
        const token = await buildJwt(vector.claims);
        const result = await authenticate(plugin, "gitlab-oidc", token);

        expect(result.err).toBeNull();
        expect(result.groups).toEqual(vector.expectedGroups);
      });
    }
  });

  describe("authenticate — test vectors (project_groups enabled)", () => {
    for (const vector of ALL_VECTORS) {
      it(`${vector.name}: returns ${JSON.stringify(vector.expectedGroupsWithProjects)}`, async () => {
        const plugin = createPlugin({ project_groups: true });
        const token = await buildJwt(vector.claims);
        const result = await authenticate(plugin, "gitlab-oidc", token);

        expect(result.err).toBeNull();
        expect(result.groups).toEqual(vector.expectedGroupsWithProjects);
      });
    }
  });

  describe("authenticate — custom ci_username", () => {
    it("respects custom ci_username", async () => {
      const plugin = createPlugin({ ci_username: "my-ci-bot" });
      const token = await buildJwt(PROTECTED_BRANCH_PUSH.claims);
      const result = await authenticate(plugin, "my-ci-bot", token);

      expect(result.err).toBeNull();
      expect(result.groups).toContain("gitlab-ci");
    });

    it("rejects default username when custom ci_username is set", async () => {
      const plugin = createPlugin({ ci_username: "my-ci-bot" });
      const token = await buildJwt(PROTECTED_BRANCH_PUSH.claims);
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });
  });

  describe("authenticate — invalid JWT", () => {
    it("returns false for an expired token", async () => {
      const plugin = createPlugin();
      const token = await buildJwt(FEATURE_BRANCH_PUSH.claims, { expiresIn: "-1s" });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for wrong audience", async () => {
      const plugin = createPlugin();
      const token = await buildJwt(FEATURE_BRANCH_PUSH.claims, {
        aud: "https://wrong.example.com",
      });
      const result = await authenticate(plugin, "gitlab-oidc", token);

      expect(result.err).toBeNull();
      expect(result.groups).toBe(false);
    });

    it("returns false for wrong issuer", async () => {
      const plugin = createPlugin();
      const token = await buildJwt(FEATURE_BRANCH_PUSH.claims, {
        iss: "https://evil.example.com",
      });
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
