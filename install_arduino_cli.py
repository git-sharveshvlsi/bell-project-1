import os
import json
import urllib.request
import zipfile

def main():
    print("Fetching latest release information for arduino-cli...")
    req = urllib.request.Request(
        'https://api.github.com/repos/arduino/arduino-cli/releases/latest',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
    
    download_url = None
    for asset in data['assets']:
        name = asset['name']
        if 'Windows_64bit.zip' in name:
            download_url = asset['browser_download_url']
            break
            
    if not download_url:
        print("Error: Could not find Windows 64bit zip asset.")
        return
        
    print(f"Downloading from {download_url}...")
    zip_path = 'arduino-cli-windows.zip'
    urllib.request.urlretrieve(download_url, zip_path)
    
    print("Extracting archive...")
    dest_dir = 'bin'
    os.makedirs(dest_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(dest_dir)
        
    print("Cleaning up ZIP file...")
    os.remove(zip_path)
    
    cli_path = os.path.abspath(os.path.join(dest_dir, 'arduino-cli.exe'))
    print(f"Successfully installed! Executable located at: {cli_path}")
    print("Running version check...")
    import subprocess
    res = subprocess.run([cli_path, 'version'], capture_output=True, text=True)
    print(res.stdout)

if __name__ == '__main__':
    main()
