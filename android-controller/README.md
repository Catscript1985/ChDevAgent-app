# ChDevAgent Controller — Android

Đây là mobile controller Expo cho ChDevAgent. Ứng dụng kết nối trực tiếp tới PC Agent qua địa chỉ IP LAN, không cần tài khoản cloud và không dùng API AI bên thứ ba.

## Chạy thử bằng Expo

Cài Node.js 20+ rồi chạy trong thư mục này:

```bash
npm install
npx expo start
```

Có thể mở bằng Expo Go để thử giao diện. Trên ứng dụng, nhập địa chỉ PC, ví dụ `http://192.168.1.24:8228`, sau đó nhập pairing code được in bởi PC Agent.

## Build APK debug

Để tạo APK cài thử nội bộ, máy build cần Android SDK/JDK hoặc dùng dịch vụ build Expo/EAS. Luồng dự kiến:

```bash
npx expo install
npx eas login
npx eas build:configure
npx eas build --platform android --profile preview
```

Bản preview tạo APK để cài thủ công trên Android. Bản release cần cấu hình signing key riêng; không nên dùng debug key cho phân phối chính thức.

## Giới hạn hiện tại

Màn hình đã hỗ trợ pairing, tạo task read-only, xem preview, approve/reject và theo dõi trạng thái. Đây chưa phải bản release store: chưa có QR scanner, push notification, secure token persistence, audit screen riêng hoặc certificate pinning.

## Kết nối relay HTTPS v0.8

Có thể kết nối ngoài mạng Wi‑Fi bằng cách nhập **Relay HTTPS**, **API key cá nhân** và **PC device ID** trong màn hình thiết lập. API key được cấp từ website và có thể thu hồi; không nhập API Admin vào APK. PC Agent cần chạy với `CHDEVAGENT_RELAY_URL` trỏ tới URL website relay và `CHDEVAGENT_AGENT_TOKEN` là token enrollment riêng của PC.

Nếu để trống Relay HTTPS, ứng dụng vẫn hỗ trợ đường LAN cũ bằng địa chỉ dạng `http://IP-máy-tính:8228`. Chế độ relay hiện gửi task qua API HTTPS, vẫn hiển thị preview và yêu cầu người dùng phê duyệt trước khi task được đưa vào queue.


## Chế độ relay-only trên PC

Khi quy trình web đã được kiểm thử đầy đủ, PC Agent có thể chạy với `CHDEVAGENT_RELAY_ONLY=1`. Ở chế độ này, task chỉ được thực thi sau khi relay đã ghi nhận thao tác phê duyệt từ người dùng trên web/điện thoại. Khi chưa bật biến này, PC Agent giữ local approval fallback để tương thích bản cũ.
