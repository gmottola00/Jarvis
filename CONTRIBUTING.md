# Contributing to Ultron

Thanks for your interest! Ultron started as a personal home-lab agent, so the
project is opinionated, but fixes and improvements are welcome.

## Ground rule

Ultron must never gain a way to change the cluster directly. Contributions that
add `apply`, `patch`, `delete` or `scale` style tools will not be merged; the
test suite checks for them. Changes go through commits and pull requests.

## Getting started

Requires Python 3.12, [uv](https://docs.astral.sh/uv/) and Node 22.

```bash
make setup    # venv, dependencies, dashboard, .env
make run      # dashboard + API on http://localhost:8100
```

No cluster or credentials are needed: with `JARVIS_FAKE_TOOLS=true` (the default
in `.env.example`) every capability is served from fixtures. Add
`ANTHROPIC_API_KEY` to `.env` to try the chat.

## Before opening a PR

```bash
make check        # format-check, lint, typecheck, tests (what CI runs)
make web-lint web-typecheck
```

- Add or update tests for behaviour changes.
- New integrations follow the layout in `src/jarvis/tools/<name>/`:
  `client.py`, `fake.py`, `tools.py`. Always ship a fake so the project stays
  runnable offline.
- Keep commits focused, with [Conventional Commit](https://www.conventionalcommits.org/)
  messages (`feat(web): …`, `fix(push): …`).

## Reporting bugs

Open an issue with what you expected, what happened, and how to reproduce it.
For security problems, see [SECURITY.md](SECURITY.md) instead.

## License

By contributing you agree that your work is released under the [MIT License](LICENSE).
