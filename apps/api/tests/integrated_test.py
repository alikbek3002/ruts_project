#!/usr/bin/env python3
"""
Интегрированный тест с авторизацией
Создает тестовые данные и проверяет весь flow
"""
import requests
import json
import io
from datetime import datetime, timedelta

API_BASE = "http://localhost:8000/api"

# Цвета
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

def print_info(text):
    print(f"{YELLOW}ℹ{RESET} {text}")

def print_step(text):
    print(f"\n{BLUE}→{RESET} {text}")

class APITester:
    def __init__(self):
        self.token = None
        self.headers = {}
        self.user_info = None
    
    def login(self, username, password):
        """Логин и получение токена"""
        print_step(f"Logging in as {username}...")
        response = requests.post(
            f"{API_BASE}/auth/login",
            json={"username": username, "password": password}
        )
        if response.status_code == 200:
            data = response.json()
            self.token = data.get("accessToken")  # Fixed: use accessToken
            self.user_info = data.get("user")
            self.headers = {"Authorization": f"Bearer {self.token}"}
            print_success(f"Logged in as {username} (Role: {self.user_info.get('role')})")
            return True
        else:
            print_error(f"Login failed: {response.status_code} - {response.text}")
            return False
    
    def test_library_flow(self):
        """Полный тест библиотеки: загрузка → просмотр → скачивание → удаление"""
        print_header("Testing Library Features")
        
        # 1. Получить список классов
        print_step("Getting classes list...")
        response = requests.get(f"{API_BASE}/classes", headers=self.headers)
        if response.status_code != 200:
            print_error(f"Failed to get classes: {response.status_code}")
            return False
        
        data = response.json()
        # API может вернуть {'classes': [...]} или просто [...]
        classes = data.get('classes', []) if isinstance(data, dict) else data
        
        if not classes or not isinstance(classes, list) or len(classes) == 0:
            print_error("No classes found. Please create a class first.")
            return False
        
        class_id = classes[0]["id"]
        print_success(f"Using class: {classes[0]['name']} (ID: {class_id})")
        
        # 2. Загрузить файл
        print_step("Uploading test file...")
        test_file_content = b"This is a test file for RUTS library testing.\nCreated at: " + datetime.now().isoformat().encode()
        files = {
            'file': ('test_document.txt', io.BytesIO(test_file_content), 'text/plain')
        }
        data = {
            'title': 'Test Document',
            'description': 'Automated test file',
            'class_id': class_id  # Fixed: API expects class_id, not classId
        }
        
        response = requests.post(
            f"{API_BASE}/library/upload",
            headers=self.headers,
            data=data,
            files=files
        )
        
        if response.status_code != 200:
            print_error(f"Upload failed: {response.status_code} - {response.text}")
            return False
        
        response_data = response.json()
        uploaded_item = response_data.get("item", response_data)  # API returns {'item': {...}}
        item_id = uploaded_item.get("id")
        if not item_id:
            print_error(f"No ID in upload response: {response_data}")
            return False
        print_success(f"File uploaded successfully! ID: {item_id}")
        print(f"  Title: {uploaded_item['title']}")
        print(f"  Storage path: {uploaded_item['storage_path']}")
        
        # 3. Получить список файлов
        print_step("Getting library items list...")
        response = requests.get(
            f"{API_BASE}/library",
            headers=self.headers,
            params={"classId": class_id}
        )
        
        if response.status_code != 200:
            print_error(f"Failed to get library items: {response.status_code}")
            return False
        
        response_data = response.json()
        items = response_data.get("items", response_data)  # API might return {'items': [...]}
        if not isinstance(items, list):
            print_error(f"Unexpected response format: {response_data}")
            return False
        
        found = any(item["id"] == item_id for item in items)
        if found:
            print_success(f"Uploaded file found in library ({len(items)} total items)")
        else:
            print_error("Uploaded file not found in library!")
            return False
        
        # 4. Получить URL для скачивания
        print_step("Getting download URL...")
        response = requests.get(
            f"{API_BASE}/library/{item_id}/download-url",
            headers=self.headers
        )
        
        if response.status_code != 200:
            print_error(f"Failed to get download URL: {response.status_code}")
            return False
        
        download_data = response.json()
        download_url = download_data["url"]
        print_success("Download URL generated")
        print(f"  URL length: {len(download_url)} chars")
        print(f"  Expires in: {download_data.get('expires_in', 'N/A')} seconds")
        
        # 5. Скачать файл
        print_step("Downloading file...")
        response = requests.get(download_url)
        if response.status_code != 200:
            print_error(f"Download failed: {response.status_code}")
            return False
        
        downloaded_content = response.content
        if downloaded_content == test_file_content:
            print_success(f"File downloaded successfully ({len(downloaded_content)} bytes)")
            print_success("Content matches original file!")
        else:
            print_error("Downloaded content doesn't match original!")
            return False
        
        # 6. Удалить файл
        print_step("Deleting file...")
        response = requests.delete(
            f"{API_BASE}/library/{item_id}",
            headers=self.headers
        )
        
        if response.status_code != 200:
            print_error(f"Delete failed: {response.status_code}")
            return False
        
        print_success("File deleted successfully")
        
        # 7. Проверить что файл удален
        print_step("Verifying file is deleted...")
        response = requests.get(
            f"{API_BASE}/library",
            headers=self.headers,
            params={"classId": class_id}
        )
        
        response_data = response.json()
        items = response_data.get("items", response_data)
        if not isinstance(items, list):
            items = []
        
        still_exists = any(item["id"] == item_id for item in items)
        if not still_exists:
            print_success("File is no longer in library")
        else:
            print_error("File still exists in library!")
            return False
        
        return True
    
    def test_zoom_features(self):
        """Тест Zoom функций"""
        print_header("Testing Zoom Features")
        
        # 1. Проверить статус Zoom OAuth
        print_step("Checking Zoom OAuth status...")
        response = requests.get(f"{API_BASE}/zoom/status", headers=self.headers)
        if response.status_code != 200:
            print_error(f"Failed to get Zoom status: {response.status_code}")
            return False
        
        zoom_status = response.json()
        is_connected = zoom_status.get("connected", False)
        
        if is_connected:
            print_success("Zoom account is connected")
            print(f"  Zoom User ID: {zoom_status.get('zoom_user_id', 'N/A')}")
        else:
            print_info("Zoom account is NOT connected")
            
            # Try to get OAuth start URL
            oauth_response = requests.get(f"{API_BASE}/zoom/oauth/start", headers=self.headers)
            if oauth_response.status_code == 200:
                auth_url = oauth_response.json().get("authUrl", "N/A")
                print(f"  OAuth URL: {auth_url[:80]}...")
                print_info("To connect Zoom:")
                print("    1. Open the OAuth URL in browser")
                print("    2. Authorize the app")
                print("    3. Complete OAuth flow")
            elif oauth_response.status_code == 500:
                print_error("Zoom OAuth not configured in .env")
                print("  Add ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI")
                return False
            
            print_info("Skipping Zoom meeting tests (no OAuth connection)")
            return True  # Не считаем ошибкой
        
        # 2. Получить расписание
        print_step("Getting timetable entries...")
        response = requests.get(f"{API_BASE}/timetable", headers=self.headers)
        if response.status_code != 200:
            print_error(f"Failed to get timetable: {response.status_code}")
            return False
        
        timetable = response.json()
        if not timetable:
            print_info("No timetable entries found. Cannot test meeting creation.")
            return True
        
        entry_id = timetable[0]["id"]
        print_success(f"Using timetable entry: {timetable[0].get('subject_name', 'N/A')}")
        
        # 3. Создать Zoom встречу
        print_step("Creating Zoom meeting...")
        meeting_start = (datetime.now() + timedelta(hours=1)).isoformat()
        
        response = requests.post(
            f"{API_BASE}/zoom/meetings",
            headers=self.headers,
            json={
                "timetableEntryId": entry_id,
                "startsAt": meeting_start
            }
        )
        
        if response.status_code != 200:
            print_error(f"Failed to create meeting: {response.status_code} - {response.text}")
            return False
        
        meeting = response.json()
        meeting_id = meeting["id"]
        print_success(f"Meeting created! ID: {meeting_id}")
        print(f"  Join URL: {meeting.get('join_url', 'N/A')[:50]}...")
        print(f"  Start URL: {meeting.get('start_url', 'N/A')[:50]}...")
        
        # 4. Получить список встреч
        print_step("Getting meetings list...")
        response = requests.get(f"{API_BASE}/zoom/meetings", headers=self.headers)
        if response.status_code != 200:
            print_error(f"Failed to get meetings: {response.status_code}")
            return False
        
        meetings = response.json()
        found = any(m["id"] == meeting_id for m in meetings)
        if found:
            print_success(f"Created meeting found in list ({len(meetings)} total meetings)")
        else:
            print_error("Created meeting not found in list!")
            return False
        
        # 5. Удалить встречу
        print_step("Deleting meeting...")
        response = requests.delete(
            f"{API_BASE}/zoom/meetings/{meeting_id}",
            headers=self.headers
        )
        
        if response.status_code != 200:
            print_error(f"Delete failed: {response.status_code}")
            return False
        
        print_success("Meeting deleted successfully")
        
        return True

def main():
    print_header("RUTS Integrated Test Suite")
    print(f"API Base: {API_BASE}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # Попробовать разные учетные данные
    test_users = [
        {"username": "teacher1", "password": "password123"},
        {"username": "admin", "password": "admin123"},
        {"username": "test_teacher", "password": "test123"}
    ]
    
    tester = None
    for user in test_users:
        tester = APITester()
        if tester.login(user["username"], user["password"]):
            break
    else:
        print_error("Could not login with any test credentials!")
        print_info("\nPlease create a test user:")
        print("  1. Login to Supabase dashboard")
        print("  2. Go to Table Editor → users")
        print("  3. Insert row:")
        print("     - username: test_teacher")
        print("     - password: test123 (will be hashed)")
        print("     - role: teacher")
        print("     - full_name: Test Teacher")
        return 1
    
    results = []
    
    # Test library
    results.append(("Library Features", tester.test_library_flow()))
    
    # Test Zoom
    results.append(("Zoom Features", tester.test_zoom_features()))
    
    # Summary
    print_header("Test Results Summary")
    for name, passed in results:
        status = f"{GREEN}PASSED{RESET}" if passed else f"{RED}FAILED{RESET}"
        print(f"{name}: {status}")
    
    passed_count = sum(1 for _, p in results if p)
    total_count = len(results)
    
    print(f"\nTotal: {passed_count}/{total_count} test suites passed")
    
    if passed_count == total_count:
        print(f"\n{GREEN}{'='*60}")
        print(f"{'All tests passed! ✓'.center(60)}")
        print(f"{'='*60}{RESET}\n")
        return 0
    else:
        print(f"\n{RED}{'='*60}")
        print(f"{'Some tests failed!'.center(60)}")
        print(f"{'='*60}{RESET}\n")
        return 1

if __name__ == "__main__":
    try:
        exit(main())
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Tests interrupted by user{RESET}")
        exit(130)
    except Exception as e:
        print_error(f"Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
