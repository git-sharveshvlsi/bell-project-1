import subprocess
import os

def run_cmd(args):
    print(f"Running: {' '.join(args)}")
    res = subprocess.run(args, capture_output=True, text=True)
    if res.stdout:
        print("STDOUT:")
        print(res.stdout)
    if res.stderr:
        print("STDERR:")
        print(res.stderr)
    return res.returncode

def main():
    cli_path = r"bin\arduino-cli.exe"
    
    # 1. Config Init
    run_cmd([cli_path, "config", "init"])
    
    # 2. Add ESP32 URL
    esp32_url = "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json"
    run_cmd([cli_path, "config", "set", "board_manager.additional_urls", esp32_url])
    
    # 3. Update Index
    print("Updating board index...")
    run_cmd([cli_path, "core", "update-index"])
    
    # 4. Install esp32 core
    print("Installing esp32:esp32 platform core (this might take a few minutes)...")
    run_cmd([cli_path, "core", "install", "esp32:esp32"])
    
    # 5. Verify core installation
    print("Verifying installed platforms...")
    run_cmd([cli_path, "core", "list"])

if __name__ == '__main__':
    main()
