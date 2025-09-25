#!/bin/bash

# Usage:
#   ./git-quick-push.sh
#   ./git-quick-push.sh "Your commit message here"

MSG="${*:-latest updates}"

# Check if legacy_trails directory exists and has changes
if [ -d "legacy_trails" ] && [ -n "$(git status --porcelain legacy_trails/)" ]; then
    echo ""
    echo "WARNING: Changes detected in legacy_trails directory!"
    echo ""
    read -p "Do you want to run reorder-reproject.sh for legacy_trails before pushing? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Running reorder-reproject.sh for legacy_trails..."
        echo "IMPORTANT: Wait for the process to finish completely before continuing!"
        echo ""
        
        cd legacy_trails
        if [ -f "reorder-reproject.sh" ]; then
            ./reorder-reproject.sh
            echo ""
            echo "SUCCESS: reorder-reproject.sh completed!"
        else
            echo "ERROR: reorder-reproject.sh not found in legacy_trails directory!"
            exit 1
        fi
        cd ..
        
        echo ""
        read -p "Press [Enter] to continue with git operations..."
    else
        echo "Skipping reorder-reproject.sh..."
    fi
fi

echo "Staging changes..."
git add -A

echo "Committing (\"$MSG\")..."
if git commit -m "$MSG" 2>/dev/null; then
    echo "Committed successfully."
else
    echo "Nothing to commit or commit skipped; continuing."
fi

echo "Pushing..."
git push -u origin master

read -p "Press [Enter] to continue..."
