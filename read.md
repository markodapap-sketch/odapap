# Oda Pap - EC2 Deployment Guide

A complete guide to deploying your marketplace app with M-Pesa payments on AWS EC2 using Nginx and PM2.

---

## Prerequisites

Before starting, you need:
- AWS account with an EC2 instance (Ubuntu/Amazon Linux)
- Your `.pem` key file for SSH access (e.g., C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem)
- Domain name (optional but recommended)
- M-Pesa Daraja API credentials
- Firebase project credentials

---

## Part 1: Initial EC2 Setup

### Step 1: Connect to Your EC2 Instance

```bash
# Windows (PowerShell)
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44

# Mac/Linux
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44
```

### Step 2: Update System Packages

```bash
sudo yum update -y  # Amazon Linux
# OR
sudo apt update && sudo apt upgrade -y  # Ubuntu
```

### Step 3: Install Node.js

```bash
# Install Node.js 18.x (LTS)
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -  # Amazon Linux
sudo yum install -y nodejs  # Amazon Linux

# OR for Ubuntu:
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify installation:
```bash
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher
```

### Step 4: Install Nginx

```bash
# Amazon Linux
sudo amazon-linux-extras install nginx1 -y
sudo yum install nginx -y

# OR Ubuntu
sudo apt install nginx -y
```

Start and enable Nginx:
```bash
sudo systemctl start nginx
sudo systemctl enable nginx
sudo systemctl status nginx  # Should show "active (running)"
```

### Step 5: Install PM2 Globally

```bash
sudo npm install -g pm2
pm2 --version  # Verify installation
```

---

## Part 2: Deploy Your Application

### Step 1: Create Application Directory

```bash
cd ~
mkdir -p oda-pap
cd oda-pap
```

### Step 2: Upload Your Code from Local Machine

From your local computer (Windows PowerShell):

```powershell
# Navigate to your project directory
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1

# Upload all files to EC2
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" -r * ec2-user@13.201.184.44:~/oda-pap/
```

### Step 3: Create Environment File on Server

Back on your EC2 instance:

```bash
cd ~/oda-pap
nano .env
```

Paste this content (replace with your actual values):

```env
# Server Configuration
NODE_ENV=production
PORT=5000
BASE_URL=http://13.201.184.44
CALLBACK_URL=http://13.201.184.44/api/mpesa/callback

# M-Pesa Configuration
MPESA_CONSUMER_KEY=your_consumer_key_here
MPESA_CONSUMER_SECRET=your_consumer_secret_here
MPESA_SHORTCODE=174379
MPESA_PASSKEY=your_passkey_here
MPESA_ENVIRONMENT=sandbox

# Firebase Configuration
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

Save the file (Ctrl+X, then Y, then Enter).

### Step 4: Install Dependencies

```bash
npm install
```

---

## Part 3: Configure PM2

### Step 1: Create PM2 Ecosystem File

```bash
nano ecosystem.config.js
```

Paste this content:

```javascript
module.exports = {
  apps: [{
    name: 'oda-pap-server',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '500M',
    watch: false,
    ignore_watch: ['node_modules', 'logs', '.git'],
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

Save the file.

### Step 2: Create Logs Directory

```bash
mkdir -p logs
```

### Step 3: Start Application with PM2

```bash
pm2 start ecosystem.config.js
pm2 save  # Save PM2 process list
pm2 startup  # Generate startup script
```

Copy and run the command that PM2 outputs (it will look like):
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user
```

Verify the app is running:
```bash
pm2 status
pm2 logs oda-pap-server --lines 50
```

---

## Part 4: Configure Nginx as Reverse Proxy

### Step 1: Create Nginx Configuration

```bash
sudo nano /etc/nginx/conf.d/oda-pap.conf
```

Paste this configuration:

```nginx
# Upstream Node.js application
upstream oda_pap_backend {
    server 127.0.0.1:5000;
    keepalive 64;
}

# HTTP Server
server {
    listen 80;
    listen [::]:80;
    
    server_name 13.201.184.44;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Client body size limit
    client_max_body_size 10M;
    
    # Logging
    access_log /var/log/nginx/oda-pap-access.log;
    error_log /var/log/nginx/oda-pap-error.log;
    
    # Root directory for static files
    root /home/ec2-user/oda-pap;
    index index.html;
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript 
               application/x-javascript application/xml+rss 
               application/javascript application/json;
    
    # API endpoints - proxy to Node.js
    location /api/ {
        proxy_pass http://oda_pap_backend;
        proxy_http_version 1.1;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
        proxy_connect_timeout 90s;
        proxy_send_timeout 90s;
    }
    
    # Static files - serve directly
    location / {
        try_files $uri $uri/ /index.html;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
    
    # CSS files
    location ~* \.css$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    
    # JavaScript files
    location ~* \.js$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
    
    # Images
    location ~* \.(jpg|jpeg|png|gif|ico|svg|webp)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Fonts
    location ~* \.(woff|woff2|ttf|otf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Replace `YOUR_EC2_IP_OR_DOMAIN` with 13.201.184.44.

Save the file.

### Step 2: Test and Restart Nginx

```bash
# Test configuration for syntax errors
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx

# Check Nginx status
sudo systemctl status nginx
```

---

## Part 5: Configure Security (Firewall)

### For Amazon Linux (using Security Groups):

Go to AWS Console → EC2 → Security Groups → Edit Inbound Rules:

Add these rules:
- Type: HTTP, Port: 80, Source: 0.0.0.0/0
- Type: HTTPS, Port: 443, Source: 0.0.0.0/0 (for future SSL)
- Type: Custom TCP, Port: 5000, Source: 127.0.0.1/32 (localhost only)

### For Ubuntu (using UFW):

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
sudo ufw status
```

---

## Part 6: Verify Deployment

### Step 1: Check Application Status

```bash
pm2 status
pm2 logs oda-pap-server --lines 20
```

### Step 2: Test API Health

```bash
curl http://localhost:5000/api/health
```

Should return JSON with status "healthy".

### Step 3: Test Through Nginx

```bash
curl http://localhost/api/health
```

Should return the same response.

### Step 4: Test from Browser

Open in your browser:
```
http://13.201.184.44/
http://13.201.184.44/api/health
```

---

## Part 7: Update M-Pesa Callback URL

### Step 1: Login to Daraja Portal

Go to https://developer.safaricom.co.ke

### Step 2: Update Callback URL

Navigate to: My Apps → Your App → Update

Set callback URL to:
```
http://13.201.184.44/api/mpesa/callback
```

Save changes.

---

## Common PM2 Commands

### View Application Status
```bash
pm2 status
```

### View Logs (Live)
```bash
pm2 logs oda-pap-server
```

### View Last 50 Log Lines
```bash
pm2 logs oda-pap-server --lines 50
```

### Restart Application
```bash
pm2 restart oda-pap-server
```

### Stop Application
```bash
pm2 stop oda-pap-server
```

### Start Application
```bash
pm2 start ecosystem.config.js
```

### Monitor Resources
```bash
pm2 monit
```

### Clear Logs
```bash
pm2 flush
```

---

## Common Nginx Commands

### Test Configuration
```bash
sudo nginx -t
```

### Reload Configuration (No Downtime)
```bash
sudo systemctl reload nginx
```

### Restart Nginx
```bash
sudo systemctl restart nginx
```

### Check Status
```bash
sudo systemctl status nginx
```

### View Error Logs
```bash
sudo tail -f /var/log/nginx/error.log
```

### View Access Logs
```bash
sudo tail -f /var/log/nginx/access.log
```

---

## Updating Your Application

### Step 1: Upload New Code from Local

```powershell
# From your local machine
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" -r * ec2-user@13.201.184.44:~/oda-pap/
```

### Step 2: SSH into Server and Restart

```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44
cd ~/oda-pap
npm install  # If you added new dependencies
pm2 restart oda-pap-server
```

---

## Troubleshooting

### Application Won't Start

**Check PM2 logs:**
```bash
pm2 logs oda-pap-server --err --lines 50
```

**Common issues:**
- Missing `.env` file
- Wrong Node.js version
- Missing dependencies - run `npm install`

### Nginx 502 Bad Gateway

**Check if Node.js app is running:**
```bash
pm2 status
```

**Check Nginx error logs:**
```bash
sudo tail -f /var/log/nginx/error.log
```

**Restart both services:**
```bash
pm2 restart oda-pap-server
sudo systemctl reload nginx
```

### Can't Access from Browser

**Check Security Groups (AWS Console):**
- Ensure port 80 is open to 0.0.0.0/0

**Check firewall:**
```bash
sudo ufw status  # Ubuntu
```

**Test locally first:**
```bash
curl http://localhost/api/health
```

### M-Pesa Callbacks Not Working

**Check callback URL in code:**
```bash
cat .env | grep CALLBACK_URL
```

**Check Daraja Portal:**
- Verify callback URL matches your server
- Use HTTP (not HTTPS) unless you have SSL

**Check callback logs:**
```bash
pm2 logs oda-pap-server | grep -i callback
```

---

## Optional: Setup SSL with Let's Encrypt

### Step 1: Install Certbot

```bash
# Amazon Linux
sudo yum install -y certbot python3-certbot-nginx

# Ubuntu
sudo apt install -y certbot python3-certbot-nginx
```

### Step 2: Get SSL Certificate

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow the prompts. Certbot will automatically configure Nginx.

### Step 3: Update Callback URL

Update your `.env` file:
```env
BASE_URL=https://yourdomain.com
CALLBACK_URL=https://yourdomain.com/api/mpesa/callback
```

Restart the app:
```bash
pm2 restart oda-pap-server
```

Update Daraja Portal with HTTPS callback URL.

### Step 4: Auto-Renewal

```bash
sudo certbot renew --dry-run
```

---

## Monitoring

### Check Disk Space
```bash
df -h
```

### Check Memory Usage
```bash
free -m
```

### Check CPU Usage
```bash
top
```

### PM2 Monitoring
```bash
pm2 monit
```

---

## Backup Strategy

### Backup Environment File
```bash
cp .env .env.backup
```

### Backup Database (if applicable)
Set up automated Firebase backups in Firebase Console.

### Backup Application Files
```bash
tar -czf oda-pap-backup-$(date +%Y%m%d).tar.gz ~/oda-pap
```

---

## Quick Reference Card

| Task | Command |
|------|---------|
| SSH to server | `ssh -i C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem ec2-user@13.201.184.44` |
| Check app status | `pm2 status` |
| View logs | `pm2 logs oda-pap-server` |
| Restart app | `pm2 restart oda-pap-server` |
| Test Nginx | `sudo nginx -t` |
| Reload Nginx | `sudo systemctl reload nginx` |
| View Nginx errors | `sudo tail -f /var/log/nginx/error.log` |
| Upload new code | `scp -i C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem -r * ec2-user@13.201.184.44:~/oda-pap/` |

---

## Support Resources

- PM2 Documentation: https://pm2.keymetrics.io/docs/usage/quick-start/
- Nginx Documentation: https://nginx.org/en/docs/
- Daraja API: https://developer.safaricom.co.ke
- Firebase Console: https://console.firebase.google.com
- AWS EC2 Console: https://console.aws.amazon.com/ec2/

---

Made with precision for Oda Pap deployment
