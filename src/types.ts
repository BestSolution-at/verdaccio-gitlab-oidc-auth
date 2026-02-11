/**
 * Plugin configuration as specified in Verdaccio's config.yaml:
 *
 * auth:
 *   gitlab-oidc-auth:
 *     gitlab_url: https://gitlab.example.com
 *     audience: https://npm.example.com
 *     ci_username: gitlab-oidc          # optional, default: "gitlab-oidc"
 *     jwks_cache_ttl: 86400             # optional, default: 86400 (seconds)
 *     project_groups: false             # optional, default: false
 */
export interface PluginConfig {
  gitlab_url: string;
  audience: string;
  ci_username?: string;
  jwks_cache_ttl?: number;
  project_groups?: boolean;
}

/**
 * Subset of GitLab OIDC ID token claims relevant for authorization.
 * See: https://docs.gitlab.com/ci/secrets/id_token_authentication/
 */
export interface GitLabJwtClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  ref: string;
  ref_type: string;
  ref_protected: string; // "true" or "false" (string in JWT)
  project_id: number;
  project_path: string;
  namespace_path: string;
  user_login: string;
  pipeline_source: string;
  job_id: string;
}

export const DEFAULT_CI_USERNAME = "gitlab-oidc";
export const DEFAULT_JWKS_CACHE_TTL = 86400;
