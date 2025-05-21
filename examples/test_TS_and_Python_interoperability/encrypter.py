# encrypter.py
import base64
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA1

# Generate a new RSA key pair
key = RSA.generate(2048)
private_key = key.export_key()
public_key = key.publickey().export_key()

# Save keys to files
with open("py_public_key.pem", "wb") as f:
    f.write(public_key)

with open("py_private_key.pem", "wb") as f:
    f.write(private_key)

password = "helloWorld"

def get_encrypted(challenge):
    # Extract timestamp as string
    timestamp = challenge.split("|")[1]
    pw_pair = password + "||" + timestamp
    
    # Load the public key
    public_key_obj = RSA.import_key(public_key)
    
    # Create cipher using PKCS1_OAEP
    cipher = PKCS1_OAEP.new(public_key_obj, hashAlgo=SHA1)
    
    # Encrypt the data
    encrypted_data = cipher.encrypt(pw_pair.encode('utf-8'))
    
    # Convert to base64
    return base64.b64encode(encrypted_data).decode()

challenge = "ezwXceQ63fV9oWTSJBAE2Zq1Cw5tBIJe+7+Rl8jrgbk=|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e"
encrypted = get_encrypted(challenge)
print("Encrypted data:", encrypted)

# Save encrypted data to file for TypeScript to read
with open("py_encrypted.txt", "w") as f:
    f.write(encrypted)