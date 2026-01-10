#!/bin/bash

# Oda Pap Server Update Script
# Run this on EC2 to update your application

echo "🔄 Starting Oda Pap Server Update..."
echo "======================================"

# Check if we're in the right directory
if [ ! -f "server.js" ]; then
    echo "❌ Error: server.js not found. Are you in the right directory?"
    exit 1
fi

# Pull latest changes from git (if using git)
if [ -d ".git" ]; then
    echo "📥 Pulling latest changes from repository..."
    git pull origin main || git pull origin master
else
    echo "ℹ️  No git repository found - skipping pull"
fi

# Install/update dependencies
echo "📦 Installing dependencies..."
npm install

# Run any database migrations if needed
# Add your migration commands here

# Restart PM2 process
echo "🔄 Restarting PM2 process..."
pm2 restart oda-pap-server

# Check status
echo "✅ Checking server status..."
pm2 status oda-pap-server

# Show recent logs
echo "📋 Recent logs:"
pm2 logs oda-pap-server --lines 20 --nostream

echo ""
echo "======================================"
echo "✅ Update complete!"
echo "======================================"
echo ""
echo "Useful commands:"
echo "  pm2 logs oda-pap-server    - View logs"
echo "  pm2 monit                  - Monitor CPU/Memory"
echo "  pm2 restart oda-pap-server - Restart server"
echo ""
