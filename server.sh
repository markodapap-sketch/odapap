#!/bin/bash

echo "🔄 Managing Oda Pap Server"

case $1 in
  start)
    echo "🚀 Starting server..."
    pm2 start ecosystem.config.js --name oda-pap-server
    ;;
  stop)
    echo "🛑 Stopping server..."
    pm2 stop oda-pap-server
    ;;
  restart)
    echo "🔄 Restarting server..."
    pm2 restart oda-pap-server
    ;;
  logs)
    echo "📜 Viewing logs..."
    pm2 logs --lines 50
    ;;
  *)
    echo "Usage: bash server.sh {start|stop|restart|logs}"
    ;;
esac
