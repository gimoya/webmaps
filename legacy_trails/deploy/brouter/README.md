# BRouter (VPS) — Digitize routing

Self-hosted [BRouter](https://github.com/abrensch/brouter) behind nginx for **legacy_trails Digitize**.

| | |
| --- | --- |
| Public endpoint | `https://route.tiroltrailhead.com/brouter` |
| VPS | `202.61.241.71` (netcup nano, Debian 13) |
| App path | `/opt/brouter/` |
| Service | `systemd` unit `brouter` → `127.0.0.1:17777` |
| Proxy | nginx TLS + IP allow-list + CORS |
| Digitize default | `legacy_trails/javascript/trail_map.js` → `LEGACY_BROUTER_URL` |
| Local override | `?brouter=http://127.0.0.1:17777/brouter` |
| Local tiles/jar | `C:\GitHub\brouter\brouter-1.7.9\` (gitignored) |

Drafts in this folder: [`brouter.service`](./brouter.service), [`nginx-route.conf`](./nginx-route.conf).

Digitize profiles in use: **mtb**, **trekking**, **hiking-mountain** (UI label: Hiking).

---

## Maintain `.rd5` tiles and BRouter

### What `.rd5` files are

BRouter routing data is split into **5° × 5°** tiles named `E{lon}_N{lat}.rd5` (southwest corner of the tile in degrees). Coverage = whichever files sit in `/opt/brouter/segments4/`. Missing tile for a request → empty / error geometry.

Upstream mirror (rebuilds periodically from OSM):

https://brouter.de/brouter/segments4/

### Tiles currently on the VPS (Alps / AT–CH–IT)

```
/opt/brouter/segments4/
  E5_N45.rd5   E10_N45.rd5   E15_N45.rd5
  E5_N40.rd5   E10_N40.rd5   E15_N40.rd5
```

~750 MB total. Do **not** dump half of Europe onto the nano — disk fills fast.

To pick tiles for a new region: take the lon/lat of the area, snap down to the nearest multiple of 5 for the SW corner, download that file (+ neighbors if the route crosses a border).

### Refresh existing tiles (OSM updates)

Do this when roads/trails look stale or after major OSM edits. Weekly is plenty for Digitize.

From your admin machine (Git Bash / WSL), with SSH key `~/.ssh/vps_brouter`:

```bash
SSH="ssh -i $HOME/.ssh/vps_brouter -o IdentitiesOnly=yes root@202.61.241.71"
BASE=https://brouter.de/brouter/segments4
TILES="E5_N45.rd5 E10_N45.rd5 E15_N45.rd5 E5_N40.rd5 E10_N40.rd5 E15_N40.rd5"

mkdir -p /tmp/brouter-rd5 && cd /tmp/brouter-rd5
for t in $TILES; do
  curl -fL --retry 3 -o "$t" "$BASE/$t"
done

scp -i $HOME/.ssh/vps_brouter -o IdentitiesOnly=yes *.rd5 root@202.61.241.71:/tmp/segments4-new/
$SSH 'mkdir -p /tmp/segments4-new
  mv /tmp/segments4-new/*.rd5 /opt/brouter/segments4/
  chown brouter:brouter /opt/brouter/segments4/*.rd5
  systemctl restart brouter
  systemctl is-active brouter
  ls -lh /opt/brouter/segments4/'
```

Or download **on the VPS** (uses VPS bandwidth; fine for six files):

```bash
ssh -i $HOME/.ssh/vps_brouter -o IdentitiesOnly=yes root@202.61.241.71
cd /opt/brouter/segments4
BASE=https://brouter.de/brouter/segments4
for t in E5_N45.rd5 E10_N45.rd5 E15_N45.rd5 E5_N40.rd5 E10_N40.rd5 E15_N40.rd5; do
  curl -fL --retry 3 -o "$t.new" "$BASE/$t" && mv "$t.new" "$t"
done
chown brouter:brouter *.rd5
systemctl restart brouter
```

BRouter reads tiles at process start — **always restart** after replacing `.rd5`.

### Add coverage (new region)

1. Identify missing `E*_N*.rd5` for the bbox.
2. Download into `/opt/brouter/segments4/`.
3. `chown brouter:brouter` + `systemctl restart brouter`.
4. Smoke a `lonlats` pair inside the new tile (see Health below).

Keep a copy under `C:\GitHub\brouter\brouter-1.7.9\segments4\` locally if you still run Digitize against localhost.

### Profiles

Stock profiles live in `/opt/brouter/profiles2/*.brf`. Digitize uses:

| UI | BRouter `profile=` |
| --- | --- |
| MTB | `mtb` |
| Trekking | `trekking` |
| Hiking | `hiking-mountain` |

Custom `.brf` → `/opt/brouter/customprofiles/`, then restart. No nginx change needed.

### Upgrade BRouter jar

1. Grab a release jar from https://github.com/abrensch/brouter/releases (e.g. `brouter-x.y.z-all.jar`).
2. Copy to `/opt/brouter/`, keep the old jar until smoke passes.
3. Edit `/etc/systemd/system/brouter.service` → `-cp` path (and repo draft [`brouter.service`](./brouter.service)).
4. `systemctl daemon-reload && systemctl restart brouter`.
5. Smoke GeoJSON; if broken, point `-cp` back and restart.

Also refresh `profiles2/` from the release if profiles changed.

Heap: unit uses `-Xmx768M` — leave headroom on the nano; don’t raise blindly.

### Service / logs / health

```bash
systemctl status brouter --no-pager
journalctl -u brouter -f
systemctl restart brouter
```

Local on VPS (always works; bypasses allow-list):

```bash
curl -sS -m 30 \
  'http://127.0.0.1:17777/brouter?lonlats=11.394,47.269|11.405,47.260&profile=mtb&alternativeidx=0&format=geojson' \
  | head -c 200
```

From an **allow-listed** admin IP:

```bash
curl -sS -m 30 \
  'https://route.tiroltrailhead.com/brouter?lonlats=11.394,47.269|11.405,47.260&profile=mtb&alternativeidx=0&format=geojson' \
  | head -c 200
```

Expect JSON `FeatureCollection`. HTTP 403 = your public IP is not in nginx `allow`.

### nginx allow-list / CORS

Live site: `/etc/nginx/sites-enabled/route.tiroltrailhead.com` (certbot-managed TLS).

- New office IP → add `allow X.X.X.X;` next to the existing allows, `nginx -t && systemctl reload nginx`.
- New map origin (e.g. another localhost port) → add to the `map $http_origin $brouter_cors_origin` block, reload.
- Keep `proxy_hide_header Access-Control-Allow-Origin` (and Methods/Headers): BRouter sends `ACAO: *`; a second header breaks browsers (“Failed to fetch”).

Draft mirror: [`nginx-route.conf`](./nginx-route.conf) — sync important edits back into the repo after live changes.

### TLS certs

Let’s Encrypt via certbot; renew timer is installed. Check:

```bash
systemctl list-timers 'certbot*'
certbot certificates
```

### Disk / RAM

| | |
| --- | --- |
| Six Alps tiles | ~750 MB |
| JVM | `-Xmx768M` |
| Public ports | 22, 80, 443 only — **never** open 17777 |

---

## Install runbook (initial bring-up)

Already done on this VPS; keep for rebuilds.

### 0. Prerequisites

- VPS IPv4, SSH key as root
- DNS `route.tiroltrailhead.com` → VPS
- Local six `.rd5` files (~750 MB)

### 1. Base OS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y openjdk-21-jre-headless nginx ufw curl unzip
# (Debian 13 live uses OpenJDK 21; Ubuntu LTS often 17 — either works)

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# Do NOT allow 17777
sudo ufw enable
```

### 2. BRouter user + tree

```bash
sudo useradd --system --home /opt/brouter --shell /usr/sbin/nologin brouter || true
sudo mkdir -p /opt/brouter/{segments4,profiles2,customprofiles}
```

From the machine with `C:\GitHub\brouter\brouter-1.7.9`:

```bash
scp -i $HOME/.ssh/vps_brouter -o IdentitiesOnly=yes \
  /c/GitHub/brouter/brouter-1.7.9/brouter-1.7.9-all.jar root@202.61.241.71:/tmp/
scp -i $HOME/.ssh/vps_brouter -o IdentitiesOnly=yes -r \
  /c/GitHub/brouter/brouter-1.7.9/profiles2 root@202.61.241.71:/tmp/profiles2
scp -i $HOME/.ssh/vps_brouter -o IdentitiesOnly=yes \
  /c/GitHub/brouter/brouter-1.7.9/segments4/*.rd5 root@202.61.241.71:/tmp/segments4/
```

On VPS:

```bash
sudo mv /tmp/brouter-1.7.9-all.jar /opt/brouter/
sudo rsync -a /tmp/profiles2/ /opt/brouter/profiles2/
sudo mv /tmp/segments4/*.rd5 /opt/brouter/segments4/
sudo chown -R brouter:brouter /opt/brouter
```

### 3. systemd

```bash
sudo cp brouter.service /etc/systemd/system/brouter.service
sudo systemctl daemon-reload
sudo systemctl enable --now brouter
```

### 4. nginx + TLS

1. Edit allow-list + CORS in [`nginx-route.conf`](./nginx-route.conf).
2. Install site, `nginx -t`, reload.
3. `certbot --nginx -d route.tiroltrailhead.com`
4. Apply `proxy_hide_header` for upstream CORS (see Maintain → nginx).

### 5. Digitize URL

Default in `trail_map.js`:

```js
return 'https://route.tiroltrailhead.com/brouter';
```

### Security checklist

- [ ] ufw: 22, 80, 443 only — **no** 17777
- [ ] nginx `allow` has current admin IPs
- [ ] CORS map lists real Digitize origins only
- [ ] Upstream CORS headers hidden; single ACAO from nginx
- [ ] Digitize uses `https://…/brouter` (not raw `:17777`)
- [ ] Root password rotated; SSH key auth preferred
