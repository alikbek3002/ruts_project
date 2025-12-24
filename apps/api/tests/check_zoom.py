#!/usr/bin/env python3
"""
Quick Zoom status check
"""
import requests

API_BASE = "http://localhost:8000/api"

# Login
print("Logging in...")
login_response = requests.post(
    f"{API_BASE}/auth/login",
    json={"username": "test_teacher", "password": "test123"}
)

if login_response.status_code != 200:
    print(f"❌ Login failed: {login_response.status_code}")
    exit(1)

token = login_response.json()["accessToken"]
headers = {"Authorization": f"Bearer {token}"}
print("✅ Logged in\n")

# Check Zoom status
print("Checking Zoom OAuth status...")
response = requests.get(f"{API_BASE}/zoom/status", headers=headers)

print(f"Status code: {response.status_code}")
print(f"Response: {response.json()}")

if response.status_code == 200:
    data = response.json()
    if data.get("connected"):
        print("\n✅ Zoom is connected!")
        print(f"   Zoom User ID: {data.get('zoom_user_id', 'N/A')}")
    else:
        print("\n⚠️  Zoom is NOT connected")
        print("\nTo connect:")
        print("1. Get OAuth URL from /zoom/oauth/start")
        print("2. Open it in browser")
        print("3. Authorize the app")
        print("4. You'll be redirected back")
else:
    print(f"\n❌ Failed to check status: {response.text}")

# Check if credentials are configured
print("\n" + "="*60)
print("Checking if Zoom credentials are configured...")
response = requests.get(f"{API_BASE}/zoom/oauth/start", headers=headers)
if response.status_code == 200:
    auth_url = response.json().get("authUrl", "N/A")
    print("✅ Zoom OAuth is configured (credentials are set)")
    print(f"   Auth URL: {auth_url[:80]}...")
    print("\nYou can connect Zoom by opening this URL:")
    print(f"   {auth_url}")
elif response.status_code == 500:
    print("❌ Zoom OAuth NOT configured")
    print("   Add to .env:")
    print("   ZOOM_CLIENT_ID=your_client_id")
    print("   ZOOM_CLIENT_SECRET=your_client_secret")
    print("   ZOOM_REDIRECT_URI=http://localhost:8000/api/zoom/oauth/callback")
else:
    print(f"⚠️  Unexpected response: {response.status_code}")
    print(f"   {response.text}")
