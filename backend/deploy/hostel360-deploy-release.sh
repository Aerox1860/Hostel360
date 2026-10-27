#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: hostel360-deploy-release <commit-sha> <run-id>" >&2
    exit 2
fi

commit_sha="$1"
run_id="$2"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ || ! "$run_id" =~ ^[0-9]+$ ]]; then
    echo "Invalid release identifier." >&2
    exit 2
fi

release_id="${commit_sha}-${run_id}"
archive="/tmp/hostel360-release-${release_id}.tar.gz"
release_root="/opt/hostel360/releases"
release="${release_root}/${release_id}"
current="/opt/hostel360/current"

if [[ ! -f "$archive" ]]; then
    echo "Release archive is missing." >&2
    exit 1
fi
if [[ -e "$release" ]]; then
    echo "Release directory already exists; refusing to overwrite it." >&2
    exit 1
fi
if [[ -e "$current" && ! -L "$current" ]]; then
    echo "Current release path exists but is not a symlink; refusing to replace it." >&2
    exit 1
fi

entries="$(tar -tzf "$archive")"
if [[ "$entries" != $'backend/server.py\nbackend/requirements-deploy.txt' ]]; then
    echo "Release archive has unexpected contents." >&2
    exit 1
fi

previous=""
if [[ -L "$current" ]]; then
    previous="$(readlink -f "$current")"
    case "$previous" in
        "${release_root}/"*) ;;
        *)
            echo "Current release points outside the managed release directory." >&2
            exit 1
            ;;
    esac
fi

install -d -o root -g root -m 755 "$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
install -d -o hostel360 -g hostel360 -m 750 /var/lib/hostel360/uploads
ln -s /var/lib/hostel360/uploads "$release/backend/uploads"
chown -R root:root "$release"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +

if [[ ! -x /opt/hostel360/venv/bin/pip ]]; then
    echo "Backend virtual environment is not installed." >&2
    exit 1
fi
/opt/hostel360/venv/bin/pip install -r "$release/backend/requirements-deploy.txt"

ln -s "$release" "${current}.next"
mv -Tf "${current}.next" "$current"

if ! systemctl restart hostel360-api; then
    echo "Service restart failed; rolling back the release pointer." >&2
    if [[ -n "$previous" ]]; then
        ln -s "$previous" "${current}.rollback"
        mv -Tf "${current}.rollback" "$current"
        systemctl restart hostel360-api || true
    else
        systemctl stop hostel360-api || true
    fi
    exit 1
fi

if ! curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 2 http://127.0.0.1:8000/readyz; then
    echo "Readiness check failed; rolling back the release pointer." >&2
    if [[ -n "$previous" ]]; then
        ln -s "$previous" "${current}.rollback"
        mv -Tf "${current}.rollback" "$current"
        systemctl restart hostel360-api || true
    else
        systemctl stop hostel360-api || true
    fi
    exit 1
fi

echo "Deployed release ${release_id}."
