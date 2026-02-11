# verdaccio-gitlab-oidc-auth

A [Verdaccio](https://verdaccio.org/) auth plugin that authenticates GitLab CI
jobs using [OIDC ID tokens](https://docs.gitlab.com/ci/secrets/id_token_authentication/).

GitLab CI pipelines present a short-lived JWT as the password via HTTP Basic
Auth. The plugin verifies the token cryptographically against the GitLab JWKS
endpoint and derives Verdaccio groups from the JWT claims. This allows
fine-grained package access control without long-lived credentials.

## How It Works

1. GitLab CI job requests an OIDC ID token (`id_tokens` keyword, GitLab 15.7+)
2. The job authenticates to Verdaccio using HTTP Basic Auth:
   - **username**: `gitlab-oidc` (configurable)
   - **password**: the OIDC JWT
3. The plugin verifies the JWT signature via the GitLab JWKS endpoint
4. On success, the plugin returns Verdaccio groups derived from the JWT claims
5. Non-CI users (any other username) pass through to the next auth plugin
   (typically htpasswd)

## Groups

Every valid JWT grants the `gitlab-ci` group. Additional groups are derived
from JWT claims:

| Condition | Group |
|-----------|-------|
| Always | `gitlab-ci` |
| `ref_protected` is `"true"` | `gitlab-ci-protected` |
| `project_groups` enabled | `gitlab:<namespace_path>` |
| `project_groups` enabled | `gitlab:<project_path>` |

## Installation

```bash
npm install verdaccio-gitlab-oidc-auth
```

## Configuration

In your Verdaccio `config.yaml`:

```yaml
auth:
  gitlab-oidc-auth:
    gitlab_url: https://gitlab.example.com
    audience: https://npm.example.com
    # ci_username: gitlab-oidc          # optional, default: "gitlab-oidc"
    # jwks_cache_ttl: 86400             # optional, default: 86400 (seconds)
    # project_groups: false             # optional, default: false
  htpasswd:
    file: ./htpasswd
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `gitlab_url` | yes | — | GitLab instance URL (e.g. `https://gitlab.example.com`) |
| `audience` | yes | — | Expected `aud` claim in the JWT (must match `aud` in GitLab `id_tokens`) |
| `ci_username` | no | `gitlab-oidc` | Username that triggers OIDC authentication |
| `jwks_cache_ttl` | no | `86400` | How long to cache the JWKS keys (seconds) |
| `project_groups` | no | `false` | Add `gitlab:<namespace>` and `gitlab:<project>` groups |

### Package Access Example

```yaml
packages:
  "@private/*":
    access: gitlab-ci-protected
    publish: gitlab-ci-protected

  "**":
    access: $authenticated
    publish: $authenticated
```

## GitLab CI Usage

```yaml
publish:
  image: node:22
  id_tokens:
    VERDACCIO_TOKEN:
      aud: https://npm.example.com
  script:
    - echo "//${VERDACCIO_HOST}/:_authToken=${VERDACCIO_TOKEN}" > .npmrc
    - npm publish
```

> **Note**: The `id_tokens` keyword requires GitLab 15.7 or later.

For HTTP Basic Auth (e.g. with `npm adduser` or `.npmrc` `_auth`):

```yaml
publish:
  image: node:22
  id_tokens:
    VERDACCIO_TOKEN:
      aud: https://npm.example.com
  script:
    - AUTH=$(echo -n "gitlab-oidc:${VERDACCIO_TOKEN}" | base64)
    - echo "//${VERDACCIO_HOST}/:_auth=${AUTH}" > .npmrc
    - npm publish
```

## Development

```bash
npm install
npm run build
npm test
```

## License

GPL-3.0-only
