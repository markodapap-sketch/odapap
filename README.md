# Oda Pap - Complete EC2 Deployment (Copy-Paste Ready)

Everything is ready. Just copy-paste each block. Takes 15 minutes.

---

## Part 1: Connect and Prepare Server

### Step 1: Connect to EC2

Open PowerShell and run:

```powershell
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44
```

You should see: `[ec2-user@ip-xxx-xxx-xxx-xxx ~]$`

---

### Step 2: Install Everything

Copy and paste this entire block:

```bash
sudo yum update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
sudo amazon-linux-extras install nginx1 -y
sudo yum install nginx -y
sudo npm install -g pm2
echo "=== Checking Installations ==="
node --version
npm --version
nginx -v
pm2 --version
echo "=== All Done! ==="
```

Wait 2-3 minutes for installation.

---

## Part 2: Setup Your Application

### Step 3: Create Application Folder

```bash
cd ~
mkdir -p oda-pap
cd oda-pap
```

---

### Step 4: Upload Your Code

**Open a NEW PowerShell window**, then run:

```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" -r * ec2-user@13.201.184.44:~/oda-pap/
```

Wait for upload. **Go back to your SSH window.**

---

### Step 5: Create Environment File (With Your Real Credentials)

Copy and paste this entire block:

```bash
cd ~/oda-pap
cat > .env << 'EOF'
# M-Pesa Credentials (LIVE)
MPESA_CONSUMER_KEY=oFdyyv614zx6GHLn1tsm9trhirqrvy3fmGmSXWosV3ljnxLW
MPESA_CONSUMER_SECRET=j9p1iGuDArA3yiUGGdXZeZnXEU6EcAsOSGPkUshWqMA9N1WpntCFUeDFZSTxDJB0
MPESA_SHORTCODE=4986480
MPESA_PASSKEY=6dfee6011cc3a705021b65a0450ad47bfd33a7193de6ea1a5da6f2f41ce77f03
MPESA_ENVIRONMENT=live

# Security (for B2C, not needed for STK Push)
INITIATOR_NAME=
SECURITY_CREDENTIAL=

# Server Configuration
PORT=5000
NODE_ENV=production
BASE_URL=http://13.201.184.44

# M-Pesa Callback URLs (Public EC2 IP)
CALLBACK_URL=http://13.201.184.44/api/mpesa/callback
TIMEOUT_URL=http://13.201.184.44/api/mpesa/timeout
RESULT_URL=http://13.201.184.44/api/mpesa/result

# Firebase Configuration
FIREBASE_API_KEY=AIzaSyDez809vabqwQrGi5KaQ1-crKvk8oL5x90
FIREBASE_AUTH_DOMAIN=oda-pap-46469.firebaseapp.com
FIREBASE_DATABASE_URL=https://oda-pap-46469-default-rtdb.firebaseio.com
FIREBASE_PROJECT_ID=oda-pap-46469
FIREBASE_STORAGE_BUCKET=oda-pap-46469.appspot.com
FIREBASE_MESSAGING_SENDER_ID=104112612296
FIREBASE_APP_ID=1:104112612296:web:0d7893046b3fadcf2d56fd
EOF
```

Verify it was created:
```bash
cat .env
```

You should see all your credentials.

---

### Step 6: Install Dependencies

```bash
npm install
```

Wait 1-2 minutes.

---

## Part 3: Setup PM2

### Step 7: Create PM2 Config

```bash
cat > ecosystem.config.js << 'EOF'
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
    max_memory_restart: '500M'
  }]
};
EOF
```

---

### Step 8: Start Application with PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

**IMPORTANT:** PM2 will show you a command to run. Copy and paste that entire command.

It will look like:
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user
```

---

### Step 9: Verify App is Running

```bash
pm2 status
```

You should see:
```
┌─────┬────────────────────┬─────────┬─────────┐
│ id  │ name               │ status  │ restart │
├─────┼────────────────────┼─────────┼─────────┤
│ 0   │ oda-pap-server     │ online  │ 0       │
└─────┴────────────────────┴─────────┴─────────┘
```

If status is **online**, continue!

Check the logs:
```bash
pm2 logs oda-pap-server --lines 20
```

You should see "ODA PAP SERVER" and "Running" messages.

Press `Ctrl + C` to exit logs.

---

## Part 4: Setup Nginx

### Step 10: Configure Nginx

```bash
sudo tee /etc/nginx/conf.d/oda-pap.conf > /dev/null << 'EOF'
upstream oda_pap_backend {
    server 127.0.0.1:5000;
    keepalive 64;
}

server {
    listen 80;
    listen [::]:80;
    
    server_name 13.201.184.44;
    
    client_max_body_size 10M;
    
    access_log /var/log/nginx/oda-pap-access.log;
    error_log /var/log/nginx/oda-pap-error.log;
    
    root /home/ec2-user/oda-pap;
    index index.html;
    
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;
    
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
    
    location / {
        try_files $uri $uri/ /index.html;
        expires 1d;
    }
    
    location ~* \.(css|js)$ {
        expires 7d;
    }
    
    location ~* \.(jpg|jpeg|png|gif|ico|svg|webp)$ {
        expires 30d;
    }
}
EOF
```

---

### Step 11: Start Nginx

```bash
sudo nginx -t
sudo systemctl start nginx
sudo systemctl enable nginx
sudo systemctl status nginx
```

Press `q` to exit the status view.

---

## Part 5: Configure AWS Security Group

### Step 12: Open Port 80 in AWS Console

1. Go to: https://console.aws.amazon.com/ec2/
2. Click **Security Groups** (left sidebar)
3. Find your security group (the one attached to your EC2 instance)
4. Click **Edit inbound rules**
5. Click **Add rule**
   - Type: **HTTP**
   - Port: **80**
   - Source: **0.0.0.0/0**
6. Click **Save rules**

---

## Part 6: Test Everything

### Step 13: Test Your Website

Open your browser and go to:

```
http://13.201.184.44
```

You should see your Oda Pap homepage!

Test the API:
```
http://13.201.184.44/api/health
```

You should see:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "environment": "production",
  "mpesa": {
    "environment": "live",
    "shortcode": "4986480",
    "callbackUrl": "http://13.201.184.44/api/mpesa/callback"
  },
  "firebase": "connected"
}
```

---

### Step 14: Update M-Pesa Callback (CRITICAL for LIVE)

**IMPORTANT:** You're using LIVE M-Pesa. You MUST update the callback URL.

1. Go to: https://developer.safaricom.co.ke
2. Login to your account
3. Go to **My Apps** → Select your LIVE app
4. Update these URLs:
   - **Validation URL:** `http://13.201.184.44/api/mpesa/validation`
   - **Confirmation URL:** `http://13.201.184.44/api/mpesa/callback`
5. Save changes

---

## You're Done! 🎉

**Your website is LIVE at:** http://13.201.184.44

**M-Pesa Environment:** LIVE (Real money transactions)

---

## Daily Commands

### Check Everything is Working

```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 status && pm2 logs oda-pap-server --lines 10 --nostream"
```

---

### View Live Logs

```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44
pm2 logs oda-pap-server
```

Press `Ctrl + C` to stop viewing logs.

---

### Restart Application

```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"
```

---

## Updating Your Code

### Method 1: Update Single File

If you changed just `server.js`:

```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" server.js ec2-user@13.201.184.44:~/oda-pap/
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"
```

---

### Method 2: Update Everything

If you changed multiple files:

```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" -r *.html *.css js css images ec2-user@13.201.184.44:~/oda-pap/
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"
```

**Note:** This won't overwrite your `.env` file on the server.

---

### Method 3: Update Server.js

If you changed `server.js`:

```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" server.js ec2-user@13.201.184.44:~/oda-pap/
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "cd ~/oda-pap && npm install && pm2 restart oda-pap-server"
```

---

## Troubleshooting

### Website Not Loading?

**Check if app is running:**
```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 status"
```

If status is **stopped** or **errored**:
```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs oda-pap-server --lines 50"
```

**Restart everything:**
```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server && sudo systemctl restart nginx"
```

---

### M-Pesa Payments Not Working?

**Check M-Pesa logs:**
```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs oda-pap-server | grep -i mpesa"
```

**Common LIVE environment issues:**
- Callback URL not updated in Daraja Portal
- IP whitelisting required (check Daraja Portal settings)
- Testing with wrong phone number (LIVE only works with real Safaricom numbers)

---
README.md
### View All Error Logs

```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs oda-pap-server --err --lines 100"
```

---

## One-Command Health Check

Run this anytime:

```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 << 'ENDSSH'
echo "=== PM2 Status ==="
pm2 status
echo ""
echo "=== App Running On ==="
curl -s http://localhost:5000/api/health | head -n 20
echo ""
echo "=== Recent Logs ==="
pm2 logs oda-pap-server --lines 15 --nostream
ENDSSH
```

---

## Important Notes for LIVE Environment

### You're Using LIVE M-Pesa

- Real money will be processed
- Test with small amounts first
- Customer will receive STK Push on their phone
- Money goes to shortcode **4986480**

### Phone Number Format

Must be Kenyan Safaricom numbers:
- Format: `254712345678` or `254112345678`
- Your code accepts: `0712345678` (automatically converts to `254712345678`)

### Transaction Flow

1. Customer enters phone number and amount
2. STK Push sent to their phone
3. They enter M-Pesa PIN
4. Payment processed
5. Callback received at: `http://13.201.184.44/api/mpesa/callback`
6. Transaction updated in Firebase

---

## Quick Reference

| Task | Command |
|------|---------|
| Check status | `ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 status"` |
| View logs | `ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs oda-pap-server"` |
| Restart app | `ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"` |
| Upload code | See "Updating Your Code" section above |

---

## Support

If something breaks, check the logs first:
```bash
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs oda-pap-server --lines 100"
```

Most errors show clear messages about what went wrong.