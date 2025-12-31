#!/usr/bin/env python3
"""
Быстрый тест API endpoints
Проверяет доступность всех новых endpoints
"""
import requests
import json
from datetime import datetime

API_BASE = "http://localhost:8000/api"

# Цвета для консоли
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

def endpoint_check(method, path, expected_status, description, headers=None, data=None, files=None):
    """Тестирует один endpoint"""
    url = f"{API_BASE}{path}"
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=5)
        elif method == "POST":
            if files:
                response = requests.post(url, headers=headers, data=data, files=files, timeout=5)
            else:
                response = requests.post(url, headers=headers, json=data, timeout=5)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=5)
        else:
            print_error(f"{description}: Unknown method {method}")
            return False
        
        if response.status_code == expected_status:
            print_success(f"{description}: {response.status_code}")
            return True
        else:
            print_error(f"{description}: Expected {expected_status}, got {response.status_code}")
            if response.text:
                print(f"  Response: {response.text[:100]}")
            return False
    except requests.exceptions.ConnectionError:
        print_error(f"{description}: Connection refused - is API running?")
        return False
    except Exception as e:
        print_error(f"{description}: {str(e)}")
        return False

def main():
    print_header("RUTS API Endpoint Tests")
    print(f"Testing API at: {API_BASE}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    results = []
    
    # Test 1: Health check
    print_info("Testing basic endpoints...")
    results.append(endpoint_check("GET", "/health", 200, "Health check"))
    
    # Test 2: Library endpoints (без авторизации - должны вернуть 401)
    print_info("\nTesting library endpoints (unauthorized)...")
    results.append(endpoint_check("GET", "/library", 401, "List library items (no auth)"))
    results.append(endpoint_check("POST", "/library/upload", 401, "Upload file (no auth)"))
    results.append(endpoint_check("GET", "/library/fake-id/download-url", 401, "Get download URL (no auth)"))
    results.append(endpoint_check("DELETE", "/library/fake-id", 401, "Delete library item (no auth)"))
    
    # Test 3: Zoom endpoints (без авторизации - должны вернуть 401)
    print_info("\nTesting Zoom endpoints (unauthorized)...")
    results.append(endpoint_check("GET", "/zoom/status", 401, "Zoom status (no auth)"))
    results.append(endpoint_check("GET", "/zoom/oauth/start", 401, "Zoom OAuth start (no auth)"))
    results.append(endpoint_check("GET", "/zoom/meetings", 401, "List Zoom meetings (no auth)"))
    results.append(endpoint_check("POST", "/zoom/meetings", 401, "Create Zoom meeting (no auth)", 
                                data={"timetableEntryId": "fake", "startsAt": "2025-12-25T10:00:00"}))
    results.append(endpoint_check("DELETE", "/zoom/meetings/fake-id", 401, "Delete Zoom meeting (no auth)"))
    
    # Test 4: Auth endpoints
    print_info("\nTesting auth endpoints...")
    results.append(endpoint_check("POST", "/auth/login", 401, "Login with invalid credentials",
                                data={"username": "invalid", "password": "invalid"}))
    
    # Summary
    print_header("Test Results Summary")
    passed = sum(results)
    total = len(results)
    percentage = (passed / total * 100) if total > 0 else 0
    
    print(f"Total tests: {total}")
    print(f"{GREEN}Passed: {passed}{RESET}")
    print(f"{RED}Failed: {total - passed}{RESET}")
    print(f"Success rate: {percentage:.1f}%\n")
    
    if passed == total:
        print(f"{GREEN}{'='*60}")
        print(f"{'All tests passed! ✓'.center(60)}")
        print(f"{'='*60}{RESET}\n")
        return 0
    else:
        print(f"{RED}{'='*60}")
        print(f"{'Some tests failed!'.center(60)}")
        print(f"{'='*60}{RESET}\n")
        return 1

if __name__ == "__main__":
    try:
        exit(main())
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Tests interrupted by user{RESET}")
        exit(130)
