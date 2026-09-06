# ChDevAgent Local Gateway — MVP

Đây là PC Agent vertical slice đầu tiên của ChDevAgent. Gateway chạy cục bộ bằng Node.js, không gọi API bên thứ ba và chỉ cung cấp công cụ đọc trong workspace. Mục tiêu của bản này là kiểm chứng chuỗi:

> ghép nối thiết bị → tạo task → xem preview → approve/reject → thực thi read-only → audit log.

## Chạy thử

Yêu cầu Node.js 20 trở lên. Từ thư mục `chdevagent-agent`, chạy:

```bash
npm start
```

Gateway mặc định chạy tại `http://127.0.0.1:8228`. Mã pairing được in trong terminal. Workspace mặc định là thư mục `workspace` bên cạnh file `agent.mjs`. Gateway đồng thời phục vụ mobile controller tại `/`, vì vậy có thể mở URL này từ trình duyệt điện thoại khi hai thiết bị ở cùng LAN.

Để chọn workspace khác:

```bash
CHDEVAGENT_WORKSPACE="/path/to/your/workspace" npm start
```

Để cho phép thiết bị khác trong cùng LAN truy cập, chỉ bật sau khi đã hiểu rõ firewall và mạng nội bộ. Sau khi chạy, mở `http://IP_CUA_PC:8228` trên điện thoại; không mở cổng này ra internet:

```bash
HOST=0.0.0.0 CHDEVAGENT_WORKSPACE="/path/to/your/workspace" npm start
```

## API tối thiểu

Ghép nối:

```bash
curl http://127.0.0.1:8228/api/pairing/status
curl -X POST http://127.0.0.1:8228/api/pairing/confirm \
  -H 'content-type: application/json' \
  -d '{"code":"123456","deviceName":"My phone"}'
```

Lệnh xác nhận trả về token. Dùng token trong header `Authorization: Bearer <token>` cho các request tiếp theo.

Tạo task đọc thư mục:

```bash
curl -X POST http://127.0.0.1:8228/api/tasks \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <token>' \
  -d '{"instruction":"Liệt kê tài liệu trong workspace","requestedTools":["file.list"],"relativePath":"."}'
```

Sau khi người dùng xem preview, gọi `POST /api/tasks/<task_id>/approve` hoặc `/reject`. Trạng thái và log nằm ở `/api/tasks`, `/api/tasks/<task_id>` và `/api/audit`.

## Giới hạn an toàn của MVP

Bản này không chạy shell tùy ý, không mở ứng dụng, không gửi tin nhắn và không ghi/xóa file. Tất cả đường dẫn được canonicalize và phải nằm trong workspace đã cấu hình. Kích thước file đọc bị giới hạn 1 MB. Token được lưu trong bộ nhớ; khởi động lại gateway sẽ yêu cầu ghép nối lại.

Đây là local development scaffold, chưa phải installer desktop và chưa nên mở port ra internet. Trước khi dùng trên PC thật, cần bổ sung token persistence an toàn, HTTPS hoặc cơ chế mã hóa LAN phù hợp, rate limit, QR pairing thực, log bền vững và test tự động.
