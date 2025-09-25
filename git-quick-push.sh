#!/bin/bash

# =============================================================================
# Git Quick Push Script
# =============================================================================
# Automates git add, commit, and push with optional legacy_trails processing
# =============================================================================

# Usage:
#   ./git-quick-push.sh
#   ./git-quick-push.sh "Your commit message here"

MSG="${*:-latest updates}"

# =============================================================================
# Check for legacy_trails changes and offer reprojection
# =============================================================================

if [ -d "legacy_trails" ] && [ -n "$(git status --porcelain legacy_trails/)" ]; then
    echo ""
    echo "=========================================="
    echo "WARNING: Changes detected in legacy_trails!"
    echo "=========================================="
    echo ""
    read -p "Do you want to run reorder-reproject.sh before pushing? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "Running reorder-reproject.sh..."
        echo "IMPORTANT: Wait for the process to finish completely!"
        echo ""
        
        cd legacy_trails
        ./reorder-reproject.sh
        echo ""
        echo "SUCCESS: reorder-reproject.sh completed!"
        cd ..
        
        echo ""
        read -p "Press [Enter] to continue with git operations..."
    else
        echo "Skipping reorder-reproject.sh..."
    fi
fi

# =============================================================================
# Git operations
# =============================================================================

echo ""
echo "=========================================="
echo "Starting git operations..."
echo "=========================================="

echo ""
echo "Staging changes..."
git add -A

echo ""
echo "Committing: \"$MSG\""
if git commit -m "$MSG" 2>/dev/null; then
    echo "SUCCESS: Committed successfully."
else
    echo "INFO: Nothing to commit or commit skipped; continuing."
fi

echo ""
echo "Pushing to origin/master..."
git push -u origin master

echo ""
echo "=========================================="
echo "Git operations completed!"
echo "=========================================="

read -p "Press [Enter] to exit..."
