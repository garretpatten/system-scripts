# Runtime Configuration

Scripts that apply consistent package-manager settings on a machine. Each
target file lives under your home directory; the script creates or updates
entries only when the current value is below the configured minimum.

## `runtime-configurations.sh`

Sets a **7-day minimum release age** across common Ruby, Node, and Python
tooling so newly published packages are not installed immediately.

### Targets

| Tool    | File                    | Setting             | Value    |
| ------- | ----------------------- | ------------------- | -------- |
| Bundler | `~/.bundle/config`      | `BUNDLE_COOLDOWN`   | `"7"`    |
| npm     | `~/.npmrc`              | `min-release-age`   | `7`      |
| pip     | `~/.config/pip/pip.ini` | `uploaded-prior-to` | `P7D`    |
| uv      | `~/.config/uv/uv.toml`  | `exclude-newer`     | `7 days` |

### Behavior

For each target file the script:

1. **Creates** the file (and parent directories) if it does not exist.
2. **Appends** the setting if the file exists but the key is missing.
3. **Updates** the setting only when the current numeric value is less than 7.
4. **Skips** when the value is already 7 or higher (never downgrades).

When a file is updated in place, a `.bak` backup is written next to the
original.

### Requirements

- **bash** 4.0+
- Standard Unix utilities: `grep`, `sed`, `awk`, `mkdir`

### Usage

```bash
chmod +x configuration/runtime-configurations.sh
./configuration/runtime-configurations.sh
```

The script prints what it created, appended, updated, or left unchanged, then
exits with `Done.`
