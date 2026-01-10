# 🛒 Oda Pap - Online Marketplace

A marketplace app with M-Pesa payments, built with HTML/CSS/JS and Firebase.

---

## 🚀 Quick Setup (5 minutes)

### 1. Get the code
```bash
git clone https://github.com/YOUR_USERNAME/oda-pap.git
cd oda-pap
```

### 2. Create your secrets file
```bash
# Copy the example file
cp .env.example .env

# Open .env and fill in your real values
```

### 3. Install and run
```bash
npm install
node server.js
```

### 4. Open in browser
Go to: `http://localhost:5000`

---

## 📁 What's What?

```
oda-pap/
├── index.html      ← Homepage
├── server.js       ← Backend server (handles M-Pesa)
├── .env            ← Your secrets (NEVER share this!)
├── .env.example    ← Template for .env
├── js/             ← JavaScript files
│   ├── firebase.js ← Firebase connection
│   └── mpesa.js    ← M-Pesa payments
└── css/            ← Styling
```

---

## 🔐 Important: Keeping Secrets Safe

**These files contain passwords. NEVER upload them:**
- `.env` - Your M-Pesa keys, Firebase keys
- `*.pem` - SSH keys for server access

**The `.gitignore` file automatically hides them from Git.**

---

## 🖥️ Your Live Server

| Info | Value |
|------|-------|
| Website | http://13.201.184.44 |
| Server | Amazon EC2 (Mumbai) |
| Status | ✅ Running |

---

## 🔧 Common Tasks

### Check if server is running
```powershell
ssh -i "path/to/oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 status"
```

### Restart the server
```powershell
ssh -i "path/to/oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"
```

### View server logs (see errors)
```powershell
ssh -i "path/to/oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs --lines 50"
```

### Upload new code to server
```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "path/to/oda-pap-key.pem" -r * ec2-user@13.201.184.44:~/oda-pap/
ssh -i "path/to/oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"
```

---

## 🆘 Something Broke?

### "Connection refused" error
**Problem:** Server isn't running  
**Fix:** 
```powershell
ssh -i "path/to/oda-pap-key.pem" ec2-user@13.201.184.44 "cd ~/oda-pap && pm2 start ecosystem.config.js"
```

### "404 Not Found" error
**Problem:** Wrong URL in the code  
**Fix:** Check `js/mpesa.js` line 21 has the right server IP

### "400 Bad Request" error
**Problem:** Data format is wrong  
**Fix:** Check the server logs to see what's missing:
```powershell
ssh -i "path/to/oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 logs --lines 30"
```

### M-Pesa not working
**Problem:** Wrong credentials or callback URL  
**Fix:** 
1. Check `.env` file on server has correct M-Pesa keys
2. Go to Daraja Portal → Update callback URL to: `http://13.201.184.44/api/mpesa/callback`

---

## 📱 M-Pesa Setup (Daraja Portal)

1. Go to https://developer.safaricom.co.ke
2. Login to your account
3. Go to **My Apps** → Select your app
4. Update **Callback URL** to: `http://13.201.184.44/api/mpesa/callback`
5. Copy your keys to the `.env` file

---

## 🔄 Updating Your Code

### Step 1: Make changes on your computer

### Step 2: Upload to server
```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
scp -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" -r * ec2-user@13.201.184.44:~/oda-pap/
```

### Step 3: Restart server (only if you changed server.js)
```powershell
ssh -i "C:\Users\Admin\OneDrive\Documents\Downloads\oda-pap-key.pem" ec2-user@13.201.184.44 "pm2 restart oda-pap-server"
```

### Step 4: Clear browser cache
Press `Ctrl + Shift + R` to see your changes

---

## 📤 Uploading to GitHub

### First time setup
```powershell
cd C:\Users\Admin\OneDrive\Documents\Desktop\oda-final1
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/oda-pap.git
git push -u origin main
```

### After making changes
```powershell
git add .
git commit -m "Describe what you changed"
git push
```

**⚠️ Before pushing, always check:**
```powershell
git status
```
Make sure `.env` is NOT listed. If it is, your `.gitignore` isn't working.

---

## 💡 Tips

1. **Always test locally first** before uploading to server
2. **Keep your `.pem` key safe** - it's the password to your server
3. **Check logs when things break** - they tell you what went wrong
4. **Clear browser cache** after updates - old code might be cached

---

## 📞 Need Help?

- Check server logs: `pm2 logs`
- Check nginx logs: `sudo tail -f /var/log/nginx/error.log`
- Firebase Console: https://console.firebase.google.com
- Daraja Portal: https://developer.safaricom.co.ke

---

Made with ❤️ for Oda Pap
