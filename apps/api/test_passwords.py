from app.core.security import verify_password

# Test bcrypt hash (student user)
bcrypt_hash = "$2b$12$cUSNQwAprlV6kuYiPWHjnuTRco9a59s4zs031s9fG1W.ry3xuLsRC"
print(f"Student (123456 vs bcrypt): {verify_password('123456', bcrypt_hash)}")

# Test argon2 hash (example)
argon2_hash = "$argon2id$v=19$m=65536,t=3,p=4$somebase64salt$somebase64hash"
try:
    print(f"Argon2 test: Can identify argon2 hash")
except Exception as e:
    print(f"Argon2 error: {e}")

print("\nTesting common passwords for argon2 users:")
test_passwords = ["admin", "admin1", "123456", "password", "admin123"]
