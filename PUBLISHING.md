# Publishing Node.js Notebooks Extended

## Prerequisites

- Use the `dannyvernovsky` publisher at <https://marketplace.visualstudio.com/manage>.
- Keep `LICENSE` unchanged. The README and changelog credit Don Jayamanne and the original project.
- Use a Node.js version supported by the dependency toolchain. On macOS ARM64, install dependencies without lifecycle scripts because the legacy TensorFlow native package does not provide a compatible binary.

## Install

Behind the AT&T proxy:

```bash
HTTP_PROXY=http://cso.proxy.att.com:8888 \
HTTPS_PROXY=http://cso.proxy.att.com:8888 \
npm ci --ignore-scripts --legacy-peer-deps
```

## Validate and package

```bash
npm run build
npm run package
code-insiders --install-extension nodejs-notebooks-extended.vsix
```

Open an `*.nnb` file and verify JavaScript/TypeScript execution, cross-cell type diagnostics, debugging, and any visualization features intended for the release. Disable the original extension while testing because both extensions recognize `*.nnb` files.

## Publish manually

Create an Azure DevOps personal access token with **All accessible organizations** and **Marketplace: Manage**, then authenticate without putting the token in source control:

```bash
npx vsce login dannyvernovsky
npx vsce publish --packagePath nodejs-notebooks-extended.vsix
```

Microsoft plans to retire global Azure DevOps PATs on December 1, 2026. For automated releases, use Microsoft Entra workload identity federation and `vsce publish --azure-credential` instead.

## Release checklist

1. Update `version` in `package.json` and add release notes to `CHANGELOG.md`.
2. Run the validation and packaging commands above.
3. Inspect the generated VSIX with `unzip -l nodejs-notebooks-extended.vsix`.
4. Install and smoke-test the VSIX in an isolated VS Code profile.
5. Publish the exact tested VSIX.
