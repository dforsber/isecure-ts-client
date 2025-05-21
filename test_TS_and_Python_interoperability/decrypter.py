# decrypter.py
import base64
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA1

# Read the private key and encrypted data
with open("private_key.pem", "r") as f:
    private_key_data = f.read()

with open("encrypted.txt", "r") as f:
    encrypted_data = f.read()

def decrypt_data(encrypted_base64):
    # Load the private key
    private_key = RSA.import_key(private_key_data)
    
    # Create cipher for decryption
    cipher = PKCS1_OAEP.new(private_key, hashAlgo=SHA1)
    
    # Decode from base64 and decrypt
    encrypted_bytes = base64.b64decode(encrypted_base64)
    decrypted_data = cipher.decrypt(encrypted_bytes)
    
    return decrypted_data.decode('utf-8')

# Decrypt the data encrypted by TypeScript
try:
    decrypted = decrypt_data(encrypted_data)
    print("Successfully decrypted!")
    print("Decrypted data:", decrypted)
    
    # Verify the expected format
    parts = decrypted.split("||")
    if len(parts) == 2 and parts[0] == "helloWorld":
        print("Verification successful!")
        print(f"Password: {parts[0]}")
        print(f"Timestamp: {parts[1]}")
    else:
        print("Verification failed - unexpected format")
        
except Exception as e:
    print(f"Decryption failed: {e}")