// Trả tiến trình xử lý (VD: đã tách xong đoạn 3/8) qua NDJSON — mỗi dòng là 1 sự kiện JSON,
// dòng cuối luôn là "done" (kèm kết quả) hoặc "error". Dùng chung cho mọi tác vụ AI xử lý
// nhiều đoạn/nhiều trang, để giao diện hiển thị tiến trình thay vì màn hình "đang xử lý" im lìm.
export function startProgressStream(res) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  return {
    progress(data) {
      res.write(JSON.stringify({ type: "progress", ...data }) + "\n");
    },
    done(result) {
      res.write(JSON.stringify({ type: "done", result }) + "\n");
      res.end();
    },
    error(message) {
      res.write(JSON.stringify({ type: "error", error: message }) + "\n");
      res.end();
    },
  };
}
