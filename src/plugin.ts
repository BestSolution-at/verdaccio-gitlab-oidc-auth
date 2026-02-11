import { pluginUtils } from "@verdaccio/core";
import { Logger } from "@verdaccio/types";
import { jwtVerify, createRemoteJWKSet } from "jose";

import {
  PluginConfig,
  GitLabJwtClaims,
  DEFAULT_CI_USERNAME,
  DEFAULT_JWKS_CACHE_TTL,
} from "./types";

export default class GitLabOidcAuth
  extends pluginUtils.Plugin<PluginConfig>
  implements pluginUtils.Auth<PluginConfig>
{
  private readonly logger: Logger;
  private readonly gitlabUrl: string;
  private readonly audience: string;
  private readonly ciUsername: string;
  private readonly jwksCacheTtl: number;
  private readonly projectGroups: boolean;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  public constructor(config: PluginConfig, options: pluginUtils.PluginOptions) {
    super(config, options);
    this.logger = options.logger;

    if (!config.gitlab_url) {
      throw new Error(
        "verdaccio-gitlab-oidc-auth: 'gitlab_url' is required in plugin configuration",
      );
    }
    if (!config.audience) {
      throw new Error(
        "verdaccio-gitlab-oidc-auth: 'audience' is required in plugin configuration",
      );
    }

    this.gitlabUrl = config.gitlab_url.replace(/\/+$/, "");
    this.audience = config.audience;
    this.ciUsername = config.ci_username ?? DEFAULT_CI_USERNAME;
    this.jwksCacheTtl = config.jwks_cache_ttl ?? DEFAULT_JWKS_CACHE_TTL;
    this.projectGroups = config.project_groups ?? false;

    this.logger.info(
      { gitlab_url: this.gitlabUrl, audience: this.audience },
      "gitlab-oidc-auth: initialized (gitlab_url=@{gitlab_url}, audience=@{audience})",
    );
  }

  /**
   * Authenticate a user. If the username matches the configured CI username,
   * treat the password as a GitLab OIDC JWT and verify it. Otherwise, pass
   * through to the next auth plugin in the chain.
   */
  public authenticate(
    user: string,
    password: string,
    cb: pluginUtils.AuthCallback,
  ): void {
    if (user !== this.ciUsername) {
      // Not a CI request — pass to next plugin (htpasswd)
      cb(null, false);
      return;
    }

    this.verifyAndAuthenticate(password)
      .then((groups) => cb(null, groups))
      .catch((err) => {
        this.logger.warn(
          { error: err.message },
          "gitlab-oidc-auth: authentication failed — @{error}",
        );
        cb(null, false);
      });
  }

  /**
   * Verify the JWT and return Verdaccio groups on success.
   */
  private async verifyAndAuthenticate(token: string): Promise<string[]> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(
        new URL(`${this.gitlabUrl}/oauth/discovery/keys`),
        { cacheMaxAge: this.jwksCacheTtl * 1000 },
      );
    }

    const { payload } = await jwtVerify<GitLabJwtClaims>(token, this.jwks, {
      algorithms: ["RS256"],
      issuer: this.gitlabUrl,
      audience: this.audience,
    });

    this.logger.info(
      { project: payload.project_path, ref: payload.ref, job: payload.job_id },
      "gitlab-oidc-auth: verified token for @{project} ref=@{ref} job=@{job}",
    );

    return this.deriveGroups(payload);
  }

  /**
   * Derive Verdaccio groups from verified JWT claims.
   */
  private deriveGroups(claims: GitLabJwtClaims): string[] {
    const groups: string[] = ["gitlab-ci"];

    if (claims.ref_protected === "true") {
      groups.push("gitlab-ci-protected");
    }

    if (this.projectGroups) {
      if (claims.namespace_path) {
        groups.push(`gitlab:${claims.namespace_path}`);
      }
      if (claims.project_path) {
        groups.push(`gitlab:${claims.project_path}`);
      }
    }

    return groups;
  }

  /**
   * Delegate user creation to the next plugin (htpasswd).
   */
  public adduser(
    _user: string,
    _password: string,
    cb: pluginUtils.AuthUserCallback,
  ): void {
    cb(null, false);
  }
}
