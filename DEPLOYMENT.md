# Hostel360 deployment (Ubuntu VPS + MongoDB Atlas)

## Fastest safe path

Use an existing Ubuntu 24.04 VPS, keep MongoDB Atlas as the database, run the API as a single `systemd` service, and put Caddy in front for automatic HTTPS. This avoids changing databases or introducing a container platform. It assumes you already control a server and DNS; no server, DNS, Atlas, payment, or app-store settings are changed by these instructions.

The Expo client reads `EXPO_PUBLIC_BACKEND_URL` at build time. The production API URL is `https://api.golivehostel360.com`; set that environment variable only for a production build. Native clients do not need browser CORS, but the backend rejects wildcard CORS in production so add only the exact HTTPS web-app origins you use.

## Before deploying

1. Choose a server and API hostname you already control. Point its DNS `A` record to the server's public IPv4 address. Caddy needs inbound TCP ports 80 and 443; keep port 8000 private.
2. In MongoDB Atlas, verify the existing cluster, database name, user, and IP access list. If the server needs allowlisting, approve that Atlas change yourself. **Keep the existing `DB_NAME` and Atlas data; do not create a replacement database or run data-clearing commands.**
3. Inventory `backend\uploads` separately. Tenant documents and other uploads are local files, not Atlas records. The package below intentionally excludes them and every `.env` file. Do not overwrite or delete existing uploads; plan a separate secured transfer to `/var/lib/hostel360/uploads` if existing uploaded files must be available on the new server.
4. Configure production values in `/etc/hostel360/hostel360.env`: `APP_ENV=production`, the existing `MONGO_URL` and `DB_NAME`, a unique `JWT_SECRET` (at least 32 random bytes), a strong `ADMIN_PASSWORD`, the existing `ADMIN_EMAIL`, the existing `TENANT_DOCUMENT_ENCRYPTION_KEY` and `TENANT_AADHAAR_HMAC_KEY`, and `CORS_ALLOWED_ORIGINS=https://golivehostel360.com`. Add another exact HTTPS origin to CORS only if that is a real web-app origin you use. Copy the two data-protection keys unchanged from the existing protected backend environment; do not generate replacements. Add payment, Google, and OCR credentials only if those integrations are enabled. Keep the environment file root-readable only. `ADMIN_PASSWORD` is only used when startup seeds a new admin; it does not reset an existing account. Production startup refuses an existing admin whose password is still the known default, so change it through the normal authenticated password flow first.
5. Generate a JWT key on the server with `openssl rand -hex 32`; paste it directly into the protected environment file without sending it in chat or committing it. Do not use the example credentials as production secrets. Changing `JWT_SECRET` invalidates existing JWTs, so coordinate that change with users.

Starting the API runs the application's existing index checks/creation and conditional seed/backfill routines. They do not clear collections, but they are database writes; review and approve that first production startup before running it against Atlas.

## GitHub Actions deployment (manual and approval-gated)

`.github/workflows/deploy-api.yml` only runs when manually dispatched from `main`. It first runs the isolated backend tests and frontend unit tests; it never runs the remote smoke test file. The deploy job requires both the explicit confirmation input and approval for the GitHub `production` environment. Configure required reviewers for that environment before enabling the workflow. Pushes, pull requests, and merges do not deploy automatically. The deployment job uploads the release, then runs the root-owned helper through narrowly scoped passwordless `sudo`.

Before enabling the workflow:

1. Complete credential rotation and the repository/history review described in the security handoff. This workflow does not rewrite or clean Git history.
2. Provision the server manually using the setup above and verify `/opt/hostel360/venv`, the `hostel360-api` service, Caddy, the protected environment file, and persistent upload storage are already in place. The workflow does not provision infrastructure, edit server environment settings, change DNS, or migrate uploads.
3. Install the root-owned deploy helper once from an approved checkout:

   ```bash
   sudo install -o root -g root -m 0750 backend/deploy/hostel360-deploy-release.sh /usr/local/sbin/hostel360-deploy-release
   ```

   The helper only accepts validated commit/run identifiers, refuses to overwrite an existing release directory, checks the archive entries, switches the release symlink, restarts the service, and rolls the pointer back if restart/readiness fails. It never removes uploads or database data.
4. Configure a dedicated SSH deployment account and public key. Allow only the root-owned helper with `sudo` using a `visudo` managed rule similar to:

   ```sudoers
   hostel360-deploy ALL=(root) NOPASSWD: /usr/local/sbin/hostel360-deploy-release
   ```

   Ensure the helper and its parent directory are root-owned and not writable by the deployment account. Do not grant the workflow unrestricted sudo or root SSH access.
5. In GitHub repository settings, create a `production` environment with required reviewers. Add these environment-scoped secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY`, and `DEPLOY_KNOWN_HOSTS`. Verify and pin the server host key out of band before adding `DEPLOY_KNOWN_HOSTS`; do not rely on an unverified `ssh-keyscan` at deploy time.

After review and approval, dispatch **Hostel360 API deployment** from the `main` branch, inspect the verification job, select the explicit confirmation checkbox, then approve the `production` environment gate. The workflow packages only `backend/server.py` and `backend/requirements-deploy.txt`, then invokes the preinstalled helper. It does not publish Expo artifacts or change payment configuration.

## Deploy from Windows PowerShell

These commands package only the backend source, its minimal public-PyPI runtime requirements, and deployment templates. They do not package `.env`, `.env.local-backup`, uploads, or the Expo secrets/configuration.

```powershell
$Project = 'C:\hostel360\Hostel360'
$Server = 'ubuntu@YOUR_SERVER_IP'
$Stage = Join-Path $env:TEMP ('hostel360-release-' + [guid]::NewGuid().ToString('N'))
$Zip = Join-Path $env:TEMP 'hostel360-release.zip'

New-Item -ItemType Directory -Force -Path "$Stage\backend\deploy" | Out-Null
Copy-Item -LiteralPath "$Project\backend\server.py","$Project\backend\requirements-deploy.txt" -Destination "$Stage\backend"
Copy-Item -LiteralPath "$Project\backend\deploy\hostel360-api.service.example","$Project\backend\deploy\Caddyfile.example" -Destination "$Stage\backend\deploy"
Compress-Archive -Path "$Stage\*" -DestinationPath $Zip -Force
scp $Zip "${Server}:/tmp/hostel360-release.zip"
```

SSH to the server and run the following initial setup once:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip unzip curl caddy
sudo useradd --system --home-dir /opt/hostel360 --create-home --shell /usr/sbin/nologin hostel360
sudo chown root:root /opt/hostel360
sudo install -d -o root -g root /opt/hostel360/releases
sudo install -d -o hostel360 -g hostel360 /var/lib/hostel360/uploads
sudo install -d -o root -g root -m 700 /etc/hostel360
sudo install -m 600 /dev/null /etc/hostel360/hostel360.env
sudoedit /etc/hostel360/hostel360.env
```

Enter the environment variables listed above in `sudoedit` (one `KEY=value` per line; no `export` statements). Use the existing Atlas database name and credentials. Do not paste secrets into deployment commands or shell history.

For each release, substitute the timestamped directory name below with a new value (for example `20261027020000`):

```bash
RELEASE=/opt/hostel360/releases/20261027020000
sudo install -d -o root -g root -m 755 "$RELEASE"
sudo unzip -q /tmp/hostel360-release.zip -d "$RELEASE"
sudo chown -R root:root "$RELEASE"
sudo ln -s /var/lib/hostel360/uploads "$RELEASE/backend/uploads"
sudo python3 -m venv /opt/hostel360/venv
sudo /opt/hostel360/venv/bin/pip install --upgrade pip
sudo /opt/hostel360/venv/bin/pip install -r "$RELEASE/backend/requirements-deploy.txt"
sudo ln -sfn "$RELEASE" /opt/hostel360/current
sudo install -m 644 "$RELEASE/backend/deploy/hostel360-api.service.example" /etc/systemd/system/hostel360-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now hostel360-api
```

Configure HTTPS after replacing the example hostname with the DNS name you control:

```bash
sudo install -m 644 /opt/hostel360/current/backend/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

For later releases, repeat the Windows packaging/SCP commands and the release extraction, ownership, uploads symlink, and `current` symlink steps using a new release directory. Then run:

```bash
sudo systemctl restart hostel360-api
sudo systemctl --no-pager --full status hostel360-api
sudo journalctl -u hostel360-api -n 100 --no-pager
```

Keep previous release directories until the new release passes the checks below. Roll back by pointing `/opt/hostel360/current` back to the previous release and restarting `hostel360-api`; do not delete uploaded files or Atlas data as part of rollback.

## Configure and verify the Expo app

In PowerShell, set the public API URL only for the production build:

```powershell
Set-Location 'C:\hostel360\Hostel360\frontend'
$env:EXPO_PUBLIC_BACKEND_URL = 'https://api.golivehostel360.com'
npx eas-cli@latest build --platform android --profile production
Remove-Item Env:EXPO_PUBLIC_BACKEND_URL
```

The production APK/AAB receives this URL at build time; changing it on the phone later does not change the compiled app. Use EAS's normal authenticated build flow and review its requested permissions before proceeding.

## Health, logs, and restart

- `GET /healthz` is a liveness probe and does not touch MongoDB.
- `GET /readyz` runs a read-only MongoDB `ping`; it returns `503` when Atlas is unavailable and does not expose connection errors.
- Caddy terminates HTTPS, proxies only to `127.0.0.1:8000`, and probes `/readyz` every 30 seconds.
- `systemd` starts the API on boot and restarts it after a failure. Application output and service errors are available through `journalctl -u hostel360-api`.

Verify from PowerShell after DNS and HTTPS are active:

```powershell
Invoke-RestMethod 'https://api.golivehostel360.com/healthz'
Invoke-RestMethod 'https://api.golivehostel360.com/readyz'
```

Both should return an `ok`/`ready` status. If readiness fails, inspect the service journal and verify Atlas reachability and credentials without printing or sharing the URI. Do not run the legacy `backend/tests/backend_test.py` against production: it performs state-changing test requests.
