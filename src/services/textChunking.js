const DEFAULT_CHUNK_SIZE = 18000;

// Tách văn bản dài thành nhiều đoạn để không bị cắt cụt khi gửi cho AI (giới hạn ngữ cảnh).
// Ưu tiên cắt tại ranh giới đoạn văn (\n\n) để không xé đôi một sản phẩm/mục giữa chừng.
export function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (text.length <= chunkSize) return [text];

  const paragraphs = text.split("\n\n");
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > chunkSize && current) {
      chunks.push(current);
      current = para;
    } else {
      current = candidate;
    }

    // Đoạn văn tự nó đã dài hơn cả chunkSize (VD: không có \n\n) — cắt cứng theo ký tự.
    while (current.length > chunkSize) {
      chunks.push(current.slice(0, chunkSize));
      current = current.slice(chunkSize);
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
