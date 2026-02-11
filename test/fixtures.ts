/**
 * Test vectors: JWT claim fixtures for GitLab OIDC ID tokens.
 *
 * Each fixture represents a realistic CI scenario with the expected
 * authorization outcome. The `iss`, `aud`, `exp`, and `iat` fields are
 * omitted here — they are set dynamically by the test helper that signs
 * the JWT.
 *
 * When building the Reposilite plugin, recreate equivalent fixtures there
 * so both plugins agree on how each scenario maps to authorization decisions.
 */
import type { GitLabJwtClaims } from "../src/types";

/** Claims that vary per scenario (standard JWT fields set at sign time). */
export type ClaimFixture = Omit<GitLabJwtClaims, "iss" | "aud" | "exp" | "iat">;

export interface TestVector {
  /** Short human-readable name for the scenario. */
  name: string;
  /** JWT claims (minus iss/aud/exp/iat which are set at sign time). */
  claims: ClaimFixture;
  /** Whether this token represents a protected ref. */
  expectProtected: boolean;
  /** Expected Verdaccio groups (with project_groups disabled). */
  expectedGroups: string[];
  /** Expected Verdaccio groups (with project_groups enabled). */
  expectedGroupsWithProjects: string[];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Push to a protected branch (main) from a top-level group project. */
export const PROTECTED_BRANCH_PUSH: TestVector = {
  name: "protected branch push",
  claims: {
    sub: "project_path:my-group/my-project:ref_type:branch:ref:main",
    ref: "main",
    ref_type: "branch",
    ref_protected: "true",
    project_id: "42",
    project_path: "my-group/my-project",
    namespace_path: "my-group",
    user_login: "ci-bot",
    pipeline_source: "push",
    job_id: "10001",
  },
  expectProtected: true,
  expectedGroups: ["gitlab-ci", "gitlab-ci-protected"],
  expectedGroupsWithProjects: [
    "gitlab-ci",
    "gitlab-ci-protected",
    "gitlab-ci:my-group",
    "gitlab-ci-protected:my-group",
    "gitlab-ci:my-group/my-project",
    "gitlab-ci-protected:my-group/my-project",
  ],
};

/** Push to an unprotected feature branch. */
export const FEATURE_BRANCH_PUSH: TestVector = {
  name: "feature branch push",
  claims: {
    sub: "project_path:my-group/my-project:ref_type:branch:ref:feature/foo",
    ref: "feature/foo",
    ref_type: "branch",
    ref_protected: "false",
    project_id: "42",
    project_path: "my-group/my-project",
    namespace_path: "my-group",
    user_login: "developer",
    pipeline_source: "push",
    job_id: "10002",
  },
  expectProtected: false,
  expectedGroups: ["gitlab-ci"],
  expectedGroupsWithProjects: [
    "gitlab-ci",
    "gitlab-ci:my-group",
    "gitlab-ci:my-group/my-project",
  ],
};

/** Protected tag (release). */
export const PROTECTED_TAG: TestVector = {
  name: "protected tag",
  claims: {
    sub: "project_path:my-group/my-project:ref_type:tag:ref:v1.0.0",
    ref: "v1.0.0",
    ref_type: "tag",
    ref_protected: "true",
    project_id: "42",
    project_path: "my-group/my-project",
    namespace_path: "my-group",
    user_login: "release-bot",
    pipeline_source: "push",
    job_id: "10003",
  },
  expectProtected: true,
  expectedGroups: ["gitlab-ci", "gitlab-ci-protected"],
  expectedGroupsWithProjects: [
    "gitlab-ci",
    "gitlab-ci-protected",
    "gitlab-ci:my-group",
    "gitlab-ci-protected:my-group",
    "gitlab-ci:my-group/my-project",
    "gitlab-ci-protected:my-group/my-project",
  ],
};

/** Merge request pipeline (unprotected by definition). */
export const MERGE_REQUEST_PIPELINE: TestVector = {
  name: "merge request pipeline",
  claims: {
    sub: "project_path:my-group/my-project:ref_type:branch:ref:feature/bar",
    ref: "feature/bar",
    ref_type: "branch",
    ref_protected: "false",
    project_id: "42",
    project_path: "my-group/my-project",
    namespace_path: "my-group",
    user_login: "developer",
    pipeline_source: "merge_request_event",
    job_id: "10004",
  },
  expectProtected: false,
  expectedGroups: ["gitlab-ci"],
  expectedGroupsWithProjects: [
    "gitlab-ci",
    "gitlab-ci:my-group",
    "gitlab-ci:my-group/my-project",
  ],
};

/** Nested subgroup project (e.g. my-org/team-a/libs/core). */
export const NESTED_SUBGROUP: TestVector = {
  name: "nested subgroup project",
  claims: {
    sub: "project_path:my-org/team-a/libs/core:ref_type:branch:ref:main",
    ref: "main",
    ref_type: "branch",
    ref_protected: "true",
    project_id: "99",
    project_path: "my-org/team-a/libs/core",
    namespace_path: "my-org/team-a/libs",
    user_login: "ci-bot",
    pipeline_source: "push",
    job_id: "10005",
  },
  expectProtected: true,
  expectedGroups: ["gitlab-ci", "gitlab-ci-protected"],
  expectedGroupsWithProjects: [
    "gitlab-ci",
    "gitlab-ci-protected",
    "gitlab-ci:my-org/team-a/libs",
    "gitlab-ci-protected:my-org/team-a/libs",
    "gitlab-ci:my-org/team-a/libs/core",
    "gitlab-ci-protected:my-org/team-a/libs/core",
  ],
};

/** All test vectors for iteration. */
export const ALL_VECTORS: TestVector[] = [
  PROTECTED_BRANCH_PUSH,
  FEATURE_BRANCH_PUSH,
  PROTECTED_TAG,
  MERGE_REQUEST_PIPELINE,
  NESTED_SUBGROUP,
];
