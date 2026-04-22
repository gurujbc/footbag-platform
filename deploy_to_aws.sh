#!/usr/bin/env bash
set -euo pipefail

bash scripts/deploy-rebuild.sh "$(< ~/AWS/AWS_OPERATOR.txt)" 
