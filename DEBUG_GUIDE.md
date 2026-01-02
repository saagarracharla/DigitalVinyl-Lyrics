# Debug Guide: Playlists Loading Error

## Quick Fix Steps

### 1. Check Browser Console
Open browser DevTools (F12) and check the Console tab for the actual error message.

### 2. Check Server Logs
Look at your terminal where `python3 main.py` is running for error messages.

### 3. Common Issues & Solutions

#### Issue: "Spotify not connected"
**Solution**: 
- Make sure you've authenticated with Spotify
- Visit the main page first: `http://localhost:5004`
- You may need to re-authenticate (Spotify will redirect you)

#### Issue: "401 Unauthorized" or "403 Forbidden"
**Solution**:
- You need to re-authenticate with the new scopes
- Clear your browser cookies for localhost
- Restart the server
- Visit the page again - Spotify will ask for new permissions

#### Issue: "No playlists found"
**Solution**:
- Make sure you have playlists in your Spotify account
- Try creating a test playlist in Spotify first

#### Issue: Network Error
**Solution**:
- Check your internet connection
- Make sure Spotify API is accessible
- Check firewall settings

### 4. Test the API Directly

Open browser console and run:
```javascript
fetch('/api/playlists?limit=10')
  .then(r => r.json())
  .then(data => console.log('Playlists:', data))
  .catch(err => console.error('Error:', err))
```

This will show you the exact error message.

### 5. Check Authentication

Run this in browser console:
```javascript
fetch('/api/access-token')
  .then(r => r.json())
  .then(data => console.log('Token:', data))
  .catch(err => console.error('Error:', err))
```

If this fails, you need to re-authenticate.

### 6. Re-authenticate

1. Stop the server (Ctrl+C)
2. Clear browser cookies for `localhost:5004`
3. Restart server: `python3 main.py`
4. Visit: `http://localhost:5004`
5. Spotify will redirect you to authorize
6. Grant all permissions
7. You'll be redirected back

### 7. Verify Scopes

Make sure your `.env` file has the correct redirect URI and that it matches what's in your Spotify app settings.

