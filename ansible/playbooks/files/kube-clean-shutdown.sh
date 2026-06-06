#!/usr/bin/env bash
set -euo pipefail

log() { echo "$(date --iso-8601=seconds): $*"; }

log "Initiating graceful single-node Kubernetes shutdown..."

# 1. Stop kubelet - this sends SIGTERM to all pods and waits for grace periods
log "Stopping kubelet (will gracefully terminate all pods)..."
if ! systemctl stop kubelet; then
    log "ERROR: Failed to stop kubelet via systemd. Attempting force stop..."
    systemctl kill -s SIGKILL kubelet || true
fi

# Verify kubelet stopped
for i in {1..30}; do
    if ! systemctl is-active --quiet kubelet; then
        break
    fi
    sleep 1
done
if systemctl is-active --quiet kubelet; then
    log "WARNING: Kubelet failed to stop within 30 seconds. Proceeding anyway..."
else
    log "kubelet stopped."
fi

# 2. Stop containerd after kubelet is done
log "Stopping containerd..."
if ! systemctl stop containerd; then
    log "ERROR: Failed to stop containerd via systemd. Attempting force stop..."
    systemctl kill -s SIGKILL containerd || true
fi

# Verify containerd stopped
for i in {1..30}; do
    if ! systemctl is-active --quiet containerd; then
        break
    fi
    sleep 1
done
if systemctl is-active --quiet containerd; then
    log "WARNING: Containerd failed to stop within 30 seconds. Proceeding anyway..."
else
    log "containerd stopped."
fi

# 3. Flush filesystem buffers
log "Syncing filesystem..."
sync

log "Graceful shutdown complete."
