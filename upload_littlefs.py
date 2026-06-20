import subprocess
import os

def main():
    mklittlefs_path = r"C:\Users\Sharvesh\AppData\Local\Arduino15\packages\esp32\tools\mklittlefs\4.0.2-db0513a\mklittlefs.exe"
    esptool_path = r"C:\Users\Sharvesh\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.3.0\esptool.exe"
    
    data_dir = r"e:\School Bell\data"
    bin_out = r"e:\School Bell\spiffs.bin"
    
    # LittleFS parameters from default.csv
    partition_size = 1441792  # 0x160000 bytes
    offset = "0x290000"       # 0x290000 offset
    
    print("Building LittleFS binary image from data/ directory...")
    build_cmd = [
        mklittlefs_path,
        "-c", data_dir,
        "-p", "256",
        "-b", "4096",
        "-s", str(partition_size),
        bin_out
    ]
    
    print(f"Running: {' '.join(build_cmd)}")
    res1 = subprocess.run(build_cmd, capture_output=True, text=True)
    if res1.returncode != 0:
        print("Error building LittleFS binary:")
        print(res1.stderr)
        return
        
    print("LittleFS image built successfully. Size of spiffs.bin:", os.path.getsize(bin_out), "bytes")
    
    print(f"Flashing LittleFS image to ESP32 on COM5 at address {offset}...")
    flash_cmd = [
        esptool_path,
        "--chip", "esp32",
        "--port", "COM5",
        "--baud", "921600",
        "write_flash",
        offset,
        bin_out
    ]
    
    print(f"Running: {' '.join(flash_cmd)}")
    res2 = subprocess.run(flash_cmd, capture_output=True, text=True)
    if res2.returncode != 0:
        print("Error flashing image:")
        print(res2.stderr)
        return
        
    print("Successfully uploaded the dashboard to ESP32 LittleFS partition!")
    
    print("Cleaning up temporary binary...")
    if os.path.exists(bin_out):
        os.remove(bin_out)

if __name__ == '__main__':
    main()
