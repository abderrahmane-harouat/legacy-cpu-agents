#!/usr/bin/env bash
# GitHub's ubuntu runners ship ~25 GB of SDKs we never use; WebKit and Bun need the room.
set -uo pipefail
df -h /
sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL \
  /usr/local/share/boost /usr/local/.ghcup /usr/share/swift /usr/local/julia* /opt/az \
  /usr/local/share/powershell /usr/local/share/chromium /usr/lib/jvm 2>/dev/null
sudo docker image prune --all --force >/dev/null 2>&1
sudo swapoff -a 2>/dev/null; sudo rm -f /mnt/swapfile /swapfile 2>/dev/null
# 16 GB RAM is tight for 4 parallel clang/rustc jobs on JSC/Bun's unified sources: add swap on the big /mnt disk.
if [ -d /mnt ]; then
  sudo fallocate -l 12G /mnt/swapfile && sudo chmod 600 /mnt/swapfile && sudo mkswap /mnt/swapfile >/dev/null && sudo swapon /mnt/swapfile
fi
df -h / /mnt 2>/dev/null
free -g
