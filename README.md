# bb-plugin-composer-voice

bb's built-in composer, plus a rebindable voice-input shortcut.

- **Mod+D** toggles voice recording. Press it again to stop and put the
  transcript in the draft.
- **Enter** while recording stops, transcribes, and sends.
- **Esc** still cancels.

The shortcut is a normal composer command — rebind it under Settings →
Keyboard shortcuts as **"Toggle voice input"**.

This is bb's own composer with a small patch on top: it registers the
command (`app.tsx`), routes it to the active composer
(`src/voice-input-command.ts`), and handles Enter/Esc while recording
(`src/PromptBoxInternal.tsx`). Everything else is upstream, synced from
[`get-bb/bb`](https://github.com/get-bb/bb)'s `plugins/composer`
(tag in [`UPSTREAM`](UPSTREAM)) with the UI it imports vendored from bb's
component registry. It replaces the older
[frrad/bb-plugin-composer-waveform](https://github.com/frrad/bb-plugin-composer-waveform)
fork repo with the same plugin in a standalone package.

An installed composer wins over the bundled one under
Settings → Appearance → Composer when set to **Automatic**. Pick
"Composer" there to go back to bb's own.

## Install

```sh
bb plugin install git:https://github.com/frrad/bb-plugin-composer-voice.git@main --yes
```

Update after a compatible change lands on `main`:

```sh
bb plugin update composer-waveform --yes
```

The package name stays `bb-plugin-composer-waveform`, so the plugin id is
still `composer-waveform`. That keeps existing keyboard-shortcut overrides
like `plugin:composer-waveform/start-voice-input` working; bundled plugin
ids are reserved, so a renamed copy could not keep this one's bindings.

Supports bb 0.49.x (`engines.bb` is pinned per release).

## Updating to a new bb release

```sh
sync/sync.sh desktop-v0.49.0   # the new bb tag
```

The script fetches the composer plugin (and the pieces needed to vendor its
UI) at the tag in `UPSTREAM` and at the new tag, re-applies this repo's
changes on top with a 3-way merge — stopping before touching anything on a
conflict — and refreshes `package.json`, `UPSTREAM`, and the lockfile. It
then reinstalls, typechecks, tests, and runs `bb plugin build .`. Review the
diff and commit.

## Development

```sh
npm install --ignore-scripts
npm run typecheck
npm test
bb plugin build .
```

`npm run lint` needs `oxlint`, which the bb monorepo provides at its root;
run `npx oxlint@latest --ignore-pattern node_modules --ignore-pattern dist .`
in a plain checkout.
