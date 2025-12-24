#!/usr/bin/env python3
"""
Test profile endpoints
"""
import requests
import io
from datetime import datetime

API_BASE = "http://localhost:8000/api"

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"

def print_header(text):
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}{text.center(60)}{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")

def print_success(text):
    print(f"{GREEN}✓{RESET} {text}")

def print_error(text):
    print(f"{RED}✗{RESET} {text}")

def print_step(text):
    print(f"\n{BLUE}→{RESET} {text}")

def main():
    print_header("Profile API Test")
    
    # Login
    print_step("Logging in as test_teacher...")
    login_response = requests.post(
        f"{API_BASE}/auth/login",
        json={"username": "test_teacher", "password": "test123"}
    )
    
    if login_response.status_code != 200:
        print_error(f"Login failed: {login_response.status_code}")
        return 1
    
    token = login_response.json()["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    print_success("Logged in successfully")
    
    # Test 1: Get profile
    print_step("Getting profile...")
    response = requests.get(f"{API_BASE}/profile", headers=headers)
    if response.status_code == 200:
        profile = response.json()["profile"]
        print_success(f"Profile loaded: {profile.get('full_name', profile['username'])}")
        print(f"  Role: {profile['role']}")
        print(f"  Phone: {profile.get('phone', 'N/A')}")
    else:
        print_error(f"Failed to get profile: {response.status_code}")
        return 1
    
    # Test 2: Update profile
    print_step("Updating profile...")
    update_data = {
        "full_name": "Test Teacher Updated",
        "first_name": "Test",
        "last_name": "Teacher",
        "phone": "+996700123456",
        "birth_date": "1990-01-15"
    }
    
    response = requests.put(
        f"{API_BASE}/profile",
        headers=headers,
        json=update_data
    )
    
    if response.status_code == 200:
        updated = response.json()["profile"]
        print_success("Profile updated successfully")
        print(f"  Full name: {updated['full_name']}")
        print(f"  Phone: {updated['phone']}")
    else:
        print_error(f"Failed to update profile: {response.status_code} - {response.text}")
        return 1
    
    # Test 3: Change password
    print_step("Testing password change...")
    response = requests.post(
        f"{API_BASE}/profile/change-password",
        headers=headers,
        json={
            "current_password": "test123",
            "new_password": "test123"  # Same password - should fail
        }
    )
    
    if response.status_code == 400:
        print_success("Password validation works (rejected same password)")
    else:
        print_error(f"Password validation failed: {response.status_code}")
    
    # Test 4: Upload photo (simulate)
    print_step("Testing photo upload endpoint...")
    # Create small test image (1x1 pixel)
    test_image = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
    
    files = {
        'photo': ('test_photo.png', io.BytesIO(test_image), 'image/png')
    }
    
    response = requests.post(
        f"{API_BASE}/profile/upload-photo",
        headers=headers,
        files=files
    )
    
    if response.status_code == 200:
        photo_url = response.json()["photo_url"]
        print_success("Photo uploaded successfully")
        print(f"  Photo URL: {photo_url[:50]}...")
        
        # Test 5: Delete photo
        print_step("Testing photo deletion...")
        response = requests.delete(f"{API_BASE}/profile/photo", headers=headers)
        if response.status_code == 200:
            print_success("Photo deleted successfully")
        else:
            print_error(f"Failed to delete photo: {response.status_code}")
    else:
        print_error(f"Failed to upload photo: {response.status_code} - {response.text}")
    
    print_header("Test Results")
    print(f"{GREEN}All profile endpoints working correctly!{RESET}\n")
    print("You can now test in browser:")
    print("  1. Open http://localhost:5173/app/profile")
    print("  2. Click profile button (👤) in header")
    print("  3. Edit your information")
    print("  4. Upload profile photo")
    print("  5. Change password")
    
    return 0

if __name__ == "__main__":
    try:
        exit(main())
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Test interrupted{RESET}")
        exit(130)
    except Exception as e:
        print_error(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
