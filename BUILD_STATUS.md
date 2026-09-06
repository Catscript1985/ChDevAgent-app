# Build status — ChDevAgent

## Đã chuẩn bị

| Artifact | Trạng thái |
|---|---|
| PC Agent source | Hoàn thành MVP read-only |
| Mobile controller source | Hoàn thành Expo controller prototype |
| Windows 10 packaging script | Đã tạo `packaging/windows/build.ps1` |
| Android Expo config | Đã tạo `android-controller/app.json` và `package.json` |
| APK binary | Chưa build trong sandbox vì chưa có Android SDK/ADB hoặc Expo build credentials |
| EXE binary | Chưa build và kiểm thử trong sandbox vì không có Windows build/runtime environment |

## Khi có máy Windows 10 được bind

Chạy `packaging/windows/build.ps1` trong PowerShell để tạo thư mục Windows package, sau đó có thể dùng công cụ đóng gói Windows phù hợp để tạo installer/EXE. PC Agent cần quyền Private Network trong Windows Firewall và một workspace cụ thể do người dùng chọn.

## Khi có Android build environment

Trong `android-controller`, chạy `npm install`, sau đó dùng Expo/EAS để tạo APK preview. APK release cần signing key riêng. Không nên phát hành bản chưa ký hoặc đặt credential trong source.

> Không gọi đây là APK/EXE hoàn chỉnh cho đến khi binary được build và kiểm thử trên thiết bị/Windows mục tiêu.
