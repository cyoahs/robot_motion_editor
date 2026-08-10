#!/usr/bin/env bash
set -e

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if ! command -v nvm >/dev/null 2>&1 && [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # NVM is normally loaded only by interactive shells on this machine.
  . "${HOME}/.nvm/nvm.sh"
fi

if command -v nvm >/dev/null 2>&1; then
  nvm use
fi

npm run dev
