# ⚡ Quick Deployment Cheat Sheet

For experienced users - condensed version of deployment steps.

## ✅ Your EC2 Instance (Already Running!)

```bash
# Instance Details
Instance ID: i-0cb5f7cb8da5e0128
Public IP: 13.201.184.44
Region: ap-south-1 (Mumbai)
OS: Amazon Linux 2023
Key: oda-pap-key.pem

# TODO: Configure Security Group
- Add Inbound Rules: HTTP (80), HTTPS (443), Custom TCP (5000)
```

## 💻 Connect & Setup (10 minutes)

```bash
# SSH to instance (Amazon Linux uses 'ec2-user' not 'ubuntu')
ssh -i oda-pap-key.pem ec2-user@13.201.184.44

# Install everything (Amazon Linux uses dnf, not apt)
sudo dnf update -y
sudo dnf install -y nodejs nginx git
sudo npm install -g pm2

# Create app directory
mkdir ~/oda-pap && cd ~/oda-pap
```

## 📦 Deploy App (5 minutes)

```bash
# Upload files (from local machine - run in PowerShell)
scp -i oda-pap-key.pem -r * ec2-user@13.201.184.44:~/oda-pap/

# On server: Configure
nano .env  # Add your M-Pesa credentials
npm install
mkdir logs

# Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # Run the command it shows
```

## 🌐 Configure Nginx (3 minutes)

```bash
# Amazon Linux nginx config is in /etc/nginx/conf.d/
sudo nano /etc/nginx/conf.d/oda-pap.conf
```

```nginx
server {
    listen 80;
    server_name 13.201.184.44;
    client_max_body_size 50M;
    
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location / {
        root /home/ubuntu/oda-pap;
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# Amazon Linux doesn't use sites-available/enabled
# Config is already in /etc/nginx/conf.d/
sudo systemctl enable nginx
sudo systemctl start nginx
sudo nginx -t && sudo systemctl restart nginx
```

## ✅ Test & Verify

```bash
# Test health
curl http://13.201.184.44/api/health

# Monitor
pm2 logs
pm2 monit
```

## 🔒 Optional: SSL (If you have domain)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## 🛡️ Security

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 🔧 Common Commands

```bash
# PM2
pm2 restart oda-pap-server
pm2 logs oda-pap-server
pm2 monit

# Nginx
sudo systemctl restart nginx
sudo nginx -t

# Logs
tail -f ~/oda-pap/logs/combined.log
```

## 📝 Update .env Template

```env
MPESA_ENVIRONMENT=live
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE=4986480
MPESA_PASSKEY=your_passkey
PORT=5000
NODE_ENV=production
CALLBACK_URL=http://13.201.184.44/api/mpesa/callback
```

## ✨ Done!

Your server: `http://13.201.184.44/api`
API endpoint: `http://13.201.184.44/api/mpesa/stkpush`

Total time: ~25 minutes
