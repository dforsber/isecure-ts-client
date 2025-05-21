.PHONY: all clean test-ts-encrypt test-py-encrypt test-full setup

# Default target
all: setup test-full

# Install dependencies
setup:
	pip install pycryptodome

# Test TypeScript encryption and Python decryption
test-ts-encrypt:
	bun run encrypter.ts
	python decrypter.py
	@echo "TypeScript encryption → Python decryption: Test complete"

# Test Python encryption and TypeScript decryption
test-py-encrypt:
	python encrypter.py
	bun run decrypter.ts
	@echo "Python encryption → TypeScript decryption: Test complete"

# Run both tests
test-full: test-ts-encrypt test-py-encrypt
	@echo "All encryption/decryption tests completed successfully!"

# Cleanup generated files
clean:
	rm -f *.pem encrypted.txt py_encrypted.txt