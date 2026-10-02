#!/bin/bash
set -euo pipefail
umask 077
: "${LW_DEPLOY_KEY:?Deployment key missing}"
: "${LW_DEPLOY_KNOWN_HOSTS:?Known host verification missing}"
work=$(mktemp -d)
trap 'rm -f "$work/key" "$work/known_hosts" "$work/versions.json" "$work/data.json"; rmdir "$work"' EXIT
printf '%s\n' "$LW_DEPLOY_KEY" > "$work/key"
printf '%s\n' "$LW_DEPLOY_KNOWN_HOSTS" > "$work/known_hosts"
unset LW_DEPLOY_KEY LW_DEPLOY_KNOWN_HOSTS
ssh_args=(-i "$work/key" -p 18765 -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts" -o ConnectTimeout=20)
target=u1734-7dodpdhgoz4q@it6.siteground.eu
latest=$(git ls-remote origin refs/heads/main | awk '{print $1}')
if [ "$latest" != "$GITHUB_SHA" ]; then
 echo 'Newer source revision exists; refusing to send old data. The newer workflow will synchronize.'
 exit 1
fi
printf '{"action":"data-status"}' | ssh "${ssh_args[@]}" "$target" > "$work/versions.json"
python siteground/deploy/data_bundle.py "$GITHUB_SHA" "$work/versions.json" > "$work/data.json"
ssh "${ssh_args[@]}" "$target" < "$work/data.json"
