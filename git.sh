#!/bin/bash

COMMIT_MESSAGE="portfolio on github pages"

# Add all changes
git add .


# Commit with the provided message
git commit -m "$COMMIT_MESSAGE"

# Push to the current branch
git push

echo "Changes pushed successfully!"
