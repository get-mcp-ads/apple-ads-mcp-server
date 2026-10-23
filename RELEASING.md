# Publishing releases

A version tag drives the whole release. The [Release workflow](.github/workflows/release.yml) publishes npm, then the GitHub release, then the MCP Registry entry, in the order the registry requires.

1. Bump the version in `package.json`, `server.json` (both the top-level `version` and the npm package entry) and `PACKAGE_VERSION` in `src/server.ts`. The test suite fails when the three disagree.
2. Add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`. The workflow uses it as the release notes and stops when it is missing.
3. Run `npm run catalog` to regenerate `server-card.json`, then merge the reviewed change after CI succeeds.
4. Tag the merged commit `vX.Y.Z` and push the tag. The workflow then:
   - checks that the tag matches `package.json`, and runs the audit, typecheck, build and tests;
   - publishes the npm package with provenance through npm trusted publishing, with no stored npm token;
   - creates the GitHub release from the changelog section and marks it as Latest;
   - publishes `server.json` to the MCP Registry under `com.getmcpads/apple-ads`, authenticated by the getmcpads.com DNS key.
5. Each step skips when its target already holds the version, so rerunning the workflow for an existing tag (Actions > Release > Run workflow) completes a partial release safely.

Before the first release, configure a trusted publisher on npmjs.com for `@getmcpads/apple-ads-mcp-server` that points at this repository and `release.yml`, and set the `MCP_DNS_PRIVATE_KEY` repository secret.
