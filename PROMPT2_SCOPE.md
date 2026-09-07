# ChDevAgent v2.0 — Phạm vi triển khai

## Mục tiêu

ChDevAgent v2 là hệ thống local-first: điện thoại gửi lệnh, PC Agent lập kế hoạch và chỉ thực thi sau khi hiển thị preview, phạm vi, quyền và yêu cầu phê duyệt. Giao diện và thông báo mặc định bằng tiếng Việt. Không sử dụng API bên ngoài hoặc dịch vụ cloud trong luồng điều khiển nội bộ.

## Hai hướng triển khai khả thi

| Hướng | Kết quả | Đánh đổi | Chi phí | Độ phức tạp |
|---|---|---|---|---|
| Giao diện v2 + local gateway an toàn | Có chat, Agent workspace, lịch sử, trạng thái realtime, menu công cụ, file read-only, pairing và approval | Chưa điều khiển chuột/bàn phím hoặc mọi ứng dụng hệ điều hành | Miễn phí | Vừa |
| Full desktop control | Bổ sung screenshot/OCR, app control, browser, chuột/bàn phím và hệ thống quyền Windows | Cần service Windows, quyền OS, kiểm thử sâu và cơ chế cấp quyền theo ứng dụng | Miễn phí nếu chạy trên PC cá nhân | Cao |

Bản nâng cấp bắt đầu bằng hướng thứ nhất. Các capability thuộc hướng thứ hai chỉ bật từng cái sau khi có adapter Windows riêng, allowlist, preview và nút dừng khẩn cấp.

## Thành phần v2

| Thành phần | Trách nhiệm | Trạng thái an toàn mặc định |
|---|---|---|
| Chatbot | Trao đổi, giải thích, lập kế hoạch, không tự thao tác PC | Chỉ trả lời |
| Agent | Tạo task, hiển thị preview, chạy công cụ được cấp quyền | Deny-by-default |
| Thanh realtime | Bước hiện tại, phần trăm, log tóm tắt, stop/cancel | Chỉ phát trạng thái |
| Công cụ | Screenshot, tệp, nhiệm vụ, kỹ năng, kế hoạch | Mỗi công cụ có quyền riêng |
| Lịch sử | Lưu hội thoại, task, audit log cục bộ | Không gửi ra ngoài |
| Quyền | Thiết bị, workspace và capability | Phải phê duyệt |

## Luồng phê duyệt

1. Điện thoại gửi yêu cầu.
2. PC Agent tạo kế hoạch tối thiểu và preview.
3. Ứng dụng hiển thị hành động, phạm vi, dữ liệu được đọc/ghi và mức rủi ro bằng tiếng Việt.
4. Người dùng phê duyệt, từ chối hoặc dừng.
5. PC Agent cập nhật trạng thái realtime và ghi audit log.
6. Kết quả được trả về ứng dụng; capability không được cấp quyền sẽ bị từ chối rõ ràng.

## Không bật trong bản đầu tiên

Không mở shell tùy ý, không chạy lệnh xóa/ghi ngoài workspace, không điều khiển tài khoản nhắn tin tự động, không mở port công khai ra Internet, không gửi dữ liệu tới API bên thứ ba và không giả lập quyền quản trị Windows. Screenshot/OCR, browser control, chuột/bàn phím, đọc tin nhắn và lịch lặp sẽ được thiết kế thành các module độc lập sau khi có kiểm thử bảo mật.
