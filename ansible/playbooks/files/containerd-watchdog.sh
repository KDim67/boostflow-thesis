#!/usr/bin/env bash
# containerd-watchdog.sh - Automatic self-healing for containerd snapshot corruption
# Utilizes flock for locking and includes a circuit breaker to prevent loops.

set -euo pipefail

LOG_FILE="/var/log/containerd-watchdog.log"
LOCK_FILE="/var/run/containerd-watchdog.lock"
STATE_FILE="/var/run/containerd-watchdog.last-run"
THROTTLE_SECONDS=1800 # 30 minutes

log() {
    local message
    message="$(date --iso-8601=seconds): $*"
    echo "$message"
    echo "$message" >> "$LOG_FILE"
}

# 1. Establish lock using flock
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    # Silent exit if another watchdog instance is already running
    exit 0
fi

# 2. Check containerd logs for corruption signatures in the last 10 minutes
if ! journalctl -u containerd --since "10 minutes ago" | grep -E -q "failed to create snapshot: missing parent.*bucket: not found|unable to prepare extraction snapshot.*already exists"; then
    # No corruption signatures found, exit cleanly
    exit 0
fi

# 3. Circuit Breaker / Throttle Check
if [ -f "$STATE_FILE" ]; then
    LAST_RUN=$(cat "$STATE_FILE")
    NOW=$(date +%s)
    ELAPSED=$((NOW - LAST_RUN))
    if [ "$ELAPSED" -lt "$THROTTLE_SECONDS" ]; then
        log "WARNING: Containerd corruption detected, but watchdog ran only $((ELAPSED / 60)) minutes ago. Skipping to prevent infinite loop."
        exit 1
    fi
fi

log "Detected containerd metadata corruption. Initiating automatic self-healing..."
logger -t containerd-watchdog "WARNING: containerd metadata corruption detected on $(hostname). Initiating self-healing..."

# 4. Stop Kubelet cleanly
log "Stopping kubelet..."
if ! systemctl stop kubelet; then
    log "ERROR: Failed to stop kubelet via systemd. Attempting force stop..."
    systemctl kill -s SIGKILL kubelet || true
fi

# Wait for kubelet to completely stop
for i in {1..30}; do
    if ! systemctl is-active --quiet kubelet; then
        break
    fi
    sleep 1
done
if systemctl is-active --quiet kubelet; then
    log "ERROR: Kubelet is still active after 30 seconds. Aborting repair to prevent data loss."
    exit 1
fi
log "Kubelet stopped successfully."

# 5. Stop Containerd cleanly
log "Stopping containerd..."
if ! systemctl stop containerd; then
    log "ERROR: Failed to stop containerd via systemd. Attempting force stop..."
    systemctl kill -s SIGKILL containerd || true
fi

# Wait for containerd to completely stop
for i in {1..30}; do
    if ! systemctl is-active --quiet containerd; then
        break
    fi
    sleep 1
done
if systemctl is-active --quiet containerd; then
    log "ERROR: Containerd is still active after 30 seconds. Aborting repair."
    exit 1
fi
log "Containerd stopped successfully."

# 6. Dynamically resolve containerd root directory with safe fallback
CONTAINERD_ROOT=$(containerd config dump 2>/dev/null | grep -E "^root\s*=" | head -n 1 | cut -d'"' -f2) || true
CONTAINERD_ROOT="${CONTAINERD_ROOT:-/var/lib/containerd}"

if [ ! -d "$CONTAINERD_ROOT" ]; then
    log "ERROR: Resolved containerd root directory '$CONTAINERD_ROOT' does not exist."
    exit 1
fi

# Safety checks to prevent accidental deletions of critical paths
if [ "$CONTAINERD_ROOT" = "/opt/local-path-provisioner" ] || [ "$CONTAINERD_ROOT" = "/" ]; then
    log "ERROR: Resolved containerd root '$CONTAINERD_ROOT' is unsafe. Aborting."
    exit 1
fi

# 7. Atomic-ish state move to backup directory (prevents partial state failures and preserves image content store)
BACKUP_DIR=$(mktemp -d /tmp/containerd-backup-XXXXXX)
log "Moving potentially corrupted state files to $BACKUP_DIR..."

# Move files and directories if they exist
mv "$CONTAINERD_ROOT/io.containerd.snapshotter.v1.overlayfs" "$BACKUP_DIR/" || true
mv "$CONTAINERD_ROOT/io.containerd.metadata.v1.bolt" "$BACKUP_DIR/" || true

# 8. Start services back up and verify health
log "Starting containerd..."
systemctl start containerd

if ! timeout 30 bash -c 'until systemctl is-active --quiet containerd; do sleep 1; done'; then
    log "ERROR: containerd failed to start after healing. Keeping backup for debugging at $BACKUP_DIR"
    logger -t containerd-watchdog "CRITICAL: containerd failed to start after self-healing on $(hostname)."
    exit 1
fi

log "Starting kubelet..."
systemctl start kubelet

if ! timeout 30 bash -c 'until systemctl is-active --quiet kubelet; do sleep 1; done'; then
    log "ERROR: kubelet failed to start after healing. Keeping backup for debugging at $BACKUP_DIR"
    logger -t containerd-watchdog "CRITICAL: kubelet failed to start after self-healing on $(hostname)."
    exit 1
fi

# 9. Clean up backup directory upon verified successful restart
log "Cleaning up backup directory..."
rm -rf "$BACKUP_DIR"

# Record execution time for the circuit breaker
date +%s > "$STATE_FILE"
log "Self-healing process completed successfully."
logger -t containerd-watchdog "SUCCESS: containerd self-healing completed successfully on $(hostname)."
