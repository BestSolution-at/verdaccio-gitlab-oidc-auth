# @bestsolution/verdaccio-gitlab-oidc-auth

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

Every valid JWT receives the base group `gitlab-ci`. Additional groups depend
on branch/tag protection status and the `project_groups` configuration option.

### Base Groups (always assigned)

| Condition | Group |
|-----------|-------|
| Every valid JWT | `gitlab-ci` |
| JWT with `ref_protected: "true"` | `gitlab-ci-protected` |

### Project Groups (when `project_groups: true`)

When `project_groups` is enabled, the plugin derives additional groups from
the `namespace_path` and `project_path` JWT claims. These groups include
composite variants that combine project identity with branch/tag protection
status.

| Condition | Group |
|-----------|-------|
| Every valid JWT | `gitlab-ci:<namespace_path>` |
| Every valid JWT | `gitlab-ci:<project_path>` |
| JWT with `ref_protected: "true"` | `gitlab-ci-protected:<namespace_path>` |
| JWT with `ref_protected: "true"` | `gitlab-ci-protected:<project_path>` |

### Examples

**Protected branch/tag push** from project `my-group/my-project` on `main`
(with `project_groups: true`):

```text
gitlab-ci
gitlab-ci-protected
gitlab-ci:my-group
gitlab-ci-protected:my-group
gitlab-ci:my-group/my-project
gitlab-ci-protected:my-group/my-project
```

**Feature branch/tag push** from the same project on `feature/foo`
(with `project_groups: true`):

```text
gitlab-ci
gitlab-ci:my-group
gitlab-ci:my-group/my-project
```

Note: feature branches/tags are not protected, so no `gitlab-ci-protected` groups
are assigned. This distinction is critical for controlling who can publish
packages (see [Authorization](#authorization) below).

**Nested subgroup project** `my-org/team-a/libs/core` on protected branch `main`
(with `project_groups: true`):

```text
gitlab-ci
gitlab-ci-protected
gitlab-ci:my-org/team-a/libs
gitlab-ci-protected:my-org/team-a/libs
gitlab-ci:my-org/team-a/libs/core
gitlab-ci-protected:my-org/team-a/libs/core
```

## Installation

```bash
npm install @bestsolution/verdaccio-gitlab-oidc-auth
```

## Configuration

In your Verdaccio `config.yaml`:

```yaml
auth:
  "@bestsolution/verdaccio-gitlab-oidc-auth":
    gitlab_url: https://gitlab.example.com
    audience: https://npm.example.com
    # ci_username: gitlab-oidc          # optional, default: "gitlab-oidc"
    # jwks_cache_ttl: 86400             # optional, default: 86400 (seconds)
    # project_groups: false             # optional, default: false
  htpasswd:
    file: ./htpasswd
```

The plugin **must** appear before `htpasswd` in the `auth:` section so that
CI tokens are verified first. Non-CI usernames fall through to htpasswd.

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `gitlab_url` | yes | -- | GitLab instance URL (e.g. `https://gitlab.example.com`) |
| `audience` | yes | -- | Expected `aud` claim in the JWT (must match `aud` in GitLab `id_tokens`) |
| `ci_username` | no | `gitlab-oidc` | Username that triggers OIDC authentication |
| `jwks_cache_ttl` | no | `86400` | How long to cache the JWKS keys (seconds) |
| `project_groups` | no | `false` | Derive project-level and namespace-level groups from JWT claims (see [Project Groups](#project-groups-when-project_groups-true)) |

## Authorization

The plugin itself does **not** implement authorization. It returns groups, and
Verdaccio's built-in `packages:` configuration controls which groups can
access or publish to which scopes.

### Understanding Verdaccio's Group Matching

Verdaccio's `publish:` (and `access:`) fields accept a space-separated list of
groups. A user is authorized if they belong to **any** of the listed groups
(OR logic). There is no AND logic.

For example:

```yaml
publish: gitlab-ci-protected tom
```

This means: allow publishing if the user has the `gitlab-ci-protected` group
**OR** is the user `tom`. This is important to understand when designing your
access control rules.

### Package Access Examples

#### Simple: Any Protected CI Build Can Publish

```yaml
packages:
  "@my-scope/*":
    access: $authenticated
    publish: gitlab-ci-protected deploy-admin
```

Any CI job running on a protected branch or protected tag (from any GitLab project)
can publish to `@my-scope/*`. This is simple but does not isolate projects from
each other.

#### Project-Level Isolation

With `project_groups: true`, you can restrict publishing to specific projects:

```yaml
packages:
  "@my-scope/*":
    access: $authenticated
    publish: gitlab-ci-protected:my-group/my-project deploy-admin
```

Only protected-branch/tag CI jobs from `my-group/my-project` can publish to
`@my-scope/*`. A protected-branch/tag build from `other-group/other-project`
cannot publish here, even though it also has `gitlab-ci-protected`.

#### Namespace-Level Isolation

Restrict publishing to any project within a GitLab group:

```yaml
packages:
  "@my-scope/*":
    access: $authenticated
    publish: gitlab-ci-protected:my-group deploy-admin
```

Any project under the `my-group` namespace (on a protected branch/tag) can publish.

#### Multiple Scopes With Different Policies

```yaml
packages:
  "@internal/*":
    access: $authenticated
    publish: gitlab-ci-protected:my-org/team-a/libs deploy-admin

  "@shared/*":
    access: $authenticated
    publish: gitlab-ci-protected:my-org deploy-admin

  "**":
    access: $all
    publish: deploy-admin
    proxy: npmjs
```

### Security Considerations

- **Branch/tag protection matters**: Only branches and tags marked as "protected"
  in GitLab produce the `gitlab-ci-protected` groups. Without `project_groups`,
  any project with a protected branch/tag can publish to scopes that require
  `gitlab-ci-protected`. Enable `project_groups: true` and use composite groups
  (e.g. `gitlab-ci-protected:my-group/my-project`) to restrict publishing to
  specific projects.

- **No long-lived credentials**: OIDC tokens are short-lived JWTs (typically
  5 minutes). They cannot be reused after expiry and do not need to be rotated
  or revoked manually.

- **Cryptographic verification only**: The plugin verifies JWT signatures
  against the GitLab JWKS endpoint. It does not make API calls to GitLab and
  does not require network access beyond the JWKS endpoint.

- **JWKS caching**: Public keys are cached in memory. The cache is refreshed
  when an unknown `kid` is encountered (key rotation) or after the configured
  TTL expires.

## GitLab CI Usage

The plugin only supports (and requires) Basic Auth:

```yaml
publish:
  image: node:22
  id_tokens:
    VERDACCIO_TOKEN:
      aud: https://npm.example.com
  script:
    - AUTH=$(echo -n "gitlab-oidc:${VERDACCIO_TOKEN}" | base64 -w0)
    - echo "//${VERDACCIO_HOST}/:_auth=${AUTH}" > .npmrc
    - npm publish
```

> **Note**: The `id_tokens` keyword requires GitLab 15.7 or later.

## Development

```bash
npm install
npm run build
npm test
```

## License

GPL-3.0-only
