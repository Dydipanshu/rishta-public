#!/usr/bin/env bash
# Publishes Rishta to a Hugging Face Docker Space. Nothing is built here: Hugging Face builds it.
# The Space holds only a README and a Dockerfile that fetches this repo from GitHub at one exact commit,
# so the repo must be public and the commit pushed first.
#
#   HF_USER=you HF_TOKEN=hf_xxx pnpm deploy:hf
#   Optional: SPACE=rishta  BRANCH=public-site  GITHUB_REPO=Dydipanshu/rishta
set -euo pipefail

: "${HF_USER:?set HF_USER to your Hugging Face username}"
: "${HF_TOKEN:?set HF_TOKEN to a Hugging Face token with write access}"
SPACE="${SPACE:-rishta}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
GITHUB_REPO="${GITHUB_REPO:-Dydipanshu/rishta}"
GIT_URL="https://github.com/$GITHUB_REPO.git"

SHA="$(git ls-remote "$GIT_URL" "refs/heads/$BRANCH" | cut -f1)"
[ -n "$SHA" ] || { echo "Branch $BRANCH is not on GitHub. Push it first."; exit 1; }
# Asked without credentials, so this only passes when anyone, including Hugging Face, can read the repo.
env -u GITHUB_TOKEN curl -fsSI "https://github.com/$GITHUB_REPO/commit/$SHA" >/dev/null \
  || { echo "GitHub repo is not public yet, so Hugging Face cannot fetch it."; exit 1; }

# The token goes through stdin so it never shows up in a process list.
create_status="$(printf 'Authorization: Bearer %s\n' "$HF_TOKEN" | curl -sS -o /dev/null -w '%{http_code}' \
  -H @- -H 'Content-Type: application/json' -X POST https://huggingface.co/api/repos/create \
  -d "{\"type\":\"space\",\"name\":\"$SPACE\",\"sdk\":\"docker\",\"private\":false}")"
case "$create_status" in
  200|201) echo "Created Space $HF_USER/$SPACE" ;;
  409) echo "Space $HF_USER/$SPACE already exists, updating it" ;;
  *) echo "Hugging Face refused to create the Space (HTTP $create_status)."
     echo "Docker Spaces need a paid plan on Hugging Face. See DEPLOY.md."
     exit 1 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Reads the token from the environment when git asks, so it is never saved in the clone.
hf_git() {
  git -c credential.helper= \
    -c 'credential.helper=!f() { echo "username=$HF_USER"; echo "password=$HF_TOKEN"; }; f' "$@"
}
export HF_USER HF_TOKEN
hf_git clone -q "https://huggingface.co/spaces/$HF_USER/$SPACE" "$work/space"

cat > "$work/space/README.md" <<README
---
title: Rishta
emoji: 🤝
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

Rishta for the Paytm Build for India AI Hackathon. Built from https://github.com/$GITHUB_REPO at $SHA.
README

# Same Dockerfile as the repo, except the source comes from GitHub at this commit.
# A new commit changes this line, which makes Hugging Face rebuild from fresh code.
fetch="RUN git init -q \&\& git fetch -q --depth 1 $GIT_URL $SHA \&\& git checkout -q FETCH_HEAD \&\& rm -rf .git"
sed -e 's/--no-install-recommends python3 make g++/--no-install-recommends git ca-certificates python3 make g++/' \
    -e "s|^COPY package.json pnpm-lock.yaml ./\$|$fetch|" \
    -e '/^COPY \. \.$/d' \
    Dockerfile > "$work/space/Dockerfile"
grep -q 'git fetch' "$work/space/Dockerfile" && ! grep -q '^COPY \. \.$' "$work/space/Dockerfile" \
  || { echo "Could not rewrite the Dockerfile. Its COPY lines have changed."; exit 1; }

cd "$work/space"
git add README.md Dockerfile
if git diff --cached --quiet; then
  echo "Space is already on $SHA, nothing to do."
  exit 0
fi
git -c user.name="$HF_USER" -c user.email="$HF_USER@users.noreply.huggingface.co" commit -qm "Deploy $SHA"
hf_git push -q origin HEAD:main

echo "Pushed. Build logs: https://huggingface.co/spaces/$HF_USER/$SPACE"
echo "Site, when built:  https://$HF_USER-$SPACE.hf.space"
