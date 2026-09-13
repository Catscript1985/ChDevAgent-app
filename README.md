# ChDevAgent v2 — PC Agent local-first

ChDevAgent v2 là PC Agent cục bộ được điều khiển từ điện thoại. Giao diện tiếng Việt chia thành **Trợ lý trò chuyện** và **Agent thực thi**. Chatbot dùng để hỏi đáp, giải thích và lập kế hoạch; Agent chỉ chạy capability đã được bật, luôn tạo preview trước và yêu cầu phê duyệt.

> Luồng bảo vệ: ghép nối thiết bị → gửi yêu cầu → tạo preview → xem phạm vi/quyền → phê duyệt hoặc từ chối → theo dõi trạng thái → ghi audit log.

## Chạy trên Windows 10

Giải nén gói Windows và chạy `Start-ChDevAgent.bat`. Cửa sổ terminal sẽ hiển thị địa chỉ, workspace và mã ghép nối. Không đóng cửa sổ trong khi điện thoại đang kết nối.

Nếu chạy bằng Node.js trực tiếp, yêu cầu Node.js 20 trở lên:

```bash
npm start
```

Gateway mặc định chạy tại `http://127.0.0.1:8228`. Để điện thoại trong cùng mạng LAN truy cập, chỉ dùng mạng Private tin cậy và chạy:

```bash
HOST=0.0.0.0 CHDEVAGENT_WORKSPACE="C:\\ChDevAgent\\workspace" npm start
```

Trên Windows, nên dùng file `.bat` đi kèm thay vì gõ biến môi trường thủ công. Không mở cổng 8228 ra Internet.

## Capability v2

Capability đang bật mặc định là `file.list` và `file.read`, đều chỉ đọc trong workspace được cấp phép. Các capability chụp màn hình, OCR, điều khiển trình duyệt và điều khiển hệ thống hiện được hiển thị là **chưa bật**; chúng cần adapter Windows riêng, preview chi tiết, quyền rõ ràng và kiểm thử an toàn trước khi mở.

## API trạng thái

Sau khi pairing, dùng `Authorization: Bearer <token>`:

| Endpoint | Mục đích |
|---|---|
| `GET /api/health` | Kiểm tra gateway không cần pairing |
| `GET /api/status` | Trạng thái realtime, bước hiện tại, phần trăm và log tóm tắt |
| `GET /api/capabilities` | Danh sách quyền/capability và trạng thái bật tắt |
| `GET /api/plan` | Kế hoạch của task đang chạy |
| `GET /api/recent-files` | Các tệp gần đây trong workspace |
| `GET /api/history` | Lịch sử task và audit event của thiết bị |
| `POST /api/stop` | Dừng các task của thiết bị hiện tại |

Tạo một task read-only:

```bash
curl -X POST http://127.0.0.1:8228/api/tasks \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <token>' \
  -d '{"instruction":"Liệt kê tài liệu trong workspace","requestedTools":["file.list"],"relativePath":"."}'
```

Sau khi xem preview, gọi `POST /api/tasks/<task_id>/approve`, `/reject` hoặc `/cancel`. Gateway lưu state, lịch sử và audit log trong file ẩn `.chdevagent-state.json` bên trong workspace.

## Giới hạn bảo vệ

PC Agent không chạy shell tùy ý, không tự mở ứng dụng, không gửi tin nhắn, không ghi/xóa file và không tự thực thi khi chưa có phê duyệt. Mọi đường dẫn được canonicalize và phải nằm trong workspace. File đọc bị giới hạn 1 MB. Pairing token được lưu state local để giữ lịch sử, nhưng bản này vẫn là development scaffold; trước khi mở rộng ra Internet cần HTTPS/TLS, rate limit, QR pairing có thu hồi, mã hóa state và kiểm toán bảo mật.


## Kết nối HTTPS relay ngoài mạng LAN

Bản v0.8 hỗ trợ PC Agent chủ động gọi relay qua HTTPS nên không cần mở port 8228 hoặc port forwarding. Sau khi tài khoản đã tạo device token riêng, đặt các biến môi trường trước khi chạy Agent:

```bat
set CHDEVAGENT_RELAY_URL=https://ten-relay-cua-ban.example.com
set CHDEVAGENT_AGENT_TOKEN=cda_token_rieng_cua_device
set CHDEVAGENT_RELAY_ONLY=0
Start-ChDevAgent.bat
```

`CHDEVAGENT_AGENT_TOKEN` chỉ dùng cho đúng PC device, không dùng API Admin và không ghi vào mã nguồn. PC Agent gửi heartbeat, kéo task đã được phê duyệt, cập nhật trạng thái và tự retry với exponential backoff khi mạng tạm thời mất. Có thể đặt `CHDEVAGENT_RELAY_ONLY=1` sau khi đã kiểm thử đầy đủ; khi đó task relay được web/điện thoại phê duyệt mới được chạy, còn mặc định vẫn giữ local approval fallback để tương thích bản cũ.

Không đưa token vào ảnh chụp màn hình, log công khai hoặc GitHub. Khi nghi ngờ lộ token, thu hồi device/API key trên relay và cấp token mới.
