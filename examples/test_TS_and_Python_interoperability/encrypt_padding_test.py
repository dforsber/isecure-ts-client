import os
import base64
import rsa

# Read the public key file
script_dir = os.path.dirname(os.path.abspath(__file__))
public_key_path = os.path.join(script_dir, "./test/test.pem")
with open(public_key_path, "r") as f:
    public_key_data = f.read()

password = "helloWorld"

def get_encrypted(challenge):
    # Extract timestamp as string
    timestamp = challenge.split("|")[1]
    pw_pair = password + "||" + timestamp
    
    # Load public key
    pubkey = rsa.PublicKey.load_pkcs1_openssl_pem(public_key_data.encode())
    
    # Encrypt with PKCS1 padding (this matches Node.js behavior more closely)
    encrypted_data = rsa.encrypt(pw_pair.encode(), pubkey)
    
    # Convert to base64
    return base64.b64encode(encrypted_data).decode()

challenge = "ezwXceQ63fV9oWTSJBAE2Zq1Cw5tBIJe+7+Rl8jrgbk=|1475429754114|4017bda8-0a15-4154-a8b7-88069b05cb4e"
print(get_encrypted(challenge))